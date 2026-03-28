import { describe, it, expect, vi } from "vitest";

// Mock 0G compute readiness
vi.mock("@tools/0g-compute/readiness.js", () => ({
  loadComputeState: () => null,
}));

vi.mock("@echo-agent/db/repos/executions.js", () => ({
  recordExecution: vi.fn().mockResolvedValue(1),
}));

vi.mock("@echo-agent/db/repos/sync.js", () => ({
  getJobsForNamespace: vi.fn().mockResolvedValue([]),
  enqueueRun: vi.fn().mockResolvedValue(1),
}));

const { executeProtocolTool } = await import("../../../echo-agent/tools/protocols/runtime.js");

describe("runtime approval gate", () => {
  it("blocks mutating tool in restricted mode → pendingApproval", async () => {
    const result = await executeProtocolTool(
      { toolId: "khalani.bridge", params: { fromChain: "ethereum", toChain: "solana", fromToken: "0x", toToken: "0x", amount: "1" } },
      { loopMode: "restricted", approved: false },
    );

    expect(result.success).toBe(false);
    expect(result.pendingApproval).toBe(true);
    expect(result.output).toContain("requires approval");
  });

  it("blocks in off mode too", async () => {
    const result = await executeProtocolTool(
      { toolId: "khalani.bridge", params: { fromChain: "ethereum", toChain: "solana", fromToken: "0x", toToken: "0x", amount: "1" } },
      { loopMode: "off", approved: false },
    );

    expect(result.pendingApproval).toBe(true);
  });

  it("non-mutating tool passes in restricted mode", async () => {
    const result = await executeProtocolTool(
      { toolId: "khalani.tokens.search", params: { query: "USDC" } },
      { loopMode: "restricted", approved: false },
    );

    // Will fail at network level but NOT at approval gate
    expect(result.pendingApproval).toBeUndefined();
  });
});
