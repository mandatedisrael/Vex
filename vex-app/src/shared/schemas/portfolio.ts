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
  })
  .strict();
export type PortfolioDto = z.infer<typeof portfolioDtoSchema>;
