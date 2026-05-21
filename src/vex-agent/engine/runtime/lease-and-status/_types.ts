/**
 * Public input + outcome types for the atomic lease/status helpers.
 *
 * Extracted from the old monolithic `lease-and-status.ts` so each
 * helper module can import only the types it needs. The barrel
 * (`./index.ts`) re-exports these so callers keep importing from
 * `@vex-agent/engine/runtime/lease-and-status.js` unchanged.
 */

import type { MissionRunStatus } from "../../types.js";
import type {
  LeaseProcessKind,
  RunnerLease,
} from "../../../db/repos/runner-leases.js";
import type {
  ControlRequest,
  ControlRequestKind,
} from "../../../db/repos/runtime-control-requests.js";

// ── claimRunLeaseAndFlipToRunning ───────────────────────────────────

export interface ClaimRunInput {
  readonly sessionId: string;
  readonly missionRunId: string;
  readonly fromStatuses: readonly MissionRunStatus[];
  readonly ownerId: string;
  readonly processKind: LeaseProcessKind;
  readonly ttlMs: number;
}

export type ClaimRunOutcome =
  | {
    readonly outcome: "claimed";
    readonly previousStatus: MissionRunStatus;
    readonly lease: RunnerLease;
    readonly wakeCancelledCount: number;
  }
  | {
    readonly outcome: "lease_busy";
    readonly currentLease: RunnerLease;
  }
  | {
    readonly outcome: "status_mismatch";
    readonly currentStatus: MissionRunStatus | null;
  };

// ── claimSessionLease ───────────────────────────────────────────────

export interface ClaimSessionLeaseInput {
  readonly sessionId: string;
  readonly ownerId: string;
  readonly processKind: LeaseProcessKind;
  readonly ttlMs: number;
}

export type ClaimSessionLeaseOutcome =
  | { readonly outcome: "claimed"; readonly lease: RunnerLease }
  | { readonly outcome: "lease_busy"; readonly currentLease: RunnerLease };

// ── observeAndApplyControl ──────────────────────────────────────────

export interface ObserveControlInput {
  readonly sessionId: string;
  readonly kinds: readonly ControlRequestKind[];
}

export type ObserveControlOutcome =
  | { readonly outcome: "no_request" }
  | {
    readonly outcome: "paused_user_applied";
    readonly request: ControlRequest;
    readonly previousStatus: MissionRunStatus;
    readonly wakeCancelledCount: number;
  }
  | {
    readonly outcome: "stop_applied";
    readonly request: ControlRequest;
    readonly previousStatus: MissionRunStatus;
    readonly terminalStatus: "stopped" | "cancelled";
    readonly wakeCancelledCount: number;
  };
