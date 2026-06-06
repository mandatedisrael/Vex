/**
 * Jupiter Prediction `vault` response schemas (codex-002).
 */

import { z } from "zod";

// ── Vault ──────────────────────────────────────────────────────────

export const jupiterPredictionVaultInfoResponseSchema = z
  .object({
    pubkey: z.string(),
    data: z.record(z.string(), z.string()),
    vaultBalance: z.string(),
  })
  .passthrough();
