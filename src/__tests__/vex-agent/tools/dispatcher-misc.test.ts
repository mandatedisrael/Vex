import { describe, it, expect } from "vitest";
import "./_dispatcher-test-mocks.js";
import { makeTestContext } from "./_test-context.js";

const { dispatchTool } = await import("../../../vex-agent/tools/dispatcher.js");

const baseContext = makeTestContext();

describe("dispatcher — subagent, wallet, unknown, no-stubs", () => {
  // ── Subagent ─────────────────────────────────────────────────────

  // TODO(subagent-disabled): re-enable razem z SUBAGENT_TOOLS i dispatcher loaders.
  it.skip("subagent_spawn returns id", async () => {
    const result = await dispatchTool(
      { name: "subagent_spawn", args: { name: "VexTest", task: "research markets" }, toolCallId: "call_13" },
      baseContext,
    );

    expect(result.success).toBe(true);
    const parsed = JSON.parse(result.output);
    expect(parsed.id).toMatch(/^subagent-/);
    expect(parsed.name).toBe("VexTest");
  });

  // TODO(subagent-disabled): re-enable razem z SUBAGENT_TOOLS i dispatcher loaders.
  it.skip("subagent_spawn fails without name", async () => {
    const result = await dispatchTool(
      { name: "subagent_spawn", args: { task: "do something" }, toolCallId: "call_13b" },
      baseContext,
    );

    expect(result.success).toBe(false);
    expect(result.output).toContain("name");
  });

  // TODO(subagent-disabled): re-enable razem z SUBAGENT_TOOLS i dispatcher loaders.
  it.skip("subagent_status returns empty when none active", async () => {
    const result = await dispatchTool(
      { name: "subagent_status", args: {}, toolCallId: "call_13c" },
      baseContext,
    );

    expect(result.success).toBe(true);
    const parsed = JSON.parse(result.output);
    expect(parsed.message).toContain("No active");
  });

  // ── Wallet ───────────────────────────────────────────────────────

  it("routes wallet_balances to live handler (not stub)", async () => {
    const result = await dispatchTool(
      { name: "wallet_balances", args: { wallet: "eip155" }, toolCallId: "call_14" },
      baseContext,
    );

    expect(result.success).toBe(true);
    const parsed = JSON.parse(result.output);
    expect(parsed.wallets[0].wallet).toBe("eip155");
    expect(parsed.wallets[0].address).toBe("0x1234567890abcdef1234567890abcdef12345678");
    expect(result.output).not.toContain("[STUB]");
  });

  it("routes Khalani internal read aliases through live handlers", async () => {
    const result = await dispatchTool(
      { name: "khalani_chains_list", args: {}, toolCallId: "call_14b" },
      baseContext,
    );

    expect(result.success).toBe(true);
    const parsed = JSON.parse(result.output);
    expect(parsed.chains).toBeGreaterThan(0);
    expect(result.output).not.toContain("[STUB]");
  });

  // ── Approval gate (mutating + restricted + !approved) ────────────

  it("polymarket_setup under restricted + unapproved → pendingApproval (handler not reached; FINDING-security-005 mutating-gate class)", async () => {
    // baseContext = makeTestContext() → restricted + approved:false. The
    // dispatcher's mutating-tool gate must fire BEFORE the credential derive.
    // Canonical regression for the restricted-mode mutating-approval gate (the
    // FINDING-security-005 class) — `mutating:true` tools must surface an
    // approval card instead of reaching their handler under restricted+unapproved.
    const result = await dispatchTool(
      { name: "polymarket_setup", args: {}, toolCallId: "call_pm_setup" },
      baseContext,
    );

    expect(result.pendingApproval).toBe(true);
    expect(result.success).toBe(false);
    expect(result.output).toMatch(/approval/i);
  });

  // ── Unknown tool ─────────────────────────────────────────────────

  it("returns error for completely unknown tool", async () => {
    const result = await dispatchTool(
      { name: "nonexistent_tool", args: {}, toolCallId: "call_15" },
      baseContext,
    );

    expect(result.success).toBe(false);
    expect(result.output).toContain("Unknown tool");
  });

  // ── No stubs remaining ──────────────────────────────────────────

  it("no internal tool returns [STUB]", async () => {
    const internalTools = [
      { name: "web_research", args: { query: "test" } },
      { name: "web_research", args: { url: "https://example.com" } },
      { name: "knowledge_write", args: { kind: "memo", title: "t", summary: "s" } },
      { name: "knowledge_recall", args: { query: "test" } },
      { name: "knowledge_recall_overflow", args: { cacheKey: "rcl-test" } },
      { name: "knowledge_get", args: { id: 1 } },
      { name: "knowledge_update_status", args: { id: 1, status: "archived" } },
      // TODO(subagent-disabled): re-enable razem z SUBAGENT_TOOLS.
      // { name: "subagent_spawn", args: { name: "VexX", task: "t" } },
      // { name: "subagent_status", args: {} },
      // { name: "subagent_stop", args: { id: "sub-1" } },
    ];

    for (const tool of internalTools) {
      const result = await dispatchTool(
        { name: tool.name, args: tool.args, toolCallId: `stub_check_${tool.name}` },
        baseContext,
      );
      expect(result.output).not.toContain("[STUB]");
    }
  });
});
