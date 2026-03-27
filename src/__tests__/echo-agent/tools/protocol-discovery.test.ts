import { describe, it, expect } from "vitest";
import { discoverProtocolCapabilities } from "../../../echo-agent/tools/protocols/runtime.js";

describe("protocol discovery", () => {
  // ── Basic discovery ──────────────────────────────────────────────

  it("returns tools with no filters", () => {
    const result = discoverProtocolCapabilities({});
    expect(result.success).toBe(true);
    expect(result.count).toBeGreaterThan(0);
  });

  it("returns tools with toolId, description, params", () => {
    const result = discoverProtocolCapabilities({});
    for (const tool of result.tools) {
      expect(tool.toolId).toBeTruthy();
      expect(tool.description).toBeTruthy();
      expect(Array.isArray(tool.params)).toBe(true);
    }
  });

  // ── Namespace filter ─────────────────────────────────────────────

  it("filters by khalani namespace", () => {
    const result = discoverProtocolCapabilities({ namespace: "khalani" });
    expect(result.count).toBeGreaterThan(0);
    for (const tool of result.tools) {
      expect(tool.namespace).toBe("khalani");
    }
  });

  it("returns empty for namespace with no active tools", () => {
    const result = discoverProtocolCapabilities({ namespace: "echobook" });
    expect(result.count).toBe(0);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("returns kyberswap tools when filtering by kyberswap namespace", () => {
    const result = discoverProtocolCapabilities({ namespace: "kyberswap" });
    expect(result.count).toBeGreaterThan(0);
    for (const tool of result.tools) {
      expect(tool.namespace).toBe("kyberswap");
    }
  });

  // ── Mutating filter ──────────────────────────────────────────────

  it("excludes mutating by default", () => {
    const result = discoverProtocolCapabilities({ namespace: "khalani" });
    const hasMutating = result.tools.some(t => t.mutating);
    expect(hasMutating).toBe(false);
  });

  it("includes mutating when requested", () => {
    const result = discoverProtocolCapabilities({ namespace: "khalani", includeMutating: true });
    const hasMutating = result.tools.some(t => t.mutating);
    expect(hasMutating).toBe(true);
  });

  // ── Query matching ───────────────────────────────────────────────

  it("matches by toolId substring", () => {
    const result = discoverProtocolCapabilities({ query: "tokens.search" });
    expect(result.count).toBeGreaterThan(0);
    expect(result.tools[0].toolId).toContain("tokens.search");
  });

  it("matches by description keyword", () => {
    const result = discoverProtocolCapabilities({ query: "balance" });
    expect(result.count).toBeGreaterThan(0);
  });

  it("matches case-insensitively", () => {
    const result = discoverProtocolCapabilities({ query: "BRIDGE", includeMutating: true });
    expect(result.count).toBeGreaterThan(0);
  });

  it("returns empty for non-matching query", () => {
    const result = discoverProtocolCapabilities({ query: "zzz_nonexistent_xyz" });
    expect(result.count).toBe(0);
  });

  // ── Limit ────────────────────────────────────────────────────────

  it("respects limit", () => {
    const result = discoverProtocolCapabilities({ namespace: "khalani", limit: 3 });
    expect(result.count).toBeLessThanOrEqual(3);
  });

  it("returns all when limit exceeds count", () => {
    const allResult = discoverProtocolCapabilities({ namespace: "khalani" });
    const bigLimitResult = discoverProtocolCapabilities({ namespace: "khalani", limit: 100 });
    expect(bigLimitResult.count).toBe(allResult.count);
  });

  // ── Lifecycle filter ─────────────────────────────────────────────

  it("returns only active tools by default", () => {
    const result = discoverProtocolCapabilities({});
    for (const tool of result.tools) {
      expect(tool.lifecycle).toBe("active");
    }
  });

  // ── Warnings ─────────────────────────────────────────────────────

  it("warns about declared-only namespaces", () => {
    const result = discoverProtocolCapabilities({});
    const declaredWarning = result.warnings.find(w => w.includes("Declared-only"));
    expect(declaredWarning).toBeDefined();
    // polymarket, 0g-compute etc. are declared but have no active tools yet
    expect(declaredWarning).toContain("polymarket");
    // kyberswap and solana are now active — should NOT appear in declared-only warning
    expect(declaredWarning).not.toContain("kyberswap");
    expect(declaredWarning).not.toContain("solana");
  });

  // ── Combined filters ─────────────────────────────────────────────

  it("combines namespace + query", () => {
    const result = discoverProtocolCapabilities({
      namespace: "khalani",
      query: "order",
    });
    expect(result.count).toBeGreaterThan(0);
    for (const tool of result.tools) {
      expect(tool.namespace).toBe("khalani");
    }
  });

  it("combines namespace + mutating + query", () => {
    const result = discoverProtocolCapabilities({
      namespace: "khalani",
      query: "bridge",
      includeMutating: true,
    });
    expect(result.count).toBeGreaterThanOrEqual(1);
    const bridge = result.tools.find(t => t.toolId === "khalani.bridge");
    expect(bridge).toBeDefined();
    expect(bridge!.mutating).toBe(true);
  });
});
