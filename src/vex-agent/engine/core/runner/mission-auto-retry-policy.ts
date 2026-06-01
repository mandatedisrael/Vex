/**
 * Phase 4d — pure auto-retry policy primitives (no DB / no engine imports).
 *
 * Shared by the scheduler (`mission-auto-retry.ts`) and the atomic wake claim
 * (`engine/runtime/lease-and-status/claim-auto-retry.ts`) so the claim does not
 * pull the scheduler's DB-heavy module into its graph.
 */

/** Hard cap on system auto-retries per run. After this, stays paused_error. */
export const MAX_AUTO_RETRIES = 5;

/** Wake-payload trigger that routes the executor to the auto-retry claim. */
export const AUTO_RETRY_WAKE_TRIGGER = "error_retry" as const;

/**
 * Read the auto-retry opt-in from a frozen run contract snapshot. FAIL-CLOSED:
 * any missing/malformed level (or a non-`true` value) yields `false`, so a run
 * with no/old snapshot, or one that did not opt in, never auto-retries.
 */
export function snapshotAutoRetryEnabled(
  snapshot: Record<string, unknown> | null | undefined,
): boolean {
  if (snapshot === null || snapshot === undefined || typeof snapshot !== "object") {
    return false;
  }
  const frozen = (snapshot as Record<string, unknown>).frozenMission;
  if (frozen === null || frozen === undefined || typeof frozen !== "object") {
    return false;
  }
  const constraints = (frozen as Record<string, unknown>).constraintsJson;
  if (
    constraints === null ||
    constraints === undefined ||
    typeof constraints !== "object"
  ) {
    return false;
  }
  return (constraints as Record<string, unknown>).autoRetryEnabled === true;
}
