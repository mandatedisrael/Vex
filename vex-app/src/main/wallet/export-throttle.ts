/**
 * In-process backoff gate for wallet private-key export.
 *
 * Mirrors the secrets-unlock throttle pattern but with a shorter lockout
 * plateau because export is a sudo-style re-auth, not a session unlock:
 *   1 → 1s, 2 → 2s, 3 → 4s, 4 → 8s, 5+ → 30s.
 *
 * At the 5th consecutive failure the throttle still returns
 * `retryAfterMs: 30_000`, but ALSO flags `lockoutTriggered = true` so the
 * IPC handler can call `lockSecretSession()` and force the user to re-enter
 * the master password from scratch — relocking is a stronger response than
 * pure throttling for an attacker resident in-process.
 *
 * State is local to the main process and resets on every relaunch.
 */

/**
 * Trigger relocking the secret session when this many consecutive
 * verification failures occur in a single process lifetime. Reset on
 * any successful export.
 */
const EXPORT_FAIL_LIMIT = 5;

/**
 * Backoff table indexed by the failed-attempt count AFTER recording the
 * current failure. Index 0 is unused (success resets the counter).
 *   1 → 1s, 2 → 2s, 3 → 4s, 4 → 8s, 5+ → 30s.
 */
const BACKOFF_MS: Readonly<Record<number, number>> = Object.freeze({
  1: 1_000,
  2: 2_000,
  3: 4_000,
  4: 8_000,
  5: 30_000,
});

function backoffForAttempt(attempt: number): number {
  if (attempt <= 0) return 0;
  if (attempt >= 5) return BACKOFF_MS[5] ?? 30_000;
  return BACKOFF_MS[attempt] ?? 0;
}

let failedAttempts = 0;
let nextAllowedAtMs = 0;

export type ExportGate =
  | { readonly allowed: true }
  | {
      readonly allowed: false;
      readonly retryAfterMs: number;
      readonly lockoutTriggered: boolean;
    };

/**
 * Snapshot of the throttle gate without mutating any counters.
 * Returns the remaining backoff in milliseconds when locked out, plus
 * the `lockoutTriggered` flag the handler uses to decide whether the
 * caller has crossed `EXPORT_FAIL_LIMIT` and needs an immediate session
 * lock on top of the throttle window.
 */
export function checkExportAllowed(): ExportGate {
  const now = Date.now();
  if (now >= nextAllowedAtMs) return { allowed: true };
  return {
    allowed: false,
    retryAfterMs: nextAllowedAtMs - now,
    lockoutTriggered: failedAttempts >= EXPORT_FAIL_LIMIT,
  };
}

/**
 * Bump the failed-attempt counter and arm the backoff window. Call ONLY
 * for wrong-password failures from `verifySecretVaultPassword` — IO /
 * corrupt-file / missing-keystore errors must NOT advance the counter
 * (an unreadable file is not an attacker signal).
 *
 * Returns `{ lockoutTriggered: true }` when the new failure count reaches
 * `EXPORT_FAIL_LIMIT`; the handler should treat this as a signal to call
 * `lockSecretSession()` so the user must re-unlock the vault.
 */
export function recordExportFailure(): { readonly lockoutTriggered: boolean } {
  failedAttempts += 1;
  const backoff = backoffForAttempt(failedAttempts);
  nextAllowedAtMs = Date.now() + backoff;
  return { lockoutTriggered: failedAttempts >= EXPORT_FAIL_LIMIT };
}

/**
 * Reset on a successful export — the user proved knowledge of the
 * password, so prior failures were typos or stale state.
 */
export function recordExportSuccess(): void {
  failedAttempts = 0;
  nextAllowedAtMs = 0;
}

/**
 * Test-only helper. The throttle is intentionally sticky across renderer
 * reloads in production; tests reset between cases.
 */
export function resetExportThrottle(): void {
  failedAttempts = 0;
  nextAllowedAtMs = 0;
}
