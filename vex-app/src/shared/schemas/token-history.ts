/**
 * Token history schemas — read-only, global-scope per-token TX history
 * (chronos-shell). Backs `vex:portfolio:listTokenHistory`.
 *
 * Input identity is REQUIRED and exact: `{ chainId, tokenAddress }`. There is
 * no symbol-only lookup — name/symbol are display metadata elsewhere, never a
 * query input, so a spoofed symbol can never redirect the read (mirrors
 * `portfolio.ts`'s address-keyed aggregation policy). `tokenAddress` shape is
 * validated PER CHAIN FAMILY (EVM 0x-hex vs Solana base58, derived from
 * `chainId` via `familyForChainId`) and, for EVM, lower-cased at the boundary
 * so every downstream comparison (SQL + JS) works against one canonical
 * casing — mirrors `NORMALIZED_TOKEN_ADDRESS_SQL` in `portfolio-db.ts`.
 *
 * Pagination is a strict 3-field keyset cursor — `{ createdAt, sourceRank,
 * sourceId }` — NOT an opaque token (unlike the root `transactions.ts`
 * feed's base64 codec): the vex-app IPC boundary prefers a self-describing,
 * schema-validated shape over an opaque blob. `createdAt` carries
 * MICROSECOND precision (`precision: 6`) because the underlying UNION
 * (`proj_activity` + `wallet_intents`) can tie at millisecond resolution;
 * losing sub-millisecond precision would reopen keyset gaps/dupes at ties
 * (see `src/vex-agent/db/repos/transactions-cursor.ts`, read-only reference
 * — not imported, root `src/` cannot cross the vex-app boundary).
 * `sourceRank` is FIXED per arm (activity=1, intent=0); `sourceId` is a
 * STRING because the two arms' native ids are different types
 * (`proj_activity.id` SERIAL vs `wallet_intents.intent_id` TEXT) — the DB
 * layer renders both as comparable text (zero-padded for the numeric arm)
 * so one cursor shape works for the whole UNION.
 *
 * Output is the discriminated `status` union the round-3 plan closure
 * specifies: `"available"` (a normal page, degrading gracefully) vs
 * `"unavailable"` (the read hit its 2s statement timeout — SQLSTATE 57014 —
 * and fails CLOSED rather than rendering as "no history"). This is the ONLY
 * degradation path; every other failure (schema, connection, defect) is a
 * `Result` error from the handler, never this DTO shape.
 *
 * Entries are a discriminated `kind` union (`swap` | `bridge` | `transfer`)
 * — modelling the real shape difference between a same-chain trade, a
 * cross-chain bridge (origin/destination chain + legs can be on different
 * numeric chains), and a Vex-executed wallet send (no trade economics at
 * all). Quantities travel as DECIMAL STRINGS (never floats — some are raw
 * base-unit integers up to 78 digits, well past JS safe-integer range) and
 * carry a `unitProvenance` tag: `"human"` (a dotted decimal the engine
 * already formatted for display — mirrors `MovesBlock.tsx`'s `amountDisplay`
 * discipline, which renders ONLY dotted-decimal strings) or `"atomic"` (a
 * bare base-unit integer — meaningless to print without decimals we don't
 * have here) or `"unknown"`. The renderer must render a quantity ONLY when
 * `unitProvenance === "human"` — never guess-format an atomic integer.
 *
 * `txRefs` carries `{ chainId, ref }` pairs (never a URL) bounded to 4 (a
 * multi-hop bridge can have more than one linkable hash) — the renderer
 * builds the actual explorer URL via `shared/explorer-links.ts`, which stays
 * the single allow-listed source of truth for external hosts.
 */

import { z } from "zod";
import { familyForChainId } from "../chains/display.js";
import { evmAddressSchema } from "./wallets.js";

// Solana base58 shape — mirrors `wallets/base-chain.ts`'s PRIVATE
// `solanaAddressSchema` (deliberately not re-exported by the `wallets.js`
// barrel) and `portfolio.ts`'s own local pattern, which documents the same
// "mirror, don't reach past the barrel" precedent for the identical reason.
const SOLANA_TOKEN_ADDRESS_PATTERN = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

const AMOUNT_MAX_LENGTH = 96;
const USD_MAX_LENGTH = 32;
const CHAIN_DISPLAY_MAX_LENGTH = 64;
const REF_MAX_LENGTH = 128;

/** Server-side page cap. Shared by the SQL LIMIT and this schema's `.max(...)`. */
export const TOKEN_HISTORY_PAGE_SIZE = 50;

/** Cap on the displayed open-lots list (totals still cover every matching lot). */
export const TOKEN_HISTORY_OPEN_LOTS_MAX = 50;

// ── Cursor ──────────────────────────────────────────────────────────────

export const tokenHistoryCursorSchema = z
  .object({
    createdAt: z.string().datetime({ offset: true, precision: 6 }),
    sourceRank: z.union([z.literal(0), z.literal(1)]),
    sourceId: z.string().min(1).max(64),
  })
  .strict();
export type TokenHistoryCursor = z.infer<typeof tokenHistoryCursorSchema>;

// ── Input ───────────────────────────────────────────────────────────────

export const tokenHistoryReadInputSchema = z
  .object({
    chainId: z.number().int(),
    tokenAddress: z.string().min(1).max(128),
    cursor: tokenHistoryCursorSchema.nullable(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const family = familyForChainId(value.chainId);
    const valid =
      family === "solana"
        ? SOLANA_TOKEN_ADDRESS_PATTERN.test(value.tokenAddress)
        : evmAddressSchema.safeParse(value.tokenAddress).success;
    if (!valid) {
      ctx.addIssue({
        code: "custom",
        message: "Invalid token address for this chain family.",
        path: ["tokenAddress"],
      });
    }
  })
  .transform((value) => ({
    ...value,
    tokenAddress:
      familyForChainId(value.chainId) === "evm"
        ? value.tokenAddress.toLowerCase()
        : value.tokenAddress,
  }));
export type TokenHistoryReadInput = z.infer<typeof tokenHistoryReadInputSchema>;

// ── Shared entry pieces ───────────────────────────────────────────────────

/**
 * One quantity value with its proof-of-unit tag. `value: null` means the
 * underlying column was absent; a non-null value with `unitProvenance:
 * "atomic"` or `"unknown"` is NOT display-ready — only `"human"` is.
 */
const amountFieldSchema = z
  .object({
    value: z.string().max(AMOUNT_MAX_LENGTH).nullable(),
    unitProvenance: z.enum(["human", "atomic", "unknown"]),
  })
  .strict();
export type AmountField = z.infer<typeof amountFieldSchema>;

/** USD figure as a decimal string; `null` means unpriced (never a fabricated 0). */
const usdValueSchema = z.string().max(USD_MAX_LENGTH).nullable();

/**
 * On-chain reference for one hop. `ref` is a tx hash (EVM) or signature
 * (Solana) — never a URL; the renderer resolves the explorer link itself.
 */
const txRefSchema = z
  .object({
    chainId: z.number().int(),
    ref: z.string().min(1).max(REF_MAX_LENGTH),
  })
  .strict();
export type TokenHistoryTxRef = z.infer<typeof txRefSchema>;

const txRefsSchema = z.array(txRefSchema).max(4);

/** One swap/bridge leg — token identity (untrusted display metadata) + amount + USD. */
const tokenLegSchema = z
  .object({
    /** Raw effective token identity as recorded (address or symbol) — internal use only, never rendered raw. */
    token: z.string().max(REF_MAX_LENGTH).nullable(),
    /** Sanitized captured symbol — display-only, untrusted (see `token-symbol-sanitizer.ts`). */
    symbol: z.string().max(64).nullable(),
    /** Sanitized wallet-local fallback symbol (same untrust posture). */
    localSymbol: z.string().max(64).nullable(),
    amount: amountFieldSchema,
    valueUsd: usdValueSchema,
  })
  .strict();

// ── Entries ───────────────────────────────────────────────────────────────

const swapEntrySchema = z
  .object({
    kind: z.literal("swap"),
    id: z.string().min(1).max(64),
    createdAt: z.string().datetime({ offset: true }),
    chain: z.string().max(CHAIN_DISPLAY_MAX_LENGTH),
    venue: z.string().max(CHAIN_DISPLAY_MAX_LENGTH).nullable(),
    tradeSide: z.string().max(16).nullable(),
    productType: z.string().max(32).nullable(),
    input: tokenLegSchema,
    output: tokenLegSchema,
    unitPriceUsd: usdValueSchema,
    captureStatus: z.string().max(32).nullable(),
    txRefs: txRefsSchema,
  })
  .strict();

const bridgeEntrySchema = z
  .object({
    kind: z.literal("bridge"),
    id: z.string().min(1).max(64),
    createdAt: z.string().datetime({ offset: true }),
    /** Origin chain (`proj_activity.chain` — bridges record the SOURCE chain here). */
    originChain: z.string().max(CHAIN_DISPLAY_MAX_LENGTH),
    /** Destination chain, when the capture recorded one (`meta.destChain`); `null` if absent. */
    destinationChain: z.string().max(CHAIN_DISPLAY_MAX_LENGTH).nullable(),
    venue: z.string().max(CHAIN_DISPLAY_MAX_LENGTH).nullable(),
    input: tokenLegSchema,
    output: tokenLegSchema,
    captureStatus: z.string().max(32).nullable(),
    txRefs: txRefsSchema,
  })
  .strict();

const transferEntrySchema = z
  .object({
    kind: z.literal("transfer"),
    id: z.string().min(1).max(64),
    createdAt: z.string().datetime({ offset: true }),
    /** `wallet_intents.chain_alias` — free-text, model-supplied; display only. */
    chain: z.string().max(CHAIN_DISPLAY_MAX_LENGTH).nullable(),
    toAddress: z.string().max(REF_MAX_LENGTH),
    amount: amountFieldSchema,
    /** The matched token identity — always the caller's own validated `tokenAddress` (matched by address). */
    token: z.string().max(REF_MAX_LENGTH).nullable(),
    status: z.string().max(32),
    txRefs: txRefsSchema,
  })
  .strict();

export const tokenHistoryEntrySchema = z.discriminatedUnion("kind", [
  swapEntrySchema,
  bridgeEntrySchema,
  transferEntrySchema,
]);
export type TokenHistoryEntry = z.infer<typeof tokenHistoryEntrySchema>;

// ── Cost basis ────────────────────────────────────────────────────────────

const openLotSchema = z
  .object({
    /** Remaining lot quantity — always raw atomic (base-unit) integer text. */
    quantity: amountFieldSchema,
    priceUsd: usdValueSchema,
    /** Prorated remaining cost basis (original × remaining/original qty). */
    costBasisUsd: usdValueSchema,
    openedAt: z.string().datetime({ offset: true }),
  })
  .strict();

/**
 * `"lots"` — at least one matching open/partial lot; `"none"` — the query
 * ran fine and found zero open lots for this token (fully sold, or never
 * bought via a tracked spot trade); `"unavailable"` — the cost-basis phase
 * could not be verified (timeout or a defect) — distinct from `"none"` so
 * the UI never states "no cost basis" when it actually could not check.
 */
export const costBasisSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("lots"),
      openLots: z.array(openLotSchema).max(TOKEN_HISTORY_OPEN_LOTS_MAX),
      totalOpenQuantity: z.string().max(AMOUNT_MAX_LENGTH),
      avgOpenPriceUsd: usdValueSchema,
    })
    .strict(),
  z.object({ kind: z.literal("none") }).strict(),
  z.object({ kind: z.literal("unavailable") }).strict(),
]);
export type TokenHistoryCostBasis = z.infer<typeof costBasisSchema>;

// ── Output ────────────────────────────────────────────────────────────────

const tokenHistoryPageSchema = z
  .object({
    status: z.literal("available"),
    entries: z.array(tokenHistoryEntrySchema).max(TOKEN_HISTORY_PAGE_SIZE),
    nextCursor: tokenHistoryCursorSchema.nullable(),
    hasMore: z.boolean(),
    costBasis: costBasisSchema,
  })
  .strict();

const tokenHistoryUnavailableSchema = z
  .object({
    status: z.literal("unavailable"),
    reason: z.literal("query_timeout"),
  })
  .strict();

export const tokenHistoryDtoSchema = z.discriminatedUnion("status", [
  tokenHistoryPageSchema,
  tokenHistoryUnavailableSchema,
]);
export type TokenHistoryDto = z.infer<typeof tokenHistoryDtoSchema>;
