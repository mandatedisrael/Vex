/**
 * Error-shape validation and normalisation for the IPC handler harness
 * (defense-in-depth). Catches handlers that produce a malformed
 * `{ ok: false, error }` literal — missing required fields, extra fields
 * that might leak secrets, or out-of-range enum values — and replaces
 * them with a redacted contract-violation error before they cross the
 * boundary.
 *
 * Single-source of the closed-by-convention enum sets (ERROR_CODE_SET /
 * DOMAIN_SET) and the allow-list of valid error keys (VALID_ERROR_KEYS).
 */

import {
  VEX_DOMAINS,
  VEX_ERROR_CODES,
  type VexDomain,
  type VexError,
  type VexErrorCode,
} from "@shared/ipc/result.js";

const ERROR_CODE_SET: ReadonlySet<string> = new Set(VEX_ERROR_CODES);
const DOMAIN_SET: ReadonlySet<string> = new Set(VEX_DOMAINS);

const STRUCTURAL_KEYS_LIMIT = 16;

/**
 * Best-effort structural summary of an unknown thrown/returned value.
 * Used in error logs so we never echo the raw object (which may contain a
 * secret if a handler returned the wrong shape).
 */
export function summarizeUnknown(value: unknown): {
  readonly type: string;
  readonly keys: ReadonlyArray<string>;
  readonly truncated: boolean;
} {
  if (value === null) return { type: "null", keys: [], truncated: false };
  if (value instanceof Error) {
    return { type: `Error:${value.name}`, keys: [], truncated: false };
  }
  const type = typeof value;
  if (type === "object") {
    const allKeys = Object.keys(value as object);
    return {
      type: "object",
      keys: allKeys.slice(0, STRUCTURAL_KEYS_LIMIT),
      truncated: allKeys.length > STRUCTURAL_KEYS_LIMIT,
    };
  }
  return { type, keys: [], truncated: false };
}

const VALID_ERROR_KEYS = new Set([
  "code",
  "domain",
  "message",
  "retryable",
  "userActionable",
  "redacted",
  "details",
  "correlationId",
  "retryAfterMs",
]);

/**
 * Runtime guard for the VexError shape. Catches handlers that returned a raw
 * object literal that LOOKS like an error but is missing required fields, or
 * that has extra fields (which might leak secrets through unredacted paths).
 * `code` and `domain` are validated against `VEX_ERROR_CODES` / `VEX_DOMAINS`
 * (runtime mirrors of the type unions; kept in sync via the type-level
 * exhaustiveness assertions at the bottom of result.ts).
 */
export function isValidVexErrorShape(value: unknown): value is Omit<VexError, "correlationId"> & { correlationId?: string } {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  // Closed-by-convention enums are validated at runtime here so a handler
  // typo doesn't escape into the public surface.
  if (typeof v["code"] !== "string" || !ERROR_CODE_SET.has(v["code"])) return false;
  if (typeof v["domain"] !== "string" || !DOMAIN_SET.has(v["domain"])) return false;
  if (typeof v["message"] !== "string") return false;
  if (typeof v["retryable"] !== "boolean") return false;
  if (typeof v["userActionable"] !== "boolean") return false;
  if (v["redacted"] !== true) return false;
  // correlationId optional at validation time — auto-filled below from
  // ctx.requestId. If present, it must still be a non-empty string.
  if ("correlationId" in v) {
    if (typeof v["correlationId"] !== "string" || v["correlationId"].length === 0) {
      return false;
    }
  }
  // Optional fields: shape-check when present so leaked exotic values
  // (e.g. functions, BigInts) can't slip through the boundary.
  if ("retryAfterMs" in v) {
    const r = v["retryAfterMs"];
    if (typeof r !== "number" || !Number.isFinite(r) || r < 0) return false;
  }
  if ("details" in v) {
    const d = v["details"];
    if (d === null || typeof d !== "object" || Array.isArray(d)) return false;
  }
  // Reject foreign keys — they may carry leaked secrets through a path the
  // redactor hasn't been taught about.
  for (const key of Object.keys(v)) {
    if (!VALID_ERROR_KEYS.has(key)) return false;
  }
  return true;
}

export function contractViolation(
  domain: VexDomain,
  correlationId: string,
  code: VexErrorCode = "internal.contract_violation",
): VexError {
  return {
    code,
    domain,
    message: "Internal error.",
    retryable: false,
    userActionable: false,
    redacted: true,
    correlationId,
  };
}
