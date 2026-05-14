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
import { PASSWORD_MIN_LENGTH } from "./secrets.js";
import { evmAddressSchema } from "./wallets.js";

const optionalSecret = z.string().min(1).optional();

const polymarketTrioSchema = z
  .object({
    apiKey: z.string().min(1),
    apiSecret: z.string().min(1),
    passphrase: z.string().min(1),
  })
  .strict();

export type PolymarketTrioInput = z.infer<typeof polymarketTrioSchema>;

/**
 * Renderer-side input shape for the manual Polymarket trio (three text
 * inputs that the user may have filled in fully, partly, or not at all).
 * Values are POST-trim — empty strings mean "not filled".
 */
export interface PolymarketManualTrioInput {
  readonly apiKey: string;
  readonly apiSecret: string;
  readonly passphrase: string;
}

export type PolymarketManualTrioStatus = "empty" | "complete" | "partial";

export interface PolymarketManualTrioResult {
  readonly kind: PolymarketManualTrioStatus;
  /**
   * Names of the missing fields when `kind === "partial"`. Names match the
   * key in `PolymarketManualTrioInput` so the caller can localise / highlight
   * exactly the right inputs.
   */
  readonly missing: ReadonlyArray<keyof PolymarketManualTrioInput>;
}

/**
 * Pure helper for the renderer to classify whether the user filled the
 * manual Polymarket trio. Does NOT relax the boundary contract — the IPC
 * schema (`apiKeysSetInputSchema.polymarket`) still demands a complete
 * trio when present; this helper just lets the renderer surface a clear
 * UX message before submit.
 */
export function validatePolymarketManualTrio(
  input: PolymarketManualTrioInput,
): PolymarketManualTrioResult {
  const present = {
    apiKey: input.apiKey.length > 0,
    apiSecret: input.apiSecret.length > 0,
    passphrase: input.passphrase.length > 0,
  } as const;
  const filled = Object.values(present).filter(Boolean).length;
  if (filled === 0) return { kind: "empty", missing: [] };
  if (filled === 3) return { kind: "complete", missing: [] };
  const missing: Array<keyof PolymarketManualTrioInput> = [];
  if (!present.apiKey) missing.push("apiKey");
  if (!present.apiSecret) missing.push("apiSecret");
  if (!present.passphrase) missing.push("passphrase");
  return { kind: "partial", missing };
}

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

// ── Polymarket one-click auto-setup (Phase 2 feature #7) ──────────────────
//
// Derives Polymarket CLOB API credentials from the unlocked EVM wallet
// keystore and persists them inside the encrypted secret vault. Public
// surface mirrors `walletExportPrivateKey`:
//   - `password` re-auths the vault (sudo-style; no session mutation)
//   - `riskAcknowledged: true` is a hard literal so an accidental
//     auto-tick or missing checkbox cannot reach the network/disk path.
//   - `overwriteConfirmed` is a renderer-controlled boolean that must be
//     true when the trio is already present. The handler re-checks under
//     the env-write lock to close the TOCTOU race between the pre-network
//     presence probe and the vault write.
//
// Result deliberately does NOT carry `apiKeyPrefix` (or any preview of
// the secret material) — logging contracts forbid prefix previews even
// when redacted. The renderer surfaces "Configured" + the address, then
// reads canonical names via envState.
export const polymarketAutoSetupInputSchema = z
  .object({
    password: z.string().min(PASSWORD_MIN_LENGTH),
    riskAcknowledged: z.literal(true),
    overwriteConfirmed: z.boolean().default(false),
  })
  .strict();
export type PolymarketAutoSetupInput = z.infer<
  typeof polymarketAutoSetupInputSchema
>;

export const polymarketAutoSetupResultSchema = z
  .object({
    configured: z.literal(true),
    address: evmAddressSchema,
  })
  .strict();
export type PolymarketAutoSetupResult = z.infer<
  typeof polymarketAutoSetupResultSchema
>;
