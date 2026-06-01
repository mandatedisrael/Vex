/**
 * Atomic composable helpers for the puzzle-03 runtime control plane —
 * barrel re-export.
 *
 * Every helper runs as a SINGLE database transaction so the combination
 * of {lease acquire, status flip, pending-wake cancel, control-request
 * observe/clear} commits together — there is no window where the
 * lease exists but the status hasn't flipped, or where a `paused_wake`
 * row stays around after the run flipped to `running`.
 *
 * Callers import via `@vex-agent/engine/runtime/lease-and-status.js`
 * (the parent thin shim) which `export *`s this barrel — keep all
 * helpers + types in this re-export so call sites never need to know
 * the sub-module layout.
 */

export {
  type ClaimRunInput,
  type ClaimRunOutcome,
  type ClaimSessionLeaseInput,
  type ClaimSessionLeaseOutcome,
  type ObserveControlInput,
  type ObserveControlOutcome,
} from "./_types.js";

export { claimRunLeaseAndFlipToRunning } from "./claim-run-lease.js";
export { claimSessionLease } from "./claim-session-lease.js";
export { observeAndApplyControl } from "./observe-and-apply.js";
export {
  claimRunForAutoRetry,
  type ClaimAutoRetryInput,
  type ClaimAutoRetryOutcome,
  type AutoRetryIneligibleReason,
} from "./claim-auto-retry.js";
