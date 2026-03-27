import { describe, it, expect } from "vitest";
import { SLOP_TOOLS } from "../../../echo-agent/tools/protocols/0g/slop/manifest.js";

describe("slop manifest", () => {
  it("has 13 tools total", () => {
    expect(SLOP_TOOLS).toHaveLength(13);
  });

  const EXPECTED_TOOL_IDS = [
    // Token (3)
    "slop.token.create",
    "slop.token.info",
    "slop.tokens.mine",
    // Trade (2)
    "slop.trade.buy",
    "slop.trade.sell",
    // View (2)
    "slop.price",
    "slop.curve",
    // Fees (4)
    "slop.fees.stats",
    "slop.fees.claimCreator",
    "slop.fees.lpPending",
    "slop.fees.lpCollect",
    // Reward (2)
    "slop.reward.pending",
    "slop.reward.claim",
  ];

  it("expected toolId count matches manifest count", () => {
    expect(EXPECTED_TOOL_IDS).toHaveLength(13);
  });

  for (const toolId of EXPECTED_TOOL_IDS) {
    it(`declares ${toolId}`, () => {
      expect(SLOP_TOOLS.find(t => t.toolId === toolId)).toBeDefined();
    });
  }

  it("has no tools beyond expected list", () => {
    const expectedSet = new Set(EXPECTED_TOOL_IDS);
    expect(SLOP_TOOLS.filter(t => !expectedSet.has(t.toolId))).toHaveLength(0);
  });

  it("all tools belong to slop namespace", () => {
    for (const tool of SLOP_TOOLS) expect(tool.namespace).toBe("slop");
  });

  it("all tools are active lifecycle", () => {
    for (const tool of SLOP_TOOLS) expect(tool.lifecycle).toBe("active");
  });

  it("all toolIds start with slop.", () => {
    for (const tool of SLOP_TOOLS) expect(tool.toolId).toMatch(/^slop\./);
  });

  const EXPECTED_MUTATING = [
    "slop.token.create",
    "slop.trade.buy",
    "slop.trade.sell",
    "slop.fees.claimCreator",
    "slop.fees.lpCollect",
    "slop.reward.claim",
  ];

  it("has correct number of mutating tools (6)", () => {
    expect(SLOP_TOOLS.filter(t => t.mutating)).toHaveLength(6);
  });

  for (const toolId of EXPECTED_MUTATING) {
    it(`${toolId} is mutating`, () => {
      expect(SLOP_TOOLS.find(t => t.toolId === toolId)!.mutating).toBe(true);
    });
  }

  it("read-only tools are not mutating", () => {
    const mutatingSet = new Set(EXPECTED_MUTATING);
    for (const tool of SLOP_TOOLS.filter(t => !mutatingSet.has(t.toolId))) {
      expect(tool.mutating).toBe(false);
    }
  });

  it("slop.token.create requires name and symbol", () => {
    const tool = SLOP_TOOLS.find(t => t.toolId === "slop.token.create")!;
    const required = tool.params.filter(p => p.required).map(p => p.key);
    expect(required).toContain("name");
    expect(required).toContain("symbol");
  });

  it("slop.trade.buy requires token and amountOg", () => {
    const tool = SLOP_TOOLS.find(t => t.toolId === "slop.trade.buy")!;
    const required = tool.params.filter(p => p.required).map(p => p.key);
    expect(required).toContain("token");
    expect(required).toContain("amountOg");
  });

  it("slop.trade.sell requires token and amountTokens", () => {
    const tool = SLOP_TOOLS.find(t => t.toolId === "slop.trade.sell")!;
    const required = tool.params.filter(p => p.required).map(p => p.key);
    expect(required).toContain("token");
    expect(required).toContain("amountTokens");
  });

  it("slop.price requires token", () => {
    const tool = SLOP_TOOLS.find(t => t.toolId === "slop.price")!;
    expect(tool.params.filter(p => p.required).map(p => p.key)).toEqual(["token"]);
  });

  it("slop.tokens.mine has no required params", () => {
    const tool = SLOP_TOOLS.find(t => t.toolId === "slop.tokens.mine")!;
    expect(tool.params.filter(p => p.required)).toHaveLength(0);
  });

  it("no tools require ENV", () => {
    for (const tool of SLOP_TOOLS) expect(tool.requiresEnv).toBeUndefined();
  });

  it("every tool has non-empty description", () => {
    for (const tool of SLOP_TOOLS) expect(tool.description.length).toBeGreaterThan(15);
  });

  it("every param has non-empty description", () => {
    for (const tool of SLOP_TOOLS) {
      for (const param of tool.params) expect(param.description.length).toBeGreaterThan(3);
    }
  });
});
