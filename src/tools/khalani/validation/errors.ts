/**
 * Khalani error-body parser + Solana address heuristic (codex-002 Phase 2).
 *
 * `parseKhalaniErrorBody` is the lenient (never-throw) error-body validator;
 * `isSolanaAddressLike` is the base58 address heuristic. Both are imported by
 * the Khalani client/helpers, so they stay on the public barrel. Moved verbatim
 * from `validation.ts`.
 */

import { z } from "zod";
import type { KhalaniErrorBody } from "../types.js";
import { isRecordValue } from "./_shared.js";

// ---------------------------------------------------------------------------
// Error body (lenient: null on bad input)
// ---------------------------------------------------------------------------

export function parseKhalaniErrorBody(raw: unknown): KhalaniErrorBody | null {
  const result = z
    .unknown()
    .transform((v): KhalaniErrorBody | null => {
      if (!isRecordValue(v)) return null;
      if (typeof v.message !== "string" || typeof v.name !== "string") return null;
      return {
        message: v.message,
        name: v.name,
        details:
          Array.isArray(v.details) || isRecordValue(v.details)
            ? (v.details as KhalaniErrorBody["details"])
            : undefined,
      };
    })
    .safeParse(raw);
  // The transform never fails, so success is always true.
  return result.success ? result.data : null;
}

export function isSolanaAddressLike(value: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value);
}
