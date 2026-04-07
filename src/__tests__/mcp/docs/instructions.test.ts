import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { buildInstructions } from "../../../mcp/docs/instructions.js";

describe("mcp docs — buildInstructions", () => {
  const ENV_KEYS = [
    "EMBEDDING_BASE_URL",
    "EMBEDDING_MODEL",
    "EMBEDDING_DIM",
    "EMBEDDING_PROVIDER",
  ] as const;
  const original: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of ENV_KEYS) original[k] = process.env[k];
    process.env.EMBEDDING_BASE_URL = "http://localhost:12434/engines/llama.cpp/v1";
    process.env.EMBEDDING_MODEL = "ai/embeddinggemma:300M-Q8_0";
    process.env.EMBEDDING_DIM = "768";
    process.env.EMBEDDING_PROVIDER = "local";
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (original[k] === undefined) delete process.env[k];
      else process.env[k] = original[k];
    }
  });

  it("returns a non-empty markdown preamble", () => {
    const text = buildInstructions();
    expect(text.length).toBeGreaterThan(200);
    expect(text).toContain("# EchoClaw MCP");
  });

  it("mentions discover_tools and execute_tool meta-tools", () => {
    const text = buildInstructions();
    expect(text).toContain("discover_tools");
    expect(text).toContain("execute_tool");
  });

  it("mentions that the host is the approval gate", () => {
    const text = buildInstructions();
    // Either 'host' or 'Claude Code / Cursor / Codex' should appear in the
    // approval/gate section.
    expect(text.toLowerCase()).toContain("host");
    expect(text).toMatch(/approval|gate|permission/i);
  });

  it("explicitly states there are no subagents", () => {
    const text = buildInstructions();
    expect(text).toMatch(/subagent/i);
    expect(text).toMatch(/no.*subagent|without.*subagent/i);
  });

  it("references docs:// resources for deeper reading", () => {
    const text = buildInstructions();
    expect(text).toContain("docs://overview");
    expect(text).toContain("docs://tools");
    expect(text).toContain("docs://protocols");
  });

  it("lists active protocol namespaces dynamically", () => {
    const text = buildInstructions();
    // Real namespaces from PROTOCOL_NAMESPACE_ALLOWLIST should appear.
    expect(text).toContain("solana");
    expect(text).toContain("polymarket");
  });

  // ── R5: per-namespace one-liner descriptions ────────────────────

  it("renders a one-liner description per namespace, not just the name (R5)", () => {
    const text = buildInstructions();
    // Anchor on real copy from descriptions.ts: khalani description must
    // mention bridging, slop must mention bonding curve, echobook must
    // mention social. If those substrings disappear from the preamble it
    // means the renderer dropped descriptions and the model is back to
    // seeing namespace names with no context.
    expect(text.toLowerCase()).toContain("bridge");
    expect(text.toLowerCase()).toContain("bonding curve");
    expect(text.toLowerCase()).toContain("social");
  });

  it("shows tool counts alongside descriptions in italics (R5)", () => {
    const text = buildInstructions();
    expect(text).toMatch(/_\(\d+ active tools\)_/);
  });
});
