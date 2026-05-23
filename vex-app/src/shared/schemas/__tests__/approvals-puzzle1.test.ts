import { describe, expect, it } from "vitest";
import {
  APPROVAL_REASONING_PREVIEW_MAX,
  approvalActionInputSchema,
  approvalActionResultSchema,
  approvalGetHistoryInputSchema,
  approvalGetInputSchema,
  approvalListPendingInputSchema,
  approvalPermissionSchema,
  approvalStatusSchema,
  approvalSummaryDtoSchema,
} from "../approvals.js";

const SESSION = "00000000-0000-4000-8000-000000000004";
const ISO = "2026-05-21T10:00:00.000Z";

describe("approvals schemas", () => {
  it("approvalStatusSchema accepts pending/approved/rejected only", () => {
    for (const s of ["pending", "approved", "rejected"]) {
      expect(approvalStatusSchema.safeParse(s).success).toBe(true);
    }
    expect(approvalStatusSchema.safeParse("expired").success).toBe(false);
  });

  it("approvalPermissionSchema accepts restricted/full only", () => {
    expect(approvalPermissionSchema.safeParse("restricted").success).toBe(true);
    expect(approvalPermissionSchema.safeParse("full").success).toBe(true);
    expect(approvalPermissionSchema.safeParse("admin").success).toBe(false);
  });

  it("approvalSummaryDtoSchema parses a fully-populated row", () => {
    // Puzzle 5 phase 2 added the `approval_intents` companion fields
    // (actionKind, riskLevel, preview, expiresAt, decision, decisionReason,
    // executionStatus). All nullable for back-compat with rows predating
    // migration 024 — null here is the "no companion intent" case.
    const parsed = approvalSummaryDtoSchema.safeParse({
      id: "approval-1",
      sessionId: SESSION,
      toolCallId: "tc-1",
      toolName: "wallet:send",
      status: "pending",
      permissionAtEnqueue: "restricted",
      createdAt: ISO,
      resolvedAt: null,
      reasoningPreview: "needs auth",
      actionKind: null,
      riskLevel: null,
      preview: null,
      expiresAt: null,
      decision: null,
      decisionReason: null,
      executionStatus: null,
    });
    expect(parsed.success).toBe(true);
  });

  it("approvalSummaryDtoSchema rejects extra keys (.strict)", () => {
    const parsed = approvalSummaryDtoSchema.safeParse({
      id: "approval-1",
      sessionId: SESSION,
      toolCallId: null,
      toolName: null,
      status: "pending",
      permissionAtEnqueue: "restricted",
      createdAt: ISO,
      resolvedAt: null,
      reasoningPreview: "ok",
      actionKind: null,
      riskLevel: null,
      preview: null,
      expiresAt: null,
      decision: null,
      decisionReason: null,
      executionStatus: null,
      toolCall: { command: "send", value: "secret-leak" }, // raw JSONB leak attempt
    });
    expect(parsed.success).toBe(false);
  });

  it("reasoningPreview length is bounded", () => {
    const parsed = approvalSummaryDtoSchema.safeParse({
      id: "approval-1",
      sessionId: SESSION,
      toolCallId: null,
      toolName: null,
      status: "pending",
      permissionAtEnqueue: "restricted",
      createdAt: ISO,
      resolvedAt: null,
      reasoningPreview: "x".repeat(APPROVAL_REASONING_PREVIEW_MAX + 1),
      actionKind: null,
      riskLevel: null,
      preview: null,
      expiresAt: null,
      decision: null,
      decisionReason: null,
      executionStatus: null,
    });
    expect(parsed.success).toBe(false);
  });

  it("approvalListPending/get/getHistory inputs require uuid / id", () => {
    expect(
      approvalListPendingInputSchema.safeParse({ sessionId: SESSION }).success,
    ).toBe(true);
    expect(approvalGetInputSchema.safeParse({ id: "approval-1" }).success).toBe(
      true,
    );
    expect(approvalGetInputSchema.safeParse({ id: "" }).success).toBe(false);
    const history = approvalGetHistoryInputSchema.safeParse({ sessionId: SESSION });
    expect(history.success).toBe(true);
    if (history.success) expect(history.data.limit).toBe(20);
  });

  it("approvalActionInput + result Result-typed contract present", () => {
    expect(approvalActionInputSchema.safeParse({ id: "approval-1" }).success).toBe(
      true,
    );
    expect(
      approvalActionResultSchema.safeParse({
        id: "approval-1",
        status: "approved",
        resolvedAt: ISO,
        runtimeOutcome: "resumed",
        message: "ok",
      }).success,
    ).toBe(true);
  });
});
