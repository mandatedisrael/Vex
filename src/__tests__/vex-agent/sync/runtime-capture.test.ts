import { describe, it, expect, vi } from "vitest";

vi.mock("@vex-agent/db/repos/executions.js", () => ({
  recordExecution: vi.fn().mockResolvedValue(1),
}));

vi.mock("@vex-agent/db/repos/sync.js", () => ({
  getJobsForNamespace: vi.fn().mockResolvedValue([]),
  enqueueRun: vi.fn().mockResolvedValue(1),
}));

const { executeProtocolTool } = await import("../../../vex-agent/tools/protocols/runtime.js");

describe("runtime approval gate", () => {
  it("blocks mutating tool in restricted permission → pendingApproval", async () => {
    const result = await executeProtocolTool(
      { toolId: "khalani.bridge", params: { fromChain: "ethereum", toChain: "solana", fromToken: "0x", toToken: "0x", amount: "1" } },
      { sessionPermission: "restricted", approved: false },
    );

    expect(result.success).toBe(false);
    expect(result.pendingApproval).toBe(true);
    expect(result.output).toContain("requires approval");
  });

  it("non-mutating tool passes in restricted permission", async () => {
    const result = await executeProtocolTool(
      { toolId: "khalani.tokens.search", params: { query: "USDC" } },
      { sessionPermission: "restricted", approved: false },
    );

    // Will fail at network level but NOT at approval gate
    expect(result.pendingApproval).toBeUndefined();
  });
});
