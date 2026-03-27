import { describe, it, expect } from "vitest";
import { CHAINSCAN_TOOLS } from "../../../echo-agent/tools/protocols/0g/chainscan/manifest.js";

describe("chainscan manifest", () => {
  // ── Completeness ─────────────────────────────────────────────────

  it("has 20 tools total", () => {
    expect(CHAINSCAN_TOOLS).toHaveLength(20);
  });

  const EXPECTED_TOOL_IDS = [
    // Account (6)
    "chainscan.account.balance",
    "chainscan.account.balanceMulti",
    "chainscan.account.transactions",
    "chainscan.account.tokenTransfers",
    "chainscan.account.nftTransfers",
    "chainscan.account.tokenBalance",
    // Transaction (2)
    "chainscan.tx.status",
    "chainscan.tx.receipt",
    // Contract (3)
    "chainscan.contract.abi",
    "chainscan.contract.source",
    "chainscan.contract.creation",
    // Decode (2)
    "chainscan.decode.byHashes",
    "chainscan.decode.raw",
    // Token (1)
    "chainscan.token.supply",
    // Statistics (6)
    "chainscan.stats.holders",
    "chainscan.stats.transfers",
    "chainscan.stats.participants",
    "chainscan.stats.topSenders",
    "chainscan.stats.topReceivers",
    "chainscan.stats.topParticipants",
  ];

  it("expected toolId count matches manifest count", () => {
    expect(EXPECTED_TOOL_IDS).toHaveLength(20);
  });

  for (const toolId of EXPECTED_TOOL_IDS) {
    it(`declares ${toolId}`, () => {
      const tool = CHAINSCAN_TOOLS.find(t => t.toolId === toolId);
      expect(tool).toBeDefined();
    });
  }

  it("has no tools beyond expected list", () => {
    const expectedSet = new Set(EXPECTED_TOOL_IDS);
    const unexpected = CHAINSCAN_TOOLS.filter(t => !expectedSet.has(t.toolId));
    expect(unexpected).toHaveLength(0);
  });

  // ── Namespace ────────────────────────────────────────────────────

  it("all tools belong to chainscan namespace", () => {
    for (const tool of CHAINSCAN_TOOLS) {
      expect(tool.namespace).toBe("chainscan");
    }
  });

  it("all tools are active lifecycle", () => {
    for (const tool of CHAINSCAN_TOOLS) {
      expect(tool.lifecycle).toBe("active");
    }
  });

  it("all toolIds start with chainscan.", () => {
    for (const tool of CHAINSCAN_TOOLS) {
      expect(tool.toolId).toMatch(/^chainscan\./);
    }
  });

  // ── Mutating flags (all read-only) ────────────────────────────────

  it("all tools are read-only (not mutating)", () => {
    for (const tool of CHAINSCAN_TOOLS) {
      expect(tool.mutating).toBe(false);
    }
  });

  it("has zero mutating tools", () => {
    const mutating = CHAINSCAN_TOOLS.filter(t => t.mutating);
    expect(mutating).toHaveLength(0);
  });

  // ── requiresEnv ──────────────────────────────────────────────────

  it("all tools require CHAINSCAN_API_KEY", () => {
    for (const tool of CHAINSCAN_TOOLS) {
      expect(tool.requiresEnv).toBe("CHAINSCAN_API_KEY");
    }
  });

  // ── Required params ──────────────────────────────────────────────

  it("chainscan.account.balance requires address", () => {
    const tool = CHAINSCAN_TOOLS.find(t => t.toolId === "chainscan.account.balance")!;
    const required = tool.params.filter(p => p.required).map(p => p.key);
    expect(required).toEqual(["address"]);
  });

  it("chainscan.account.balanceMulti requires addresses", () => {
    const tool = CHAINSCAN_TOOLS.find(t => t.toolId === "chainscan.account.balanceMulti")!;
    const required = tool.params.filter(p => p.required).map(p => p.key);
    expect(required).toEqual(["addresses"]);
  });

  it("chainscan.account.transactions requires address", () => {
    const tool = CHAINSCAN_TOOLS.find(t => t.toolId === "chainscan.account.transactions")!;
    const required = tool.params.filter(p => p.required).map(p => p.key);
    expect(required).toEqual(["address"]);
  });

  it("chainscan.account.tokenBalance requires address and contractAddress", () => {
    const tool = CHAINSCAN_TOOLS.find(t => t.toolId === "chainscan.account.tokenBalance")!;
    const required = tool.params.filter(p => p.required).map(p => p.key);
    expect(required).toContain("address");
    expect(required).toContain("contractAddress");
  });

  it("chainscan.tx.status requires txHash", () => {
    const tool = CHAINSCAN_TOOLS.find(t => t.toolId === "chainscan.tx.status")!;
    const required = tool.params.filter(p => p.required).map(p => p.key);
    expect(required).toEqual(["txHash"]);
  });

  it("chainscan.contract.abi requires address", () => {
    const tool = CHAINSCAN_TOOLS.find(t => t.toolId === "chainscan.contract.abi")!;
    const required = tool.params.filter(p => p.required).map(p => p.key);
    expect(required).toEqual(["address"]);
  });

  it("chainscan.contract.creation requires addresses", () => {
    const tool = CHAINSCAN_TOOLS.find(t => t.toolId === "chainscan.contract.creation")!;
    const required = tool.params.filter(p => p.required).map(p => p.key);
    expect(required).toEqual(["addresses"]);
  });

  it("chainscan.decode.byHashes requires hashes", () => {
    const tool = CHAINSCAN_TOOLS.find(t => t.toolId === "chainscan.decode.byHashes")!;
    const required = tool.params.filter(p => p.required).map(p => p.key);
    expect(required).toEqual(["hashes"]);
  });

  it("chainscan.decode.raw requires contracts and inputs", () => {
    const tool = CHAINSCAN_TOOLS.find(t => t.toolId === "chainscan.decode.raw")!;
    const required = tool.params.filter(p => p.required).map(p => p.key);
    expect(required).toContain("contracts");
    expect(required).toContain("inputs");
  });

  it("chainscan.token.supply requires contractAddress", () => {
    const tool = CHAINSCAN_TOOLS.find(t => t.toolId === "chainscan.token.supply")!;
    const required = tool.params.filter(p => p.required).map(p => p.key);
    expect(required).toEqual(["contractAddress"]);
  });

  it("chainscan.stats.holders requires contract", () => {
    const tool = CHAINSCAN_TOOLS.find(t => t.toolId === "chainscan.stats.holders")!;
    const required = tool.params.filter(p => p.required).map(p => p.key);
    expect(required).toEqual(["contract"]);
  });

  it("chainscan.stats.topSenders has no required params", () => {
    const tool = CHAINSCAN_TOOLS.find(t => t.toolId === "chainscan.stats.topSenders")!;
    const required = tool.params.filter(p => p.required);
    expect(required).toHaveLength(0);
  });

  it("chainscan.stats.topReceivers has no required params", () => {
    const tool = CHAINSCAN_TOOLS.find(t => t.toolId === "chainscan.stats.topReceivers")!;
    const required = tool.params.filter(p => p.required);
    expect(required).toHaveLength(0);
  });

  it("chainscan.stats.topParticipants has no required params", () => {
    const tool = CHAINSCAN_TOOLS.find(t => t.toolId === "chainscan.stats.topParticipants")!;
    const required = tool.params.filter(p => p.required);
    expect(required).toHaveLength(0);
  });

  // ── Descriptions quality ──────────────────────────────────────────

  it("every tool has non-empty description", () => {
    for (const tool of CHAINSCAN_TOOLS) {
      expect(tool.description.length).toBeGreaterThan(15);
    }
  });

  it("every param has non-empty description", () => {
    for (const tool of CHAINSCAN_TOOLS) {
      for (const param of tool.params) {
        expect(param.description.length).toBeGreaterThan(3);
      }
    }
  });
});
