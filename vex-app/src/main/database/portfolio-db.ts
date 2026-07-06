/**
 * Portfolio DB helper — read-only dual-scope POSITION portfolio (stage 3).
 *
 * Mirrors `usage-db.ts` / `sessions-db.ts` decoupling: own `pg.Client` per
 * call, no `@vex-agent/db/repos/*` import. Reads the same local `vex`
 * Postgres the engine writes to, against:
 *
 *   proj_balances(wallet_address TEXT, chain_id BIGINT, token_symbol TEXT,
 *                 balance_usd NUMERIC)
 *   proj_portfolio_snapshots(wallet_family eip155|solana, wallet_address TEXT,
 *                 snapshot_group_id UUID, total_usd NUMERIC,
 *                 pnl_vs_prev NUMERIC, created_at)
 *
 * SECURITY (non-negotiable):
 *  - GLOBAL is an EXPLICIT address allow-list. EVERY SELECT carries
 *    `WHERE wallet_address = ANY($1::text[])` with a bound, finite array.
 *    The filter is never omitted.
 *  - addresses.length === 0 → return the EMPTY DTO BEFORE issuing any SQL
 *    (no wallets configured, or empty session scope). Fail closed.
 *  - addresses are resolved SERVER-SIDE (config inventory / session scope);
 *    a renderer-supplied address is never accepted.
 *  - join key between inventory and balances is the raw ADDRESS string —
 *    DO NOT lowercase (the engine stores raw checksum/base58 addresses).
 *  - logging records sessionId (if any) + wallet COUNT + token COUNT only;
 *    NEVER raw addresses, balances, or USD figures.
 */

import { Client, type ClientConfig } from "pg";
import { err, ok, type Result, type VexError } from "@shared/ipc/result.js";
import type {
  PortfolioDto,
  PortfolioReadInput,
  PositionChainDto,
  PositionTokenDto,
} from "@shared/schemas/portfolio.js";
import { familyForChainId } from "@shared/chains/display.js";
import { listWallets } from "@vex-lib/wallet.js";
import { getSessionWalletScope } from "./sessions-db.js";
import { buildPoolConfig } from "./db-config.js";
import { log } from "../logger/index.js";

const CONNECT_TIMEOUT_MS = 2_000;
const QUERY_TIMEOUT_MS = 5_000;

// `correlationId` intentionally omitted; `registerHandler` stamps
// `ctx.requestId` downstream. Mirrors `usage-db.ts`.
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
  log.warn(`[portfolio-db] ${reason}`, cause);
  return err({
    code: "internal.unexpected",
    domain: "portfolio",
    message: "Unable to load portfolio.",
    retryable: true,
    userActionable: false,
    redacted: true,
  });
}

async function withClient<T>(
  fn: (client: Client) => Promise<Result<T, VexError>>,
): Promise<Result<T, VexError>> {
  let cfg: Awaited<ReturnType<typeof buildPoolConfig>>;
  try {
    cfg = await buildPoolConfig();
  } catch (cause) {
    log.warn("[portfolio-db] buildPoolConfig threw", cause);
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
    statement_timeout: QUERY_TIMEOUT_MS,
  };
  const client = new Client(clientConfig);
  try {
    await client.connect();
  } catch (cause) {
    log.warn("[portfolio-db] client.connect failed", cause);
    return dbUnavailable();
  }
  try {
    return await fn(client);
  } finally {
    try {
      await client.end();
    } catch (cause) {
      log.warn("[portfolio-db] client.end failed (non-fatal)", cause);
    }
  }
}

interface LiveTotalRow {
  readonly live: number | string | null;
}

interface TokenRow {
  readonly chain_id: number | string | null;
  readonly token_symbol: string | null;
  readonly usd: number | string | null;
}

interface SnapshotRow {
  readonly total: number | string | null;
  readonly at: string | Date | null;
}

interface ChainBreakdownRow {
  readonly chain_id: number | string;
  readonly chain_total: number | string;
  readonly token_symbol: string | null;
  readonly token_usd: number | string | null;
}

/**
 * Cap on per-(chain, token) holding lines. Matches the `portfolioDtoSchema`
 * `tokens` `.max(500)` so the response can never overflow the output-schema
 * bound (a >cap wallet set would otherwise 500-error the whole panel via the
 * handler's output validation). Enforced in BOTH the SQL LIMIT and a TS slice.
 */
const MAX_TOKEN_LINES = 500;

/**
 * Caps for the per-chain breakdown — mirror `portfolioDtoSchema.chains`
 * (`.max(64)` chains, `.max(3)` tokens each). The SQL emits at most
 * 64 chains × ≤3 token rows; TS slices defensively to the same bounds.
 */
const MAX_BREAKDOWN_CHAINS = 64;
const MAX_CHAIN_TOKENS = 3;

/**
 * Assemble `PositionChainDto[]` from the breakdown query's flat rows
 * (one row per surviving (chain, top-token) pair, chain totals repeated,
 * ordered chain-total DESC then chain id ASC then token rank ASC — the
 * chain-id tie-breaker keeps equal-total chains CONTIGUOUS, which this
 * single-pass grouper depends on; codex final review). Rows arrive
 * pre-filtered: positive chain totals, positive token USD, NULL chain_id
 * excluded.
 */
function buildChainBreakdown(
  rows: readonly ChainBreakdownRow[],
): PositionChainDto[] {
  const chains: PositionChainDto[] = [];
  let current: {
    chainId: number;
    totalUsd: number;
    tokens: { symbol: string | null; balanceUsd: number }[];
  } | null = null;
  for (const row of rows) {
    const chainId = toChainId(row.chain_id);
    const totalUsd = toNumber(row.chain_total);
    // Defensive: the SQL already excludes NULL chain ids and non-positive
    // totals; a row that still fails coercion is dropped, not fabricated.
    if (chainId === null || totalUsd <= 0) continue;
    if (current === null || current.chainId !== chainId) {
      if (current !== null) {
        chains.push({
          chainId: current.chainId,
          family: familyForChainId(current.chainId),
          totalUsd: current.totalUsd,
          tokens: current.tokens,
        });
        if (chains.length >= MAX_BREAKDOWN_CHAINS) return chains;
      }
      current = { chainId, totalUsd, tokens: [] };
    }
    const tokenUsd = toNumberOrNull(row.token_usd);
    if (tokenUsd !== null && tokenUsd > 0 && current.tokens.length < MAX_CHAIN_TOKENS) {
      current.tokens.push({ symbol: row.token_symbol, balanceUsd: tokenUsd });
    }
  }
  if (current !== null && chains.length < MAX_BREAKDOWN_CHAINS) {
    chains.push({
      chainId: current.chainId,
      family: familyForChainId(current.chainId),
      totalUsd: current.totalUsd,
      tokens: current.tokens,
    });
  }
  return chains;
}

/**
 * `NUMERIC`/`float8` columns come back from `pg` as strings or numbers. We
 * coerce to a finite JS number, falling back to `0` for the never-null
 * SUM totals (the SQL `COALESCE(...,0)::float8` already guarantees a value).
 */
function toNumber(value: number | string | null | undefined): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Like `toNumber` but preserves the "absent" distinction as `null`. */
function toNumberOrNull(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * `chain_id` is a `BIGINT` that may exceed the JS safe-integer range; `pg`
 * returns it as a string. We coerce via `Number()` and tolerate loss of
 * precision (the renderer uses it as an opaque grouping key, not for
 * arithmetic). `null` when absent or unparseable — no fabricated 0.
 */
function toChainId(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toIso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

function emptyPortfolio(scope: PortfolioReadInput["scope"]): PortfolioDto {
  return {
    scope,
    walletCount: 0,
    liveTotalUsd: 0,
    snapshotTotalUsd: null,
    pnlVsPrev: null,
    snapshotAt: null,
    tokens: [],
    chains: [],
  };
}

/**
 * Resolve the server-side wallet address allow-list for the requested scope.
 *
 *  - `global`  — the configured EVM + Solana inventory (≤6 addresses).
 *  - `session` — the session's selected EVM/Solana wallets (≤2 addresses).
 *    A failed scope read propagates as an error (fail closed); an empty
 *    scope resolves to `[]` (→ empty DTO before SQL).
 *
 * Addresses are returned as raw strings (NO lowercasing) so the
 * `proj_balances.wallet_address` join matches the engine's stored form.
 */
async function resolveAddresses(
  input: PortfolioReadInput,
): Promise<Result<readonly string[], VexError>> {
  if (input.scope === "global") {
    const entries = [...listWallets("evm"), ...listWallets("solana")];
    // Dedupe: the snapshot-completeness guard compares COUNT(DISTINCT
    // wallet_address) against addresses.length, so a repeated address in the
    // configured inventory would otherwise spuriously drop the snapshot total.
    return ok([...new Set(entries.map((e) => e.address))]);
  }
  const scope = await getSessionWalletScope(input.sessionId);
  if (!scope.ok) return scope;
  const addrs = [scope.data.evm?.address, scope.data.solana?.address].filter(
    (a): a is string => typeof a === "string",
  );
  return ok([...new Set(addrs)]);
}

/**
 * Read the dual-scope POSITION portfolio for the requested scope.
 *
 * Returns the EMPTY DTO (no SQL issued) when the resolved allow-list is
 * empty. Otherwise aggregates `proj_balances` (live total + per-token lines)
 * and the most recent COMPLETE `proj_portfolio_snapshots` group covering
 * exactly the resolved address set.
 */
export async function getPortfolio(
  input: PortfolioReadInput,
): Promise<Result<PortfolioDto, VexError>> {
  const resolved = await resolveAddresses(input);
  if (!resolved.ok) return resolved;
  const addresses = resolved.data;

  // Fail closed: no wallets → empty portfolio BEFORE any SQL.
  if (addresses.length === 0) {
    return ok(emptyPortfolio(input.scope));
  }

  const addrParam = [...addresses];

  return withClient(async (client) => {
    try {
      // (a) Live total USD across all resolved addresses.
      const liveResult = await client.query<LiveTotalRow>(
        `SELECT COALESCE(SUM(balance_usd), 0)::float8 AS live
           FROM proj_balances
          WHERE wallet_address = ANY($1::text[])`,
        [addrParam],
      );
      const liveTotalUsd = toNumber(liveResult.rows[0]?.live);

      // (b) Per-(chain, token) live USD lines, newest USD first, capped at
      // MAX_TOKEN_LINES so the response stays inside the output-schema bound.
      const tokensResult = await client.query<TokenRow>(
        `SELECT chain_id,
                token_symbol,
                COALESCE(SUM(balance_usd), 0)::float8 AS usd
           FROM proj_balances
          WHERE wallet_address = ANY($1::text[])
          GROUP BY chain_id, token_symbol
          ORDER BY usd DESC NULLS LAST
          LIMIT ${MAX_TOKEN_LINES}`,
        [addrParam],
      );
      const tokens: PositionTokenDto[] = tokensResult.rows
        .slice(0, MAX_TOKEN_LINES)
        .map((row) => ({
          chainId: toChainId(row.chain_id),
          symbol: row.token_symbol,
          balanceUsd: toNumber(row.usd),
        }));

      // (b2) Per-chain breakdown for the POSITION chain switcher — a
      // PURPOSE-BUILT window query over the FULL balance set (Codex plan
      // review: post-processing the capped flat query above would silently
      // drop chains once the 500-row bound bites). Invariants pushed into
      // SQL: NULL chain ids excluded (legacy `tokens` still carries them),
      // only chains with a strictly positive total survive, and each chain
      // contributes its top-${MAX_CHAIN_TOKENS} positive-USD token lines.
      const breakdownResult = await client.query<ChainBreakdownRow>(
        `WITH lines AS (
           SELECT chain_id,
                  token_symbol,
                  COALESCE(SUM(balance_usd), 0)::float8 AS usd
             FROM proj_balances
            WHERE wallet_address = ANY($1::text[])
              AND chain_id IS NOT NULL
            GROUP BY chain_id, token_symbol
         ),
         ranked AS (
           SELECT chain_id, token_symbol, usd,
                  ROW_NUMBER() OVER (
                    PARTITION BY chain_id ORDER BY usd DESC NULLS LAST
                  ) AS rn
             FROM lines
            WHERE usd > 0
         ),
         totals AS (
           SELECT chain_id, SUM(usd)::float8 AS chain_total
             FROM lines
            GROUP BY chain_id
           HAVING SUM(usd) > 0
            ORDER BY chain_total DESC
            LIMIT ${MAX_BREAKDOWN_CHAINS}
         )
         SELECT t.chain_id,
                t.chain_total,
                r.token_symbol,
                r.usd AS token_usd
           FROM totals t
           LEFT JOIN ranked r
             ON r.chain_id = t.chain_id AND r.rn <= ${MAX_CHAIN_TOKENS}
          ORDER BY t.chain_total DESC, t.chain_id ASC, r.rn ASC NULLS LAST`,
        [addrParam],
      );
      const chains = buildChainBreakdown(breakdownResult.rows);

      // (c) PnL across COMPLETE snapshot cycles: the latest TWO groups that
      // cover EXACTLY the resolved address set (HAVING COUNT(DISTINCT)=N — a
      // partial group for a subset of the wallets is ignored). Aggregate PnL is
      // `latest.total − previous.total`, NOT SUM(pnl_vs_prev): per-wallet PnL
      // baselines don't compose into a correct set total (and miss wallets with
      // no prior row). snapshot/PnL are null when the cycle(s) are absent.
      const snapshotResult = await client.query<SnapshotRow>(
        `SELECT snapshot_group_id,
                SUM(total_usd)::float8 AS total,
                MAX(created_at)        AS at
           FROM proj_portfolio_snapshots
          WHERE wallet_address = ANY($1::text[])
          GROUP BY snapshot_group_id
         HAVING COUNT(DISTINCT wallet_address) = $2
          ORDER BY at DESC
          LIMIT 2`,
        [addrParam, addresses.length],
      );
      const latest = snapshotResult.rows[0];
      const previous = snapshotResult.rows[1];
      const snapshotTotalUsd = latest ? toNumberOrNull(latest.total) : null;
      const previousTotalUsd = previous ? toNumberOrNull(previous.total) : null;
      const pnlVsPrev =
        snapshotTotalUsd !== null && previousTotalUsd !== null
          ? snapshotTotalUsd - previousTotalUsd
          : null;
      const snapshotAt = latest && latest.at !== null ? toIso(latest.at) : null;

      log.info(
        `[portfolio-db] getPortfolio ok scope=${input.scope} ` +
          `wallets=${addresses.length} tokens=${tokens.length} ` +
          `chains=${chains.length} snapshot=${latest !== undefined}`,
      );

      return ok({
        scope: input.scope,
        walletCount: addresses.length,
        liveTotalUsd,
        snapshotTotalUsd,
        pnlVsPrev,
        snapshotAt,
        tokens,
        chains,
      });
    } catch (cause) {
      return dbError("getPortfolio query failed", cause);
    }
  });
}
