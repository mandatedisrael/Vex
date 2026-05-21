/**
 * Thin facade — atomic lease/status helpers (puzzle 03).
 *
 * The implementation lives in `./lease-and-status/` so each helper +
 * its row shapes have their own file (per the puzzle 3 scaling
 * refactor). This shim preserves the existing
 * `@vex-agent/engine/runtime/lease-and-status.js` import path that
 * callers across `vex-agent` and `vex-app/main` already use — Node
 * ESM `NodeNext` does NOT auto-resolve `lease-and-status.js` to a
 * sibling directory's `index.ts`, so the shim is required.
 *
 * Original 533-line monolith split into 6 files under the
 * subdirectory:
 *
 *   _types.ts            — public input/outcome types (this file
 *                          re-exports them).
 *   _row-shapes.ts       — internal Postgres row interfaces + mappers
 *                          (not re-exported; implementation detail).
 *   claim-run-lease.ts   — `claimRunLeaseAndFlipToRunning`.
 *   claim-session-lease.ts — `claimSessionLease`.
 *   observe-and-apply.ts — `observeAndApplyControl`.
 *   index.ts             — barrel that this shim mirrors.
 */

export * from "./lease-and-status/index.js";
