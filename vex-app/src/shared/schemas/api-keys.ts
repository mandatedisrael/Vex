/**
 * Schemas for `vex.onboarding.apiKeysSet` (M9 Step 3).
 *
 * Field set:
 *   - JUPITER_API_KEY (optional in input — user may already have it
 *     set via vex-shell; the wizard's Step-3 skip-card uses the
 *     envState `apiKeys.jupiterConfigured` boolean to decide whether
 *     to show the form at all).
 *   - TAVILY_API_KEY (optional)
 *   - RETTIWT_API_KEY (optional)
 *   - polymarket: object holding all 3 polymarket keys; ALL OR NONE
 *     (Zod `strict()` + presence check at refine; matches engine's
 *     `requirePolyClobCredentials()` invariant in
 *     `src/tools/polymarket/auth.ts`).
 */

import { z } from "zod";

const optionalSecret = z.string().min(1).optional();

const polymarketTrioSchema = z
  .object({
    apiKey: z.string().min(1),
    apiSecret: z.string().min(1),
    passphrase: z.string().min(1),
  })
  .strict();

export type PolymarketTrioInput = z.infer<typeof polymarketTrioSchema>;

export const apiKeysSetInputSchema = z
  .object({
    jupiterApiKey: optionalSecret,
    tavilyApiKey: optionalSecret,
    rettiwtApiKey: optionalSecret,
    polymarket: polymarketTrioSchema.optional(),
  })
  .strict();

export type ApiKeysSetInput = z.infer<typeof apiKeysSetInputSchema>;

/**
 * Canonical .env key names that may appear in `fieldsWritten` — order
 * matches the deterministic write order in `api-keys-writer.ts`.
 */
export const API_KEYS_CANONICAL_ORDER = [
  "JUPITER_API_KEY",
  "TAVILY_API_KEY",
  "RETTIWT_API_KEY",
  "POLYMARKET_API_KEY",
  "POLYMARKET_API_SECRET",
  "POLYMARKET_PASSPHRASE",
] as const;

export const apiKeysFieldNameSchema = z.enum(API_KEYS_CANONICAL_ORDER);

export const apiKeysSetResultSchema = z
  .object({
    fieldsWritten: z.array(apiKeysFieldNameSchema).readonly(),
  })
  .strict();

export type ApiKeysSetResult = z.infer<typeof apiKeysSetResultSchema>;

/**
 * Polymarket aggregate state surfaced via envState. Matches the
 * 3-state truth: nothing set, partial (some but not all 3 → engine
 * would throw), all set (engine can authenticate). Renderer uses
 * "partial" to render the Repair CTA without blocking Step 3 skip.
 */
export const polymarketStatusSchema = z.enum(["missing", "partial", "configured"]);
export type PolymarketStatus = z.infer<typeof polymarketStatusSchema>;
