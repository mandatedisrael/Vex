import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@echo-agent/db/repos/approvals.js", () => ({
  reject: vi.fn(),
}));

import * as approvalsRepo from "@echo-agent/db/repos/approvals.js";
import { rejectApproval } from "@echo-agent/engine/core/reject.js";

const mockReject = approvalsRepo.reject as unknown as ReturnType<typeof vi.fn>;

describe("rejectApproval", () => {
  beforeEach(() => {
    mockReject.mockReset();
  });

  it("returns the rejected item on successful reject", async () => {
    const item = {
      id: "a-1",
      toolCall: { name: "wallet_send_prepare", args: {} },
      reasoning: "test",
      status: "rejected" as const,
      sessionId: "s-1",
      toolCallId: "tc-1",
      chatMode: "restricted",
      createdAt: "2026-01-01T00:00:00.000Z",
      resolvedAt: "2026-01-01T00:00:01.000Z",
    };
    mockReject.mockResolvedValueOnce(item);

    const result = await rejectApproval("a-1");

    expect(result).toEqual(item);
    expect(mockReject).toHaveBeenCalledWith("a-1");
  });

  it("returns null when the approval was already resolved (CAS miss)", async () => {
    mockReject.mockResolvedValueOnce(null);

    const result = await rejectApproval("a-1");

    expect(result).toBeNull();
  });
});
