/**
 * Portfolio schemas — read-only dual-scope POSITION portfolio (stage 3).
 *
 * The renderer asks for either the GLOBAL inventory portfolio
 * (`{ scope: "global" }`) or a single session's wallet-scope portfolio
 * (`{ scope: "session", sessionId }`). It NEVER supplies a wallet address —
 * main resolves the concrete address allow-list server-side (config
 * inventory for global, the session's wallet scope for session) so the
 * renderer can never widen the read past its own wallets.
 *
 * The discriminated union is the security boundary: a `session` request
 * without a valid `sessionId` is rejected at the `.strict()` parse and
 * MUST NEVER silently fall back to the (broader) global scope.
 *
 * DTO maps `proj_balances` (live per-token USD) + `proj_portfolio_snapshots`
 * (most recent complete snapshot group for the exact address set). All USD
 * figures are JS numbers coerced from `NUMERIC` columns; `chainId` tolerates
 * a `BIGINT` chain id that overflows the JS safe-integer range via `Number()`
 * (no value is fabricated — `null` when absent/unparseable).
 */

import { z } from "zod";

/**
 * IPC input for `vex.portfolio.read`. Discriminated on `scope`:
 *  - `global`  — no `sessionId`; aggregates the whole configured inventory.
 *  - `session` — requires a UUID `sessionId`; aggregates only that
 *    session's selected wallets.
 *
 * `.strict()` on each member rejects a stray `sessionId` on a global
 * request and a missing/invalid `sessionId` on a session request, so a
 * malformed session input can never silently widen to global.
 */
export const portfolioReadInputSchema = z.discriminatedUnion("scope", [
  z.object({ scope: z.literal("global") }).strict(),
  z.object({ scope: z.literal("session"), sessionId: z.string().uuid() }).strict(),
]);
export type PortfolioReadInput = z.infer<typeof portfolioReadInputSchema>;

/**
 * One aggregated position line — a single (chain, token) bucket summed
 * across every wallet in the resolved allow-list. `chainId` is `null` when
 * the DB chain id is absent or could not be coerced to a finite JS number;
 * `symbol` is `null` for rows without a token symbol. `balanceUsd` is a
 * finite JS number (the SQL `COALESCE(SUM(...),0)::float8` guarantees a
 * value, never `null`).
 */
export const positionTokenDtoSchema = z
  .object({
    chainId: z.number().nullable(),
    symbol: z.string().max(64).nullable(),
    balanceUsd: z.number(),
  })
  .strict();
export type PositionTokenDto = z.infer<typeof positionTokenDtoSchema>;

/**
 * One token line inside a per-chain breakdown — like `positionTokenDtoSchema`
 * but WITHOUT `chainId` (the parent chain carries it) and guaranteed a
 * strictly positive USD figure by the purpose-built breakdown query.
 */
export const chainTokenDtoSchema = z
  .object({
    symbol: z.string().max(64).nullable(),
    balanceUsd: z.number().positive(),
  })
  .strict();
export type ChainTokenDto = z.infer<typeof chainTokenDtoSchema>;

/**
 * Per-chain position breakdown (the POSITION chain switcher's data source).
 * Built by a PURPOSE-BUILT query (window function over the full balance set —
 * NOT a post-process of the capped flat `tokens` list, which is bounded at
 * 500 rows and could silently drop chains). Invariants by construction:
 *
 *  - only chains with a strictly positive `totalUsd` appear ("see more"
 *    lists only chains with balance > $0);
 *  - `tokens` holds that chain's top holdings by USD, max 3, each > $0;
 *  - rows with a NULL `chain_id` stay in the legacy flat `tokens` field
 *    only — they can't be attributed to a chain switcher entry;
 *  - `family` derives from the chain id (the Khalani synthetic Solana id
 *    vs everything-else-EVM, see `@shared/chains/display.js`).
 */
export const positionChainDtoSchema = z
  .object({
    chainId: z.number(),
    family: z.enum(["evm", "solana"]),
    totalUsd: z.number().positive(),
    tokens: z.array(chainTokenDtoSchema).max(3),
  })
  .strict();
export type PositionChainDto = z.infer<typeof positionChainDtoSchema>;

/**
 * Portfolio read result for one scope.
 *
 *  - `walletCount`     — number of resolved addresses in the allow-list
 *                        (0 → empty portfolio returned BEFORE any SQL).
 *  - `liveTotalUsd`    — current summed USD across `proj_balances` for the
 *                        resolved addresses (0 when no balance rows).
 *  - `snapshotTotalUsd`/`pnlVsPrev`/`snapshotAt` — the most recent COMPLETE
 *                        snapshot group covering exactly the resolved address
 *                        set; all `null` when no such snapshot exists.
 *  - `tokens`          — per-(chain,token) live USD lines, newest USD first,
 *                        capped at 500 (defensive bound, never expected to hit).
 *                        UNCHANGED legacy field — additive evolution only.
 *  - `chains`          — per-chain breakdown for the chain switcher: positive
 *                        totals only, top-3 tokens each, bounded at 64 chains.
 */
export const portfolioDtoSchema = z
  .object({
    scope: z.enum(["global", "session"]),
    walletCount: z.number().int().nonnegative(),
    liveTotalUsd: z.number(),
    snapshotTotalUsd: z.number().nullable(),
    pnlVsPrev: z.number().nullable(),
    snapshotAt: z.string().datetime({ offset: true }).nullable(),
    tokens: z.array(positionTokenDtoSchema).max(500),
    chains: z.array(positionChainDtoSchema).max(64),
  })
  .strict();
export type PortfolioDto = z.infer<typeof portfolioDtoSchema>;
