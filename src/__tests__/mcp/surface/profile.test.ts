import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getProductionTools } from "../../../mcp/surface/profile.js";

describe("mcp surface — getProductionTools", () => {
  // Snapshot env vars that the registry filter consults so each test can mutate
  // them without leaking into siblings. Restored in afterEach.
  const ENV_KEYS = [
    "TAVILY_API_KEY",
    "POLYMARKET_API_KEY",
    "EMBEDDING_BASE_URL",
  ] as const;
  const originalEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of ENV_KEYS) originalEnv[k] = process.env[k];
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (originalEnv[k] === undefined) delete process.env[k];
      else process.env[k] = originalEnv[k];
    }
  });

  // ── Hard guard: no subagent_* tools ────────────────────────────

  it("never includes any subagent_* tool", () => {
    process.env.TAVILY_API_KEY = "fake-key";
    const names = getProductionTools().map((t) => t.name);
    for (const name of names) {
      expect(name.startsWith("subagent_")).toBe(false);
    }
  });

  it("does not include the e2e harness echo_internal god-tool", () => {
    process.env.TAVILY_API_KEY = "fake-key";
    const names = getProductionTools().map((t) => t.name);
    expect(names).not.toContain("echo_internal");
  });

  // ── Always-present tools ────────────────────────────────────────

  it("always includes the protocol meta-tools", () => {
    process.env.TAVILY_API_KEY = "fake-key";
    const names = getProductionTools().map((t) => t.name);
    expect(names).toContain("discover_tools");
    expect(names).toContain("execute_tool");
  });

  it("always includes the canonical knowledge layer", () => {
    process.env.TAVILY_API_KEY = "fake-key";
    const names = getProductionTools().map((t) => t.name);
    expect(names).toContain("knowledge_write");
    expect(names).toContain("knowledge_recall");
    expect(names).toContain("knowledge_recall_overflow");
    expect(names).toContain("knowledge_get");
    expect(names).toContain("knowledge_update_status");
  });

  it("always includes wallet read + send pair", () => {
    process.env.TAVILY_API_KEY = "fake-key";
    const names = getProductionTools().map((t) => t.name);
    expect(names).toContain("wallet_read");
    expect(names).toContain("khalani_tokens_balances");
    expect(names).toContain("wallet_send_prepare");
    expect(names).toContain("wallet_send_confirm");
  });

  it("always includes vex_introduction and vex_namespace_tools (MCP-host orientation)", () => {
    process.env.TAVILY_API_KEY = "fake-key";
    const names = getProductionTools().map((t) => t.name);
    expect(names).toContain("vex_introduction");
    expect(names).toContain("vex_namespace_tools");
  });

  // ── Env gating: requiresEnv ─────────────────────────────────────

  it("hides web_* tools when TAVILY_API_KEY is unset", () => {
    delete process.env.TAVILY_API_KEY;
    const names = getProductionTools().map((t) => t.name);
    expect(names).not.toContain("web_search");
    expect(names).not.toContain("web_fetch");
  });

  it("shows web_* tools when TAVILY_API_KEY is set", () => {
    process.env.TAVILY_API_KEY = "tavily-test-key";
    const names = getProductionTools().map((t) => t.name);
    expect(names).toContain("web_search");
    expect(names).toContain("web_fetch");
  });

  it("ignores TAVILY_API_KEY=' ' (whitespace) as missing", () => {
    process.env.TAVILY_API_KEY = "   ";
    const names = getProductionTools().map((t) => t.name);
    expect(names).not.toContain("web_search");
  });

  // ── Env gating: showOnlyWhenEnvMissing ──────────────────────────

  it("shows polymarket_setup ONLY when POLYMARKET_API_KEY is unset", () => {
    delete process.env.POLYMARKET_API_KEY;
    const namesUnset = getProductionTools().map((t) => t.name);
    expect(namesUnset).toContain("polymarket_setup");

    process.env.POLYMARKET_API_KEY = "real-key";
    const namesSet = getProductionTools().map((t) => t.name);
    expect(namesSet).not.toContain("polymarket_setup");
  });

  // ── No PROTOCOL_TOOLS leaked individually ───────────────────────

  it("does not register any namespaced protocol tool individually (only meta-tools)", () => {
    process.env.TAVILY_API_KEY = "fake-key";
    const names = getProductionTools().map((t) => t.name);
    // Protocol tool ids contain a dot (`solana.swap`, `khalani.bridge`, …).
    // The MCP surface uses underscored internal tool names — no dotted names
    // should leak through.
    for (const name of names) {
      expect(name).not.toMatch(/\./);
    }
  });
});
