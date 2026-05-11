/**
 * Schemas for `vex.onboarding.embeddingConfigure` (M9 Step 4).
 *
 * Field set + ranges match engine's `loadEmbeddingConfig()` in
 * `src/vex-agent/embeddings/config.ts`. URL refine is stricter than
 * the engine's `startsWith("http")` check — GUI rejects malformed,
 * missing-hostname, and credential-bearing URLs as defense-in-depth.
 */

import { z } from "zod";
import {
  MAX_EMBEDDING_DIM,
  MIN_EMBEDDING_DIM,
} from "@vex-lib/embedding-constants.js";

function isValidEmbeddingUrl(raw: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  if (parsed.hostname.length === 0) return false;
  // Reject userinfo (credentials embedded in URL) — strictly safer
  // than the engine's startsWith check.
  if (parsed.username.length > 0 || parsed.password.length > 0) return false;
  return true;
}

export const embeddingConfigureInputSchema = z
  .object({
    baseUrl: z
      .string()
      .min(1)
      .refine(
        isValidEmbeddingUrl,
        "Must be a valid http(s):// URL with a hostname and no embedded credentials.",
      ),
    model: z.string().min(1),
    dim: z.number().int().min(MIN_EMBEDDING_DIM).max(MAX_EMBEDDING_DIM),
    provider: z.string().min(1),
  })
  .strict();

export type EmbeddingConfigureInput = z.infer<typeof embeddingConfigureInputSchema>;

export const embeddingConfigureResultSchema = z
  .object({
    written: z.literal(true),
    dimChanged: z.boolean(),
  })
  .strict();

export type EmbeddingConfigureResult = z.infer<typeof embeddingConfigureResultSchema>;
