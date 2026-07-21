/**
 * Token history DB helper — read-only, global-scope per-token TX history
 * (chronos-shell). Mirrors `portfolio-db.ts` / `moves-db.ts`: own `pg.Client`
 * per call, no `@vex-agent/db/repos/*` import. Reads the same local `vex`
 * Postgres the engine writes to.
 *
 * SOURCES (UNIONed, keyset-paginated):
 *  (a) `proj_activity` — the wallet's success-only activity feed. A row
 *      matches when EITHER leg's token+chain identity equals the requested
 *      `(chainId, tokenAddress)`. Matching is LEG-AWARE because a bridge
 *      row's two legs can be on DIFFERENT chains: the INPUT leg is always on
 *      `proj_activity.chain` (the origin — both `relay.bridge` and
 *      `khalani.bridge` write `chain: String(originChainId)`, read-only
 *      reference: `tools/protocols/relay/handlers/bridge.ts`,
 *      `tools/protocols/khalani/handlers/bridge.ts`, root `src/`, NOT
 *      imported — the trust boundary forbids it), while the OUTPUT leg for a
 *      `product_type = 'bridge'` row is on `meta->>'destChain'` (both bridge
 *      handlers copy `{ sourceChain, destChain }` into `_tradeCapture.meta`,
 *      which `activity-populator.ts`'s `captureMeta` copies verbatim onto
 *      `proj_activity.meta`) — for every other product type the output leg
 *      shares the row's own `chain`. Bridge legs are recorded SYMBOL-first
 *      (`activity-populator.ts`'s `preferSymbolLegs`), so the AUTHORITATIVE
 *      address for matching/display is resolved via a `protocol_capture_items
 *      .trade_capture->>'{input,output}TokenAddress'` join (the same join key
 *      `moves-db.ts` already uses), falling back to the projected column when
 *      the JSONB field is absent.
 *  (b) `wallet_intents` — EXECUTED (`status='executed' AND tx_hash IS NOT
 *      NULL`) outbound sends, matched by ADDRESS ONLY: `token` is free-text,
 *      model-supplied (never validated at write time — see
 *      `tools/internal/wallet/send/validation.ts`, root `src/`, read-only
 *      reference), so a row whose `token` does not equal the requested
 *      address after normalization is EXCLUDED — never a symbol guess.
 *
 * Total order: `created_at DESC, source_rank DESC, source_id DESC`
 * (source_rank: activity=1, intent=0 — fixed). `source_id` is TEXT in both
 * arms (activity ids are zero-padded so lexicographic order matches numeric
 * order; intent ids are already opaque text) so one UNION column type works
 * for both. Keyset `limit+1` → `nextCursor`/`hasMore`, mirroring
 * `src/vex-agent/db/repos/transactions.ts` (read-only reference).
 *
 * BOUNDED READ WITHOUT A MIGRATION (round-2 negotiated): the read runs inside
 * `BEGIN READ ONLY; SET LOCAL statement_timeout = '2s'` … guaranteed
 * COMMIT/ROLLBACK. The page fetch and the cost-basis fetch are separate
 * statements inside that ONE transaction (SET LOCAL is transaction-scoped),
 * each individually bounded — NOT one end-to-end deadline. A page-phase
 * SQLSTATE 57014 fails the WHOLE read closed (`{status:"unavailable",
 * reason:"query_timeout"}`); a cost-basis-phase timeout degrades ONLY the
 * cost-basis sub-result (`{kind:"unavailable"}`) while the page's entries
 * still return normally — cost basis is supplementary, not load-bearing for
 * "did this token touch my wallet". The IPC handler (not this module) is
 * responsible for checking `ctx.signal.aborted` before trusting an
 * `"unavailable"` page result as a genuine timeout rather than a user cancel
 * (register-handler discipline — this module has no `ctx`).
 *
 * COST BASIS: candidate lots are `proj_pnl_lots` rows for the resolved
 * wallets with `status IN ('open','partial')`. A lot is AUTHORITATIVELY
 * matched via its `activity_id` link to the acquisition row (exact resolved
 * output address + chain match, same resolution as the activity arm above).
 * A lot with no linked activity row (legacy/synthetic) falls back to parsing
 * `instrument_key` for the AUTHORITATIVE 2-part spot shape (`{chain}:
 * {address}` — see `sync/instrument-key.ts`, root `src/`, read-only
 * reference); any other shape (prediction/lp/limit-order/Hyperliquid-style
 * `hyperliquid:perp:{coin}`, or unparseable) FAILS CLOSED — excluded, never
 * guessed. Remaining cost basis is PRORATED per lot (`cost_basis_usd ×
 * remaining/quantity`, exact `NUMERIC` arithmetic in SQL — `reduceLot` never
 * updates `cost_basis_usd` itself, only `remaining_quantity_raw`, mirroring
 * the exact proration formula `sync/projectors/spot.ts` already uses for the
 * realized-PnL match ledger). Totals (`totalOpenQuantity`, weighted
 * `avgOpenPriceUsd`) are computed in SQL via window aggregates over EVERY
 * matching lot (never just the capped display list) — atomic quantities can
 * exceed 2^53 (18-decimal tokens), so this NEVER touches JS `Number` for the
 * arithmetic. "No open lots" (`{kind:"none"}`) is distinguished from "could
 * not verify" (`{kind:"unavailable"}`).
 *
 * SECURITY: wallet allow-list is the GLOBAL configured inventory only
 * (`inventory-wallets.ts` — the same resolution `portfolio-db.ts` uses for
 * `scope: "global"`); the renderer never supplies an address. Logging records
 * ONLY counts + correlationId-free structural context — a cancellation logs
 * exactly one redacted event (`portfolio.token_history_query_canceled
 * phase=page|cost_basis`), never addresses/amounts.
 */

import { Client, type ClientConfig } from "pg";
import { err, ok, type Result, type VexError } from "@shared/ipc/result.js";
import { SOLANA_CHAIN_ID, familyForChainId } from "@shared/chains/display.js";
import {
  TOKEN_HISTORY_OPEN_LOTS_MAX,
  TOKEN_HISTORY_PAGE_SIZE,
  type AmountField,
  type TokenHistoryCostBasis,
  type TokenHistoryCursor,
  type TokenHistoryDto,
  type TokenHistoryEntry,
  type TokenHistoryReadInput,
} from "@shared/schemas/token-history.js";
import { sanitizeTokenSymbol } from "@shared/token-symbol-sanitizer.js";
import { resolveInventoryWalletAddresses } from "./inventory-wallets.js";
import { buildPoolConfig } from "./db-config.js";
import { log } from "../logger/index.js";

const CONNECT_TIMEOUT_MS = 2_000;
/** Outer session-level safety net; the per-transaction `SET LOCAL` below is the real bound. */
const SESSION_STATEMENT_TIMEOUT_MS = 5_000;
const STATEMENT_TIMEOUT_SQL = "2s";
const STATEMENT_TIMEOUT_SQLSTATE = "57014";

function dbUnavailable(): Result<never, VexError> {
  return err({
    code: "internal.unexpected",
    domain: "portfolio",
    message: "Database unavailable. Verify services are running and retry.",
    retryable: true,
    userActionable: true,
    redacted: true,
  });
}

function dbError(reason: string, cause?: unknown): Result<never, VexError> {
  log.warn(`[token-history-db] ${reason}`, cause);
  return err({
    code: "internal.unexpected",
    domain: "portfolio",
    message: "Unable to load token history.",
    retryable: true,
    userActionable: false,
    redacted: true,
  });
}

function isStatementTimeout(cause: unknown): boolean {
  return (
    typeof cause === "object" &&
    cause !== null &&
    "code" in cause &&
    (cause as { code?: unknown }).code === STATEMENT_TIMEOUT_SQLSTATE
  );
}

async function withClient<T>(
  fn: (client: Client) => Promise<Result<T, VexError>>,
): Promise<Result<T, VexError>> {
  let cfg: Awaited<ReturnType<typeof buildPoolConfig>>;
  try {
    cfg = await buildPoolConfig();
  } catch (cause) {
    log.warn("[token-history-db] buildPoolConfig threw", cause);
    return dbUnavailable();
  }
  if (cfg === null) return dbUnavailable();

  const clientConfig: ClientConfig = {
    host: cfg.host,
    port: cfg.port,
    database: cfg.database,
    user: cfg.user,
    password: cfg.password,
    connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
    statement_timeout: SESSION_STATEMENT_TIMEOUT_MS,
  };
  const client = new Client(clientConfig);
  try {
    await client.connect();
  } catch (cause) {
    log.warn("[token-history-db] client.connect failed", cause);
    return dbUnavailable();
  }
  try {
    return await fn(client);
  } finally {
    try {
      await client.end();
    } catch (cause) {
      log.warn("[token-history-db] client.end failed (non-fatal)", cause);
    }
  }
}

async function rollbackQuietly(client: Client): Promise<void> {
  try {
    await client.query("ROLLBACK");
  } catch (cause) {
    log.warn("[token-history-db] ROLLBACK failed (non-fatal)", cause);
  }
}

// ── Chain identity ──────────────────────────────────────────────────────

/**
 * Free-text `proj_activity.chain` / `wallet_intents.chain_alias` / lot
 * `chain` candidates for a numeric chainId. These columns are NOT FKs to any
 * chain-id table (`activity-populator.ts` writes `_tradeCapture.chain`
 * verbatim). Real emitters use two shapes for the same chain — a curated
 * slug (transcribed from `shared/explorer-links.ts`'s documented alias
 * vocabulary, the repo's existing single source of truth for these exact
 * strings) and the BARE decimal chain id (`relay.bridge`/`khalani.bridge`
 * always emit `chain: String(chainId)`) — so every candidate list carries
 * both. Scoped to the finite chainId set `shared/chains/display.ts` curates
 * (the only ids a click-origin identity can carry); an uncurated chainId
 * still gets the bare-decimal fallback.
 */
const CURATED_CHAIN_ALIASES: ReadonlyMap<number, readonly string[]> = new Map([
  [1, ["ethereum", "mainnet"]],
  [8453, ["base"]],
  [42161, ["arbitrum"]],
  [137, ["polygon"]],
  [10, ["optimism"]],
  [56, ["bsc", "bnb"]],
  [4663, ["robinhood", "robinhood chain", "robinhoodchain", "rhc"]],
]);

function chainMatchCandidates(chainId: number): readonly string[] {
  if (chainId === SOLANA_CHAIN_ID) return ["solana"];
  const curated = CURATED_CHAIN_ALIASES.get(chainId) ?? [];
  return [...curated, String(chainId)];
}

/**
 * Reverse of `CURATED_CHAIN_ALIASES` (alias → chainId), built once. Used to
 * resolve a STORED display-chain string (`a.chain` / `wi.chain_alias`) back
 * to its numeric chainId for `txRefs[].chainId` — this is NOT always the
 * chainId the read was scoped to: a bridge row can match via its
 * DESTINATION leg while its tx hash lives on the ORIGIN chain (`a.chain`),
 * so the ref's chain must be resolved from the row's own stored chain
 * string, never assumed from the query input.
 */
const CHAIN_ALIAS_TO_ID: ReadonlyMap<string, number> = (() => {
  const map = new Map<string, number>();
  for (const [id, aliases] of CURATED_CHAIN_ALIASES) {
    for (const alias of aliases) map.set(alias, id);
  }
  return map;
})();

/**
 * Resolve a stored display-chain string to a numeric chainId for `txRefs`.
 * `0` means "could not resolve" (no real EVM chain uses id 0) — the renderer
 * must treat that as "no link", never guess one.
 */
function resolveChainIdFromDisplayChain(chain: string): number {
  const normalized = chain.trim().toLowerCase();
  if (normalized === "solana") return SOLANA_CHAIN_ID;
  const curated = CHAIN_ALIAS_TO_ID.get(normalized);
  if (curated !== undefined) return curated;
  const numeric = Number(normalized);
  return Number.isFinite(numeric) && Number.isInteger(numeric) ? numeric : 0;
}

// ── Cursor helpers ──────────────────────────────────────────────────────

/** DB-side microsecond-precision UTC render, reused for BOTH arms' `cursor_ts`. */
function cursorTsExpr(column: string): string {
  return `to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
}

/**
 * Per-arm keyset boundary predicate on `(created_at, sourceRank, sourceId)`
 * DESC. `sourceRank` is a literal constant per arm (specialised, not a
 * row-value compare) — mirrors `transactions.ts`'s `keysetPredicate`.
 * Returns "" when there is no cursor (first page).
 */
function keysetPredicate(
  createdAtColumn: string,
  sourceIdExpr: string,
  sourceRankLiteral: 0 | 1,
  hasCursor: boolean,
  tsParam: number,
  rankParam: number,
  idParam: number,
): string {
  if (!hasCursor) return "";
  return (
    `AND (${createdAtColumn} < $${tsParam}::timestamptz` +
    ` OR (${createdAtColumn} = $${tsParam}::timestamptz AND ${sourceRankLiteral} < $${rankParam}::int)` +
    ` OR (${createdAtColumn} = $${tsParam}::timestamptz AND ${sourceRankLiteral} = $${rankParam}::int AND ${sourceIdExpr} < $${idParam}::text))`
  );
}

// ── Row shape (wide UNION — NULL placeholders where an arm doesn't apply) ─

interface PageRow {
  readonly source_kind: "activity" | "intent";
  readonly source_rank: number;
  readonly source_id: string;
  readonly created_at: string | Date;
  readonly cursor_ts: string;
  readonly namespace: string | null;
  readonly product_type: string | null;
  readonly trade_side: string | null;
  readonly chain: string | null;
  readonly dest_chain: string | null;
  readonly input_token_address: string | null;
  readonly input_amount: string | null;
  readonly output_token_address: string | null;
  readonly output_amount: string | null;
  readonly input_value_usd: number | string | null;
  readonly output_value_usd: number | string | null;
  readonly unit_price_usd: number | string | null;
  readonly capture_status: string | null;
  readonly tx_ref: string | null;
  readonly input_token_symbol: string | null;
  readonly input_token_local_symbol: string | null;
  readonly output_token_symbol: string | null;
  readonly output_token_local_symbol: string | null;
  readonly to_address: string | null;
}

interface LotRow {
  readonly remaining_quantity_raw: string;
  readonly prorated_cost_basis_usd: string | null;
  readonly price_usd: string | null;
  readonly opened_at: string | Date;
  readonly total_open_quantity: string;
  readonly avg_open_price_usd: string | null;
}

function toIso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

function toUsdStringOrNull(value: number | string | null): string | null {
  if (value === null) return null;
  return String(value);
}

/**
 * Unit provenance for an amount column, mirroring `MovesBlock.tsx`'s
 * `amountDisplay` discipline exactly: the engine records HUMAN-readable
 * amounts only for some captures (a dotted decimal); older/other captures
 * store raw base-unit integers (no dot) — meaningless to print without
 * decimals this query does not have.
 */
function amountField(value: string | null): AmountField {
  if (value === null) return { value: null, unitProvenance: "unknown" };
  if (value.includes(".")) {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed) && parsed > 0) return { value, unitProvenance: "human" };
    return { value, unitProvenance: "unknown" };
  }
  if (/^[0-9]+$/.test(value)) return { value, unitProvenance: "atomic" };
  return { value, unitProvenance: "unknown" };
}

/**
 * `wallet_intents.amount` is ALWAYS a human decimal the tool validated as
 * `Number.isFinite(...) > 0` at prepare time (`send/validation.ts`) — never
 * a raw atomic integer — so whole-number strings ("5") are still "human"
 * here, unlike `amountField`'s dotted-decimal requirement for activity rows.
 */
function humanAmountField(value: string | null): AmountField {
  if (value === null) return { value: null, unitProvenance: "unknown" };
  const parsed = Number.parseFloat(value);
  if (Number.isFinite(parsed) && parsed > 0) return { value, unitProvenance: "human" };
  return { value, unitProvenance: "unknown" };
}

function mapEntry(row: PageRow): TokenHistoryEntry {
  // The tx hash always lives on the ORIGIN chain (`row.chain` — never
  // `dest_chain`), even for a row that matched via its destination leg —
  // resolve it from the row's OWN stored chain string, not the query's
  // input chainId, which can legitimately differ for a bridge.
  const txRefs = row.tx_ref !== null && row.chain !== null
    ? [{ chainId: resolveChainIdFromDisplayChain(row.chain), ref: row.tx_ref }]
    : [];

  if (row.source_kind === "intent") {
    return {
      kind: "transfer",
      id: row.source_id,
      createdAt: toIso(row.created_at),
      chain: row.chain,
      toAddress: row.to_address ?? "",
      amount: humanAmountField(row.output_amount),
      token: row.output_token_address,
      status: row.capture_status ?? "unknown",
      txRefs,
    };
  }

  const input = {
    token: row.input_token_address,
    symbol: sanitizeTokenSymbol(row.input_token_symbol),
    localSymbol: sanitizeTokenSymbol(row.input_token_local_symbol),
    amount: amountField(row.input_amount),
    valueUsd: toUsdStringOrNull(row.input_value_usd),
  };
  const output = {
    token: row.output_token_address,
    symbol: sanitizeTokenSymbol(row.output_token_symbol),
    localSymbol: sanitizeTokenSymbol(row.output_token_local_symbol),
    amount: amountField(row.output_amount),
    valueUsd: toUsdStringOrNull(row.output_value_usd),
  };

  if (row.product_type === "bridge") {
    return {
      kind: "bridge",
      id: row.source_id,
      createdAt: toIso(row.created_at),
      originChain: row.chain ?? "unknown",
      destinationChain: row.dest_chain,
      venue: row.namespace,
      input,
      output,
      captureStatus: row.capture_status,
      txRefs,
    };
  }

  return {
    kind: "swap",
    id: row.source_id,
    createdAt: toIso(row.created_at),
    chain: row.chain ?? "unknown",
    venue: row.namespace,
    tradeSide: row.trade_side,
    productType: row.product_type,
    input,
    output,
    unitPriceUsd: toUsdStringOrNull(row.unit_price_usd),
    captureStatus: row.capture_status,
    txRefs,
  };
}

// ── Cost basis ────────────────────────────────────────────────────────────

function buildCostBasis(rows: readonly LotRow[]): TokenHistoryCostBasis {
  if (rows.length === 0) return { kind: "none" };
  const first = rows[0];
  if (first === undefined) return { kind: "none" };
  return {
    kind: "lots",
    openLots: rows.slice(0, TOKEN_HISTORY_OPEN_LOTS_MAX).map((row) => ({
      quantity: { value: row.remaining_quantity_raw, unitProvenance: "atomic" },
      priceUsd: row.price_usd,
      costBasisUsd: row.prorated_cost_basis_usd,
      openedAt: toIso(row.opened_at),
    })),
    totalOpenQuantity: first.total_open_quantity,
    avgOpenPriceUsd: first.avg_open_price_usd,
  };
}

// ── Main read ─────────────────────────────────────────────────────────────

export async function getTokenHistory(
  input: TokenHistoryReadInput,
): Promise<Result<TokenHistoryDto, VexError>> {
  const wallets = [...resolveInventoryWalletAddresses()];

  // Fail closed: no configured wallets → the empty available page, before any SQL.
  if (wallets.length === 0) {
    log.info("[token-history-db] getTokenHistory ok wallets=0 (empty inventory)");
    return ok({
      status: "available",
      entries: [],
      nextCursor: null,
      hasMore: false,
      costBasis: { kind: "none" },
    });
  }

  const family = familyForChainId(input.chainId);
  const network = family === "solana" ? "solana" : "eip155";
  const chainAliases = [...chainMatchCandidates(input.chainId)];
  // Defense in depth: `tokenHistoryReadInputSchema` already lower-cases EVM
  // addresses at the IPC boundary, but `addr()` below only wraps the STORED
  // COLUMN in `lower(...)` — the bound parameter must independently carry
  // the same casing, or `lower(column) = $param` would silently match zero
  // rows for any caller that reaches this function without going through
  // that schema (e.g. a direct call). Idempotent when the schema already ran.
  const normalizedAddress =
    family === "evm" ? input.tokenAddress.toLowerCase() : input.tokenAddress;
  const addr = (column: string): string => (family === "evm" ? `lower(${column})` : column);

  const cursor: TokenHistoryCursor | null = input.cursor;

  return withClient<TokenHistoryDto>(async (client) => {
    try {
      await client.query("BEGIN READ ONLY");
    } catch (cause) {
      return dbError("BEGIN READ ONLY failed", cause);
    }

    try {
      await client.query(`SET LOCAL statement_timeout = '${STATEMENT_TIMEOUT_SQL}'`);
    } catch (cause) {
      await rollbackQuietly(client);
      return dbError("SET LOCAL statement_timeout failed", cause);
    }

    // ── Phase 1: the page ────────────────────────────────────────────────
    const params: unknown[] = [];
    const push = (value: unknown): number => {
      params.push(value);
      return params.length;
    };

    const walletsParam = push(wallets);
    const chainAliasesParam = push(chainAliases);
    const addressParam = push(normalizedAddress);
    const networkParam = push(network);

    const hasCursor = cursor !== null;
    const tsParam = cursor !== null ? push(cursor.createdAt) : 0;
    const rankParam = cursor !== null ? push(cursor.sourceRank) : 0;
    const idParam = cursor !== null ? push(cursor.sourceId) : 0;

    const limitParam = push(TOKEN_HISTORY_PAGE_SIZE + 1);

    const activityKeyset = keysetPredicate(
      "a.created_at",
      "lpad(a.id::text, 20, '0')",
      1,
      hasCursor,
      tsParam,
      rankParam,
      idParam,
    );
    const intentKeyset = keysetPredicate(
      "wi.created_at",
      "wi.intent_id",
      0,
      hasCursor,
      tsParam,
      rankParam,
      idParam,
    );

    const activityHalf = `
      SELECT
        'activity'::text AS source_kind,
        1 AS source_rank,
        lpad(a.id::text, 20, '0') AS source_id,
        a.created_at,
        ${cursorTsExpr("a.created_at")} AS cursor_ts,
        a.namespace,
        a.product_type,
        a.trade_side,
        a.chain,
        CASE WHEN a.product_type = 'bridge' THEN a.meta->>'destChain' ELSE NULL END AS dest_chain,
        COALESCE(NULLIF(ci.trade_capture->>'inputTokenAddress', ''), a.input_token) AS input_token_address,
        a.input_amount,
        COALESCE(NULLIF(ci.trade_capture->>'outputTokenAddress', ''), a.output_token) AS output_token_address,
        a.output_amount,
        a.input_value_usd,
        a.output_value_usd,
        a.unit_price_usd,
        a.capture_status,
        COALESCE(a.external_refs->>'txHash', a.external_refs->>'signature') AS tx_ref,
        CASE
          WHEN jsonb_typeof(ci.trade_capture->'inputToken') = 'string'
           AND char_length(ci.trade_capture->>'inputToken') BETWEEN 1 AND 64
          THEN LEFT(ci.trade_capture->>'inputToken', 64)
          ELSE NULL
        END AS input_token_symbol,
        (SELECT LEFT(MIN(b.token_symbol), 64)
           FROM proj_balances b
          WHERE b.wallet_address = a.wallet_address
            AND b.token_address = a.input_token
            AND b.token_symbol IS NOT NULL
         HAVING COUNT(DISTINCT b.token_symbol) = 1) AS input_token_local_symbol,
        CASE
          WHEN jsonb_typeof(ci.trade_capture->'outputToken') = 'string'
           AND char_length(ci.trade_capture->>'outputToken') BETWEEN 1 AND 64
          THEN LEFT(ci.trade_capture->>'outputToken', 64)
          ELSE NULL
        END AS output_token_symbol,
        (SELECT LEFT(MIN(b.token_symbol), 64)
           FROM proj_balances b
          WHERE b.wallet_address = a.wallet_address
            AND b.token_address = a.output_token
            AND b.token_symbol IS NOT NULL
         HAVING COUNT(DISTINCT b.token_symbol) = 1) AS output_token_local_symbol,
        NULL::text AS to_address
      FROM proj_activity a
      LEFT JOIN protocol_capture_items ci
        ON ci.id = a.capture_item_id AND ci.execution_id = a.execution_id
      WHERE a.wallet_address = ANY($${walletsParam}::text[])
        AND (
          (
            lower(trim(a.chain)) = ANY($${chainAliasesParam}::text[])
            AND ${addr("COALESCE(NULLIF(ci.trade_capture->>'inputTokenAddress', ''), a.input_token)")} = $${addressParam}
          )
          OR
          (
            lower(trim(CASE WHEN a.product_type = 'bridge' THEN COALESCE(a.meta->>'destChain', a.chain) ELSE a.chain END)) = ANY($${chainAliasesParam}::text[])
            AND ${addr("COALESCE(NULLIF(ci.trade_capture->>'outputTokenAddress', ''), a.output_token)")} = $${addressParam}
          )
        )
        ${activityKeyset}`;

    const intentHalf = `
      SELECT
        'intent'::text AS source_kind,
        0 AS source_rank,
        wi.intent_id AS source_id,
        wi.created_at,
        ${cursorTsExpr("wi.created_at")} AS cursor_ts,
        NULL::text AS namespace,
        NULL::text AS product_type,
        NULL::text AS trade_side,
        wi.chain_alias AS chain,
        NULL::text AS dest_chain,
        NULL::text AS input_token_address,
        NULL::text AS input_amount,
        wi.token AS output_token_address,
        wi.amount AS output_amount,
        NULL::numeric AS input_value_usd,
        NULL::numeric AS output_value_usd,
        NULL::numeric AS unit_price_usd,
        wi.status AS capture_status,
        wi.tx_hash AS tx_ref,
        NULL::text AS input_token_symbol,
        NULL::text AS input_token_local_symbol,
        NULL::text AS output_token_symbol,
        NULL::text AS output_token_local_symbol,
        wi.to_address
      FROM wallet_intents wi
      WHERE wi.wallet_address = ANY($${walletsParam}::text[])
        AND wi.status = 'executed'
        AND wi.tx_hash IS NOT NULL
        AND wi.network = $${networkParam}
        AND lower(trim(wi.chain_alias)) = ANY($${chainAliasesParam}::text[])
        AND ${addr("wi.token")} = $${addressParam}
        ${intentKeyset}`;

    const pageSql = `${activityHalf}
      UNION ALL
      ${intentHalf}
      ORDER BY created_at DESC, source_rank DESC, source_id DESC
      LIMIT $${limitParam}`;

    let pageRows: PageRow[];
    try {
      const result = await client.query<PageRow>(pageSql, params);
      pageRows = result.rows;
    } catch (cause) {
      await rollbackQuietly(client);
      if (isStatementTimeout(cause)) {
        log.info("portfolio.token_history_query_canceled phase=page");
        return ok({ status: "unavailable", reason: "query_timeout" });
      }
      return dbError("page query failed", cause);
    }

    const hasMore = pageRows.length > TOKEN_HISTORY_PAGE_SIZE;
    const kept = hasMore ? pageRows.slice(0, TOKEN_HISTORY_PAGE_SIZE) : pageRows;
    const entries = kept.map(mapEntry);
    const lastKept = kept[kept.length - 1];
    const nextCursor: TokenHistoryCursor | null =
      hasMore && lastKept !== undefined
        ? {
            createdAt: lastKept.cursor_ts,
            sourceRank: lastKept.source_rank === 1 ? 1 : 0,
            sourceId: lastKept.source_id,
          }
        : null;

    // ── Phase 2: cost basis (supplementary — a failure here degrades only
    // the cost-basis sub-result, never the page we already fetched). ANY
    // statement failure aborts the surrounding Postgres transaction (SQLSTATE
    // 25P02 on the next command until ROLLBACK), so a failed cost-basis
    // statement must ROLLBACK — never attempt COMMIT — while the already-
    // fetched `entries`/`nextCursor` (plain JS values by this point) still
    // return as a successful page.
    let costBasis: TokenHistoryCostBasis = { kind: "unavailable" };
    let costBasisFailed = false;
    try {
      const lotsSql = `
        WITH candidate_lots AS (
          SELECT
            lots.remaining_quantity_raw,
            lots.quantity_raw,
            lots.cost_basis_usd,
            lots.price_usd,
            lots.opened_at,
            lots.activity_id,
            lots.instrument_key,
            lots.chain,
            acq.chain AS acq_chain,
            COALESCE(NULLIF(acq_ci.trade_capture->>'outputTokenAddress', ''), acq.output_token) AS acq_output_token_address
          FROM proj_pnl_lots lots
          LEFT JOIN proj_activity acq ON acq.id = lots.activity_id
          LEFT JOIN protocol_capture_items acq_ci
            ON acq_ci.id = acq.capture_item_id AND acq_ci.execution_id = acq.execution_id
          WHERE lots.wallet_address = ANY($1::text[])
            AND lots.status IN ('open', 'partial')
        ),
        matched_lots AS (
          SELECT *
          FROM candidate_lots c
          WHERE
            (
              c.activity_id IS NOT NULL
              AND lower(trim(c.acq_chain)) = ANY($2::text[])
              AND ${addr("c.acq_output_token_address")} = $3
            )
            OR
            (
              c.activity_id IS NULL
              AND array_length(string_to_array(c.instrument_key, ':'), 1) = 2
              AND lower(trim(split_part(c.instrument_key, ':', 1))) = ANY($2::text[])
              AND ${addr("split_part(c.instrument_key, ':', 2)")} = $3
            )
        )
        SELECT
          remaining_quantity_raw,
          (cost_basis_usd * remaining_quantity_raw::numeric / NULLIF(quantity_raw::numeric, 0))::text AS prorated_cost_basis_usd,
          price_usd::text AS price_usd,
          opened_at,
          SUM(remaining_quantity_raw::numeric) OVER ()::text AS total_open_quantity,
          (
            SUM(price_usd * remaining_quantity_raw::numeric) FILTER (WHERE price_usd IS NOT NULL) OVER ()
            / NULLIF(SUM(remaining_quantity_raw::numeric) FILTER (WHERE price_usd IS NOT NULL) OVER (), 0)
          )::text AS avg_open_price_usd
        FROM matched_lots
        ORDER BY opened_at ASC
        LIMIT 5000`;
      const lotsResult = await client.query<LotRow>(lotsSql, [wallets, chainAliases, normalizedAddress]);
      costBasis = buildCostBasis(lotsResult.rows);
    } catch (cause) {
      costBasisFailed = true;
      if (isStatementTimeout(cause)) {
        log.info("portfolio.token_history_query_canceled phase=cost_basis");
      } else {
        log.warn("[token-history-db] cost-basis query failed, degrading to unavailable", cause);
      }
      costBasis = { kind: "unavailable" };
    }

    if (costBasisFailed) {
      // The transaction is already aborted by the failed statement above —
      // ROLLBACK, never COMMIT. The page's `entries`/`nextCursor` are already
      // plain JS values, so this still returns as a successful page.
      await rollbackQuietly(client);
    } else {
      try {
        await client.query("COMMIT");
      } catch (cause) {
        await rollbackQuietly(client);
        return dbError("COMMIT failed", cause);
      }
    }

    log.info(
      `[token-history-db] getTokenHistory ok entries=${entries.length} hasMore=${hasMore} costBasis=${costBasis.kind}`,
    );
    return ok({ status: "available", entries, nextCursor, hasMore, costBasis });
  });
}
