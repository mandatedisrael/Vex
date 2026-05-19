/**
 * Composite diagnostic redactor for bug-report payloads.
 *
 * Layers:
 *   1. Key-name redaction — fields whose name matches `SENSITIVE_KEY_RE`
 *      (password, mnemonic, seed, private_key, secret, token, api_key,
 *      signature, jwt, etc.) are replaced with `[REDACTED]` regardless of
 *      their value. Mirrors the wrapper in
 *      vex-app/src/main/logger/redact.ts so support payloads honour the
 *      same key-name allowlist the file logger does.
 *   2. Two-tier text scrubbing on every string leaf — Tier 1 hard-redacts
 *      secret-shaped substrings (mnemonics, labelled private keys, API
 *      keys, JWTs); Tier 2 masks addresses + tx hashes.
 *
 * Order: `Error` instances are unwrapped to `{name, message, stack}` BEFORE
 * the plain-object branch (mirrors `vex-app/src/main/logger/redact.ts`).
 *
 * Cycle / depth guards: `WeakSet`-based circular detection, depth cap 8.
 * Per-string size cap MAX_STRING_LEN with `…[truncated N chars]` suffix.
 *
 * Output: redacted clone of the input + counts so callers can stamp
 * `redaction_hard_count` / `redaction_mask_count` proof columns on insert.
 */

import { redact as redactText } from "./text-redaction.js";

const SENSITIVE_KEY_RE =
  /(password|passphrase|mnemonic|seed|phrase|private[_-]?key|secret|token|api[_-]?key|auth(?:orization)?|signature|sig\b|wallet|address|keystore|cipher|tag|salt|nonce|iv\b|jwt)/i;

const MAX_STRING_LEN = 4000;
const REDACTED_KEY = "[REDACTED]";

export interface DiagnosticRedactionResult<T> {
  readonly value: T;
  readonly hardRedactCount: number;
  readonly maskCount: number;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof Error)
  );
}

function redactDeep(
  value: unknown,
  depth: number,
  seen: WeakSet<object>,
  counts: { hard: number; mask: number },
): unknown {
  if (depth > 8) return "[depth-limit]";
  if (value === null || value === undefined) return value;
  const t = typeof value;

  if (t === "string") {
    const r = redactText(value as string);
    counts.hard += r.hardRedactCount;
    counts.mask += r.maskCount;
    let out = r.text;
    if (out.length > MAX_STRING_LEN) {
      out = `${out.slice(0, MAX_STRING_LEN)}…[truncated ${out.length - MAX_STRING_LEN} chars]`;
    }
    return out;
  }
  if (t === "number" || t === "boolean") return value;
  // bigint is NOT JSON-serializable (`JSON.stringify(1n)` throws). The DB
  // layer JSON.stringifies the sanitized context/attachments payloads before
  // INSERT, so a stray `bigint` here would surface as a persistence failure
  // mapped to `support.persist_failed`. Normalize to a decimal string —
  // the diagnostic value is preserved without forcing every IPC caller to
  // pre-format.
  if (t === "bigint") return (value as bigint).toString();
  if (t === "function" || t === "symbol") return `[${t}]`;

  // Error MUST be checked before the plain-object branch — Object.entries on
  // an Error iterates only own enumerable props and misses name/message/stack,
  // which is where the secrets live.
  if (value instanceof Error) {
    const message = redactDeep(value.message, depth + 1, seen, counts);
    const stack =
      value.stack !== undefined
        ? redactDeep(value.stack, depth + 1, seen, counts)
        : undefined;
    return {
      name: value.name,
      message,
      stack,
    };
  }

  if (Array.isArray(value)) {
    if (seen.has(value)) return "[circular]";
    seen.add(value);
    return value.map((item) => redactDeep(item, depth + 1, seen, counts));
  }

  if (isPlainObject(value)) {
    if (seen.has(value)) return "[circular]";
    seen.add(value);
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (SENSITIVE_KEY_RE.test(k)) {
        out[k] = REDACTED_KEY;
        counts.hard += 1;
      } else {
        out[k] = redactDeep(v, depth + 1, seen, counts);
      }
    }
    return out;
  }

  return `[${t}]`;
}

/**
 * Apply key-name + two-tier text redaction recursively. Returns a redacted
 * clone (input is not mutated) plus aggregate counts.
 */
export function redactBugPayload<T>(input: T): DiagnosticRedactionResult<T> {
  const counts = { hard: 0, mask: 0 };
  const value = redactDeep(input, 0, new WeakSet(), counts) as T;
  return { value, hardRedactCount: counts.hard, maskCount: counts.mask };
}
