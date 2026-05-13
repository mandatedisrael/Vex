/**
 * B1 — `vex_introduction` + `vex_namespace_tools` surface tests.
 *
 * Asserts:
 *   - both tools are exposed by `getProductionMcpTools()` (the projection
 *     used by the MCP tool-bridge);
 *   - default `vex_introduction()` returns the priority brief covering the
 *     five active namespaces;
 *   - `vex_introduction({topic:"knowledge"})` returns only the knowledge
 *     section (no namespace table);
 *   - `vex_namespace_tools()` lists active namespaces;
 *   - `vex_namespace_tools({namespace:"polymarket"})` includes per-tool
 *     headings.
 */

import { describe, it, expect } from "vitest";
import { getProductionMcpTools } from "../../../vex-agent/tools/registry.js";
import { handleVexIntroduction } from "../../../vex-agent/tools/internal/vex-intro.js";
import { handleVexNamespaceTools } from "../../../vex-agent/tools/internal/vex-namespace-tools.js";

describe("B1 — vex_introduction + vex_namespace_tools", () => {
  it("both tools are surfaced in production MCP", () => {
    const names = getProductionMcpTools().map((t) => t.name);
    expect(names).toContain("vex_introduction");
    expect(names).toContain("vex_namespace_tools");
  });

  it("vex_introduction default → priority brief covers all 5 active namespaces", async () => {
    const result = await handleVexIntroduction({});
    expect(result.success).toBe(true);
    const text = result.output;
    // Match opening `**<ns>` (description renders `**solana (jupiter)**`,
    // so a strict `**ns**` match would over-constrain).
    for (const ns of ["polymarket", "solana", "khalani", "kyberswap", "dexscreener"]) {
      expect(text, `priority brief missing namespace mention: ${ns}`).toContain(`**${ns}`);
    }
    // Pointer at the deeper tool.
    expect(text).toContain("vex_namespace_tools");
  });

  it("vex_introduction({topic:'knowledge'}) returns only the knowledge section", async () => {
    const result = await handleVexIntroduction({ topic: "knowledge" });
    expect(result.success).toBe(true);
    expect(result.output).toContain("# Vex — long-term knowledge layer");
    // Must NOT include the priority-brief markers from the default render.
    expect(result.output).not.toContain("Active protocols (priority)");
  });

  it("vex_introduction({topic:'namespaces'}) renders the dynamic namespace table", async () => {
    const result = await handleVexIntroduction({ topic: "namespaces" });
    expect(result.success).toBe(true);
    expect(result.output).toContain("# Vex — protocol namespaces");
    expect(result.output).toContain("polymarket");
  });

  it("vex_namespace_tools() lists active namespaces in a table", async () => {
    const result = await handleVexNamespaceTools({});
    expect(result.success).toBe(true);
    expect(result.output).toContain("| Namespace |");
    expect(result.output).toMatch(/`khalani`/);
    expect(result.output).toMatch(/`kyberswap`/);
  });

  it("vex_namespace_tools({namespace:'polymarket'}) renders per-tool headings", async () => {
    const result = await handleVexNamespaceTools({ namespace: "polymarket" });
    expect(result.success).toBe(true);
    expect(result.output).toContain("# Namespace: `polymarket`");
    // At least one tool header present.
    expect(result.output).toMatch(/### `polymarket\./);
  });

  it("vex_namespace_tools({namespace:'unknown'}) lists active namespaces in the error", async () => {
    const result = await handleVexNamespaceTools({ namespace: "doesnotexist" });
    expect(result.success).toBe(false);
    expect(result.output).toContain("Unknown namespace");
  });
});
