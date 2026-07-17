/**
 * Phase 4d — STRICT transient-vs-permanent classifier for mission auto-retry.
 *
 * Conservative by construction: only errors that are CLEARLY transient
 * provider/runtime failures (429, 5xx, request timeout, socket/network reset)
 * are `"transient"`. EVERYTHING else — 4xx incl. 401/403/404/422, validation,
 * contract, business, malformed-response, user-abort, and anything
 * unrecognized — is `"permanent"`, so the run pauses for a human instead of
 * auto-retrying.
 *
 * This is the OPPOSITE default from the inference client's `isRetryableError`
 * (which optimises for retrying its own calls and defaults to retry). The
 * mission layer must never auto-retry on uncertainty: the safety stamp is the
 * double-spend gate, and this classifier is the second, independent line —
 * both must say "yes" before a run auto-retries.
 *
 * Note the layering: the OpenRouter SDK only retries 5XX internally by default
 * (`retryCodes: ['5XX']`); 429 is NOT retried by the SDK and is owned by this
 * mission auto-retry layer. `normalizeOpenRouterError` attaches the HTTP status
 * as a lean `statusCode`/`status` own-property, and the errno-shaped transport
 * cause code as a lean `causeCode` own-property (never `.code` — normalization
 * never sets it), on the error it throws. Classification below reads BOTH
 * exclusively from these own-properties (via `readMissionErrorSignal`) —
 * never from `err.message` — so a scrubbed/redacted message can never change
 * the auto-retry decision.
 */

import { readMissionErrorSignal } from "./mission-error-signal.js";

export type MissionErrorClass = "transient" | "permanent";

/**
 * Socket / DNS / connection-reset errors — transient by nature. Checked
 * against the RAW `.code` own-property (a direct Node/undici throw that never
 * passed through the OpenRouter normalizer).
 */
const TRANSIENT_NODE_CODES: ReadonlySet<string> = new Set([
  "ETIMEDOUT",
  "ECONNRESET",
  "ECONNREFUSED",
  "EAI_AGAIN",
  "EPIPE",
]);

/**
 * Transient allow-list checked against the normalizer's `causeCode`
 * own-property — the ONLY transport signal a normalized OpenRouter error
 * carries, since normalization never sets `.code`. Superset of
 * `TRANSIENT_NODE_CODES` plus undici transport timeout/socket codes.
 */
const TRANSIENT_CAUSE_CODES: ReadonlySet<string> = new Set([
  ...TRANSIENT_NODE_CODES,
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
  "UND_ERR_SOCKET",
]);

/**
 * NEVER transient, regardless of any allow-list match above — checked BEFORE
 * the `retryable` marker fallback so a (possibly wrong) `retryable:true`
 * stamped by some other mapper can never promote one of these into an
 * auto-retry. Checked against both `.code` and `.causeCode`.
 *   - `ABORT_ERR` / `UND_ERR_ABORTED`: the normalizer erases `err.name` (see
 *     `openrouter/errors.ts`), so this allow-list is the ONLY remaining
 *     defense against auto-retrying an operator stop once a normalized error
 *     is in play.
 *   - `ENOTFOUND`: DNS resolution failure — retrying the same host wastes the
 *     backoff budget on a name that will not resolve.
 *   - `UND_ERR_CLOSED`: the connection was intentionally closed, not dropped.
 *   - TLS verification codes: a certificate problem does not self-heal on
 *     retry (same set `inference/openrouter.ts` uses for its
 *     `api_unreachable` hint selection — duplicated here, not imported, to
 *     avoid coupling the classifier to a specific provider module).
 */
const NEVER_TRANSIENT_CODES: ReadonlySet<string> = new Set([
  "ABORT_ERR",
  "UND_ERR_ABORTED",
  "ENOTFOUND",
  "UND_ERR_CLOSED",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "CERT_HAS_EXPIRED",
]);

/** VexError codes that represent a transient request-level failure. */
const TRANSIENT_VEX_CODES: ReadonlySet<string> = new Set(["HTTP_TIMEOUT"]);

function isTransientStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599);
}

/**
 * Classify a thrown error for mission auto-retry. `unknown` in (catch clauses
 * see `unknown`); defaults to `"permanent"` for any non-Error or unrecognized
 * shape.
 */
export function classifyMissionRunError(err: unknown): MissionErrorClass {
  if (!(err instanceof Error)) return "permanent";

  const signal = readMissionErrorSignal(err);

  // A genuine request timeout is transient even if it surfaces as an AbortError
  // (millisecond-timer abort) — check the explicit timeout code FIRST so it is
  // not swallowed by the user-abort / hard-exclusion guards below.
  if (signal.code !== null && TRANSIENT_VEX_CODES.has(signal.code)) return "transient";

  // Any other abort (notably a user stop) is never auto-retried. Only catches
  // RAW (non-normalized) abort errors that still carry their original `.name`
  // — the hard-exclusion check below is what catches normalized ones (whose
  // `.name` the normalizer erases).
  if (err.name === "AbortError") return "permanent";

  // Hard exclusions — see NEVER_TRANSIENT_CODES doc above.
  if (
    (signal.code !== null && NEVER_TRANSIENT_CODES.has(signal.code)) ||
    (signal.causeCode !== null && NEVER_TRANSIENT_CODES.has(signal.causeCode))
  ) {
    return "permanent";
  }

  // HTTP status is authoritative and beats a (possibly contradictory) retryable
  // marker: a 401/403/404/422 stays permanent even if some mapper set
  // retryable:true. Only 429 + 5xx are transient.
  if (signal.status !== null) return isTransientStatus(signal.status) ? "transient" : "permanent";

  // No status — honor an explicit transient marker from a mapper
  // (Khalani/DexScreener set this on 429/5xx they couldn't tag with a status).
  if (signal.retryable === true) return "transient";

  // Socket / connection-level transient errors (raw `.code`).
  if (signal.code !== null && TRANSIENT_NODE_CODES.has(signal.code)) return "transient";

  // Transient causeCode (normalizer-attached, own-property).
  if (signal.causeCode !== null && TRANSIENT_CAUSE_CODES.has(signal.causeCode)) return "transient";

  // Unknown shape → conservative permanent (never auto-retry on uncertainty).
  return "permanent";
}
