/**
 * Provider-safe error normalization/redaction (B-003) for the protocol runtime.
 *
 * Extracted verbatim from `../runtime.ts` as part of a façade-preserving
 * structural split. A thrown handler/provider/SDK error can embed URLs,
 * request/response bodies, auth headers, and key material — none of which may
 * reach the tool output, the structured logs, or the renderer. This module is
 * the single owner of that redaction.
 */

import { redact } from "@vex-agent/memory/redaction.js";

// ── Provider-safe error summarisation (B-003) ────────────────────
//
// A thrown handler error (or any provider/SDK error) can embed URLs, request /
// response bodies, auth headers, and key material. NONE of that may reach the
// tool output, the structured logs, or (downstream) the renderer. We emit ONLY:
//   - a coarse cause CATEGORY (transient vs permanent classification signal),
//   - a bounded message that has been run through the secret redactor AND
//     stripped of URLs, then length-capped.
// The original error is never logged or returned verbatim.

export type ErrorCategory =
  | "timeout"
  | "network"
  | "rate_limit"
  | "auth"
  | "provider_error"
  | "unknown";

export interface SafeErrorSummary {
  readonly category: ErrorCategory;
  readonly message: string;
}

const MAX_SAFE_ERROR_MESSAGE = 200;

// Structured/sensitive fragments stripped from the message BEFORE it is
// surfaced anywhere. These cover the provider/SDK internals the B-003 note
// forbids emitting (URLs, request/response bodies, auth) while leaving short
// human-readable error phrases (e.g. "network down") intact. Each replaces the
// offending span with a coarse placeholder rather than deleting it, so the
// summary still signals "an internal was removed here".
const SENSITIVE_FRAGMENT_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  // URLs — provider endpoints often carry tokens/ids in path or query.
  [/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, "[url]"],
  // Brace- or bracket-delimited bodies (JSON request/response payloads).
  [/[{[][^{}[\]]*[}\]]/g, "[body]"],
  // Auth headers + key/secret/token assignments (header: value OR key=value).
  [/\b(authorization|proxy-authorization|cookie|set-cookie)\s*[:=]\s*\S+/gi, "[auth]"],
  [/\bbearer\s+\S+/gi, "[auth]"],
  [/\b(api[_-]?key|apikey|access[_-]?token|secret|password|passwd|pwd|token|key)\s*[:=]\s*\S+/gi, "[auth]"],
];

/** Coarse, non-sensitive classification from the error's shape/text. */
export function classifyError(raw: string, err: unknown): ErrorCategory {
  const name = err instanceof Error ? err.name.toLowerCase() : "";
  const text = raw.toLowerCase();
  if (name.includes("abort") || text.includes("timeout") || text.includes("timed out")) {
    return "timeout";
  }
  if (text.includes("rate limit") || text.includes("429") || text.includes("too many requests")) {
    return "rate_limit";
  }
  if (text.includes("unauthorized") || text.includes("forbidden") || text.includes("401") || text.includes("403")) {
    return "auth";
  }
  if (
    name.includes("fetch")
    || text.includes("econn")
    || text.includes("enotfound")
    || text.includes("network")
    || text.includes("socket")
  ) {
    return "network";
  }
  if (err instanceof Error) return "provider_error";
  return "unknown";
}

/**
 * Reduce any thrown value to a `{ category, message }` summary that is safe to
 * log, return to the agent, and forward to the renderer. Bounded + redacted.
 */
export function summarizeProtocolError(err: unknown): SafeErrorSummary {
  const raw = err instanceof Error ? err.message : String(err);
  const category = classifyError(raw, err);

  // Defense-in-depth, applied in order:
  //  1. redact known SECRET shapes (keys, JWTs, mnemonics, addresses),
  //  2. strip structured provider INTERNALS (URLs, bodies, auth) the B-003 note
  //     forbids emitting — placeholder-replaced, not just secret-matched,
  //  3. collapse whitespace and hard-cap the length.
  // We never trust the provider not to embed internals, so we keep only this
  // bounded summary regardless of what the raw text contained.
  let cleaned = redact(raw).text;
  for (const [pattern, replacement] of SENSITIVE_FRAGMENT_PATTERNS) {
    cleaned = cleaned.replace(pattern, replacement);
  }
  cleaned = cleaned.replace(/\s+/g, " ").trim();
  const bounded = cleaned.length > MAX_SAFE_ERROR_MESSAGE
    ? `${cleaned.slice(0, MAX_SAFE_ERROR_MESSAGE)}…`
    : cleaned;

  return { category, message: bounded || category };
}
