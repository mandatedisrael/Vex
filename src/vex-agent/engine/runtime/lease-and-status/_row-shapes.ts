/**
 * Internal Postgres row shapes + row → DTO mappers used by every
 * atomic helper in this subdirectory. Not re-exported from the
 * barrel — these are implementation details, not part of the
 * `@vex-agent/engine/runtime/lease-and-status.js` public surface.
 */

import type {
  LeaseProcessKind,
  RunnerLease,
} from "../../../db/repos/runner-leases.js";
import type {
  ControlRequest,
  ControlRequestKind,
} from "../../../db/repos/runtime-control-requests.js";
import type { MissionRunStatus } from "../../types.js";

export interface MissionRunRow {
  readonly id: string;
  readonly status: MissionRunStatus;
  readonly session_id: string;
}

export interface RunnerLeaseRow {
  readonly session_id: string;
  readonly mission_run_id: string | null;
  readonly owner_id: string;
  readonly process_kind: LeaseProcessKind;
  readonly acquired_at: Date;
  readonly heartbeat_at: Date;
  readonly expires_at: Date;
}

export interface ControlRequestRow {
  readonly id: string;
  readonly session_id: string;
  readonly mission_run_id: string | null;
  readonly kind: ControlRequestKind;
  readonly status: ControlRequest["status"];
  readonly requested_by: ControlRequest["requestedBy"];
  readonly reason: string | null;
  readonly correlation_id: string | null;
  readonly created_at: Date;
  readonly observed_at: Date | null;
  readonly cleared_at: Date | null;
  readonly expires_at: Date | null;
}

export function mapLease(r: RunnerLeaseRow): RunnerLease {
  return {
    sessionId: r.session_id,
    missionRunId: r.mission_run_id,
    ownerId: r.owner_id,
    processKind: r.process_kind,
    acquiredAt: r.acquired_at,
    heartbeatAt: r.heartbeat_at,
    expiresAt: r.expires_at,
  };
}

export function mapControlRequest(r: ControlRequestRow): ControlRequest {
  return {
    id: r.id,
    sessionId: r.session_id,
    missionRunId: r.mission_run_id,
    kind: r.kind,
    status: r.status,
    requestedBy: r.requested_by,
    reason: r.reason,
    correlationId: r.correlation_id,
    createdAt: r.created_at,
    observedAt: r.observed_at,
    clearedAt: r.cleared_at,
    expiresAt: r.expires_at,
  };
}
