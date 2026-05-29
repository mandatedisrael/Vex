import { describe, expect, it } from "vitest";
import {
  runtimeRequestInputSchema,
  runtimeStateDtoSchema,
  runtimeRequestPauseResultSchema,
  runtimeRequestStopResultSchema,
  runtimeRequestResumeResultSchema,
  runtimeCancelWakeResultSchema,
  controlStateEventSchema,
  CONTROL_STATE_EVENT_TYPE,
} from "../runtime.js";

const SESSION = "00000000-0000-4000-8000-000000000002";
const ISO = "2026-05-21T10:00:00.000Z";

describe("runtime schemas", () => {
  it("runtimeStateDtoSchema accepts an inactive shape (with lease + pending fields)", () => {
    const parsed = runtimeStateDtoSchema.safeParse({
      sessionId: SESSION,
      hasActiveRun: false,
      missionRunId: null,
      status: null,
      stopReason: null,
      lastCheckpointAt: null,
      startedAt: null,
      iterationCount: null,
      leaseActive: false,
      leaseExpiresAt: null,
      pendingControlKind: null,
    });
    expect(parsed.success).toBe(true);
  });

  it("runtimeStateDtoSchema accepts an active shape with status enum", () => {
    const parsed = runtimeStateDtoSchema.safeParse({
      sessionId: SESSION,
      hasActiveRun: true,
      missionRunId: "run-1",
      status: "running",
      stopReason: null,
      lastCheckpointAt: ISO,
      startedAt: ISO,
      iterationCount: 3,
      leaseActive: true,
      leaseExpiresAt: ISO,
      pendingControlKind: null,
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts paused_user status", () => {
    const parsed = runtimeStateDtoSchema.safeParse({
      sessionId: SESSION,
      hasActiveRun: true,
      missionRunId: "run-1",
      status: "paused_user",
      stopReason: "user_paused",
      lastCheckpointAt: null,
      startedAt: ISO,
      iterationCount: 0,
      leaseActive: false,
      leaseExpiresAt: null,
      pendingControlKind: null,
    });
    expect(parsed.success).toBe(true);
  });

  it("runtimeRequestInputSchema requires uuid sessionId", () => {
    expect(
      runtimeRequestInputSchema.safeParse({ sessionId: SESSION }).success,
    ).toBe(true);
    expect(runtimeRequestInputSchema.safeParse({ sessionId: "x" }).success).toBe(
      false,
    );
  });

});

describe("runtime per-action discriminated unions", () => {
  it("requestPause accepts all 5 outcomes", () => {
    expect(
      runtimeRequestPauseResultSchema.safeParse({
        outcome: "queued",
        requestId: "00000000-0000-4000-8000-000000000003",
      }).success,
    ).toBe(true);
    expect(
      runtimeRequestPauseResultSchema.safeParse({
        outcome: "already_pending",
        requestId: "00000000-0000-4000-8000-000000000004",
      }).success,
    ).toBe(true);
    expect(
      runtimeRequestPauseResultSchema.safeParse({ outcome: "no_active_run" })
        .success,
    ).toBe(true);
    expect(
      runtimeRequestPauseResultSchema.safeParse({
        outcome: "already_paused",
        status: "paused_user",
      }).success,
    ).toBe(true);
    expect(
      runtimeRequestPauseResultSchema.safeParse({
        outcome: "terminal",
        status: "stopped",
      }).success,
    ).toBe(true);
  });

  it("requestResume lease_busy carries retryAfterMs without owner exposure", () => {
    const parsed = runtimeRequestResumeResultSchema.safeParse({
      outcome: "lease_busy",
      retryAfterMs: 12_000,
    });
    expect(parsed.success).toBe(true);
    // Strict — owner field is not part of the schema and would be rejected.
    const withOwner = runtimeRequestResumeResultSchema.safeParse({
      outcome: "lease_busy",
      retryAfterMs: 12_000,
      currentOwner: "secret-owner-id",
    });
    expect(withOwner.success).toBe(false);
  });

  it("requestResume covers all 6 outcomes", () => {
    expect(
      runtimeRequestResumeResultSchema.safeParse({
        outcome: "resumed",
        runId: "run-1",
      }).success,
    ).toBe(true);
    expect(
      runtimeRequestResumeResultSchema.safeParse({
        outcome: "already_running",
        runId: "run-1",
      }).success,
    ).toBe(true);
    expect(
      runtimeRequestResumeResultSchema.safeParse({ outcome: "no_active_run" })
        .success,
    ).toBe(true);
    expect(
      runtimeRequestResumeResultSchema.safeParse({
        outcome: "blocked_approval",
        pendingApprovalId: "approval-1",
      }).success,
    ).toBe(true);
    expect(
      runtimeRequestResumeResultSchema.safeParse({
        outcome: "blocked_error",
        reason: "system",
      }).success,
    ).toBe(true);
  });

  it("requestStop covers its outcomes", () => {
    expect(
      runtimeRequestStopResultSchema.safeParse({
        outcome: "queued",
        requestId: "00000000-0000-4000-8000-000000000005",
      }).success,
    ).toBe(true);
    expect(
      runtimeRequestStopResultSchema.safeParse({
        outcome: "already_terminal",
        status: "stopped",
      }).success,
    ).toBe(true);
    expect(
      runtimeRequestStopResultSchema.safeParse({ outcome: "no_active_run" })
        .success,
    ).toBe(true);
  });

  it("cancelWake covers its outcomes", () => {
    expect(
      runtimeCancelWakeResultSchema.safeParse({
        outcome: "cancelled_wake",
        cancelledCount: 2,
      }).success,
    ).toBe(true);
    expect(
      runtimeCancelWakeResultSchema.safeParse({ outcome: "no_pending_wake" })
        .success,
    ).toBe(true);
  });
});

describe("controlStateEventSchema", () => {
  const VALID = {
    type: CONTROL_STATE_EVENT_TYPE,
    sessionId: SESSION,
    missionRunId: "run-1",
    runStatus: "paused_user" as const,
    stopReason: "user_paused",
    pendingControlKind: null,
    leaseActive: false,
    leaseExpiresAt: null,
    correlationId: null,
  };

  it("accepts a canonical payload", () => {
    expect(controlStateEventSchema.safeParse(VALID).success).toBe(true);
  });

  it("rejects wrong literal type", () => {
    expect(
      controlStateEventSchema.safeParse({
        ...VALID,
        type: "engine.control.something_else",
      }).success,
    ).toBe(false);
  });

  it("rejects extra fields (.strict)", () => {
    expect(
      controlStateEventSchema.safeParse({ ...VALID, smuggled: "x" }).success,
    ).toBe(false);
  });

  it("does not expose owner-id (rejected extra)", () => {
    expect(
      controlStateEventSchema.safeParse({
        ...VALID,
        leaseOwnerId: "internal-owner",
      }).success,
    ).toBe(false);
  });
});
