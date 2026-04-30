/**
 * NOTE: A subset of tests below is `.skip`ped because the 0G ecosystem
 * (jaine, slop, slop-app, chainscan) and EchoBook namespaces are
 * currently disabled from discovery. Re-enable when the corresponding
 * `advertised` flags flip back to `true` in
 * src/vex-agent/tools/protocols/navigation/entries-0g.ts.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { discoverProtocolCapabilities } from "../../../vex-agent/tools/protocols/runtime.js";
import {
  PROTOCOL_ADVERTISED_NAMESPACE_ALLOWLIST,
} from "../../../vex-agent/tools/protocols/catalog.js";

describe("protocol discovery", () => {
  // Snapshot env-gating keys so each test sees a deterministic baseline.
  // Tests that exercise env-gating delete the relevant key explicitly.
  const ENV_KEYS = [
    "JUPITER_API_KEY",
    "POLYMARKET_API_KEY",
    "EMBEDDING_BASE_URL",
    "EMBEDDING_MODEL",
    "EMBEDDING_DIM",
    "EMBEDDING_PROVIDER",
  ] as const;
  const original: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of ENV_KEYS) original[k] = process.env[k];
    process.env.JUPITER_API_KEY = "test-jupiter-key";
    process.env.POLYMARKET_API_KEY = "test-polymarket-key";
    delete process.env.EMBEDDING_BASE_URL;
    delete process.env.EMBEDDING_MODEL;
    delete process.env.EMBEDDING_DIM;
    delete process.env.EMBEDDING_PROVIDER;
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (original[k] === undefined) delete process.env[k];
      else process.env[k] = original[k];
    }
  });
  // ── Basic discovery ──────────────────────────────────────────────

  it("returns tools with no filters", async () => {
    const result = await discoverProtocolCapabilities({});
    expect(result.success).toBe(true);
    expect(result.count).toBeGreaterThan(0);
    expect(result.totalCount).toBeGreaterThanOrEqual(result.count);
    expect(result.hasMore).toBe(result.totalCount > result.count);
  });

  it("returns tools with toolId, description, params", async () => {
    const result = await discoverProtocolCapabilities({});
    for (const tool of result.tools) {
      expect(tool.toolId).toBeTruthy();
      expect(tool.description).toBeTruthy();
      expect(Array.isArray(tool.params)).toBe(true);
    }
  });

  // ── Namespace filter ─────────────────────────────────────────────

  it("filters by khalani namespace", async () => {
    const result = await discoverProtocolCapabilities({ namespace: "khalani" });
    expect(result.count).toBeGreaterThan(0);
    for (const tool of result.tools) {
      expect(tool.namespace).toBe("khalani");
    }
  });

  it("rejects reserved hidden namespaces", async () => {
    const result = await discoverProtocolCapabilities({ namespace: "0g-compute" });
    expect(result.success).toBe(false);
    expect(result.count).toBe(0);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it.skip("returns echobook tools when filtering by echobook namespace", async () => {
    const result = await discoverProtocolCapabilities({ namespace: "echobook", limit: 50 });
    expect(result.count).toBeGreaterThan(0);
    for (const tool of result.tools) {
      expect(tool.namespace).toBe("echobook");
    }
  });

  it("returns kyberswap tools when filtering by kyberswap namespace", async () => {
    const result = await discoverProtocolCapabilities({ namespace: "kyberswap" });
    expect(result.count).toBeGreaterThan(0);
    for (const tool of result.tools) {
      expect(tool.namespace).toBe("kyberswap");
    }
  });

  // ── Mutating tools — surfaced by default ─────────────────────────
  // Pre-refactor a discovery-side `includeMutating` filter hid mutating
  // tools by default. That filter was cosmetic — the real safety gate
  // lives at execute time (`runtime.ts`: mutating + !approved + !full
  // loopMode → pendingApproval). Hiding mutating tools at discovery
  // prevented agents from finding them, so the filter was removed.
  // Mutating tools now appear in discover_tools with the `mutating`
  // flag visible per item.

  it("surfaces mutating tools by default — includes khalani.bridge", async () => {
    // Explicit limit > 5 because DEFAULT_DISCOVERY_LIMIT=5 may not include
    // the mutating tool depending on manifest order.
    const result = await discoverProtocolCapabilities({ namespace: "khalani", limit: 50 });
    const hasMutating = result.tools.some(t => t.mutating);
    expect(hasMutating).toBe(true);
    const bridge = result.tools.find(t => t.toolId === "khalani.bridge");
    expect(bridge).toBeDefined();
    expect(bridge!.mutating).toBe(true);
  });

  // ── Query matching ───────────────────────────────────────────────

  it("matches by toolId substring", async () => {
    const result = await discoverProtocolCapabilities({ query: "tokens.search" });
    expect(result.count).toBeGreaterThan(0);
    expect(result.tools[0].toolId).toContain("tokens.search");
  });

  it("matches by description keyword", async () => {
    const result = await discoverProtocolCapabilities({ query: "balance" });
    expect(result.count).toBeGreaterThan(0);
  });

  it("matches case-insensitively", async () => {
    const result = await discoverProtocolCapabilities({ query: "BRIDGE" });
    expect(result.count).toBeGreaterThan(0);
  });

  it("returns empty for non-matching query", async () => {
    const result = await discoverProtocolCapabilities({ query: "zzz_nonexistent_xyz" });
    expect(result.count).toBe(0);
  });

  // ── Limit ────────────────────────────────────────────────────────

  it("respects limit", async () => {
    const result = await discoverProtocolCapabilities({ namespace: "khalani", limit: 3 });
    expect(result.count).toBeLessThanOrEqual(3);
    expect(result.tools).toHaveLength(result.count);
    expect(result.totalCount).toBeGreaterThanOrEqual(result.count);
  });

  it("returns all when limit exceeds count", async () => {
    // Both calls need explicit limits that exceed actual khalani tool count;
    // DEFAULT_DISCOVERY_LIMIT=5 caps allResult independently of totalCount.
    const allResult = await discoverProtocolCapabilities({ namespace: "khalani", limit: 100 });
    const bigLimitResult = await discoverProtocolCapabilities({ namespace: "khalani", limit: 200 });
    expect(bigLimitResult.count).toBe(allResult.count);
    expect(bigLimitResult.totalCount).toBe(allResult.totalCount);
  });

  // ── Lifecycle filter ─────────────────────────────────────────────

  it("returns only active tools by default", async () => {
    const result = await discoverProtocolCapabilities({});
    for (const tool of result.tools) {
      expect(tool.lifecycle).toBe("active");
    }
  });

  // ── Warnings ─────────────────────────────────────────────────────

  it("does not advertise reserved namespaces in generic discovery results", async () => {
    const result = await discoverProtocolCapabilities({});
    const namespaces = new Set(result.tools.map((tool) => tool.namespace));
    expect(namespaces.has("0g-compute")).toBe(false);
    expect(namespaces.has("0g-storage")).toBe(false);
  });

  it("returns dexscreener tools when filtering by dexscreener namespace", async () => {
    const result = await discoverProtocolCapabilities({ namespace: "dexscreener", limit: 50 });
    expect(result.count).toBeGreaterThan(0);
    for (const tool of result.tools) {
      expect(tool.namespace).toBe("dexscreener");
    }
  });

  // ── Combined filters ─────────────────────────────────────────────

  it("combines namespace + query", async () => {
    const result = await discoverProtocolCapabilities({
      namespace: "khalani",
      query: "order",
    });
    expect(result.count).toBeGreaterThan(0);
    for (const tool of result.tools) {
      expect(tool.namespace).toBe("khalani");
    }
  });

  it("combines namespace + query — mutating tools surfaced", async () => {
    const result = await discoverProtocolCapabilities({
      namespace: "khalani",
      query: "bridge",
    });
    expect(result.count).toBeGreaterThanOrEqual(1);
    const bridge = result.tools.find(t => t.toolId === "khalani.bridge");
    expect(bridge).toBeDefined();
    expect(bridge!.mutating).toBe(true);
  });

  it.skip("matches alias query for 0g explorer to chainscan", async () => {
    const result = await discoverProtocolCapabilities({ query: "0g explorer" });
    expect(result.success).toBe(true);
    expect(result.tools[0]?.namespace).toBe("chainscan");
  });

  it("matches polymarket clob from natural language query", async () => {
    // Query uses "polymarket orderbook" (namespace + discriminator) instead of the
    // ambiguous "prediction market orderbook" — which now ties polymarket.data.*
    // (via "prediction market" in description) with polymarket.clob.* (via "orderbook").
    // Lexical scoring without IDF can't break that tie; PR3 metadata v1 is the place
    // to disambiguate. The capability-phrase intent in message #5 is the right shape here.
    const result = await discoverProtocolCapabilities({ query: "polymarket orderbook" });
    expect(result.success).toBe(true);
    expect(result.tools[0]?.toolId.startsWith("polymarket.clob")).toBe(true);
  });

  it("matches community takeover query to dexscreener", async () => {
    const result = await discoverProtocolCapabilities({ query: "community takeover" });
    expect(result.success).toBe(true);
    expect(result.tools[0]?.toolId).toBe("dexscreener.communityTakeovers");
  });

  it.skip("matches profile image query to slop app tools", async () => {
    const result = await discoverProtocolCapabilities({ query: "profile image" });
    expect(result.success).toBe(true);
    expect(result.tools[0]?.namespace).toBe("slop-app");
  });

  // ── Defense in depth: reserved namespaces never leak ─────────────

  it("free-text discovery only ever returns advertised namespaces", async () => {
    // Run a few diverse queries — every result must belong to advertised set.
    const queries = ["", "bridge", "swap", "token", "0g", "market"];
    for (const query of queries) {
      const result = await discoverProtocolCapabilities({ query, limit: 200 });
      for (const tool of result.tools) {
        expect(PROTOCOL_ADVERTISED_NAMESPACE_ALLOWLIST as readonly string[]).toContain(tool.namespace);
      }
    }
  });

  // ── Env-gating contract (audit follow-up) ────────────────────────

  it("hides env-gated tools when their requiresEnv is missing", async () => {
    delete process.env.JUPITER_API_KEY;
    const result = await discoverProtocolCapabilities({ namespace: "solana", limit: 100 });
    // All solana tools require JUPITER_API_KEY → namespace returns nothing.
    expect(result.count).toBe(0);
  });

  it("returns env-gated tools when their requiresEnv is present", async () => {
    const result = await discoverProtocolCapabilities({ namespace: "solana", limit: 100 });
    expect(result.count).toBeGreaterThan(0);
  });

  it("does not surface gated polymarket clob mutating tools when key missing", async () => {
    delete process.env.POLYMARKET_API_KEY;
    const result = await discoverProtocolCapabilities({
      namespace: "polymarket",
      query: "buy yes",
      limit: 100,
    });
    // The mutating clob.buy tool requires POLYMARKET_API_KEY → must be hidden.
    expect(result.tools.some((t) => t.toolId === "polymarket.clob.buy")).toBe(false);
  });

  // ── Facet-driven discovery (audit follow-up) ─────────────────────

  it.skip("matches echobook comment tools via facet hints", async () => {
    const result = await discoverProtocolCapabilities({
      query: "comment thread",
      namespace: "echobook",
      limit: 50,
    });
    expect(result.success).toBe(true);
    const ids = result.tools.map((t) => t.toolId);
    expect(ids).toContain("echobook.comments.get");
  });

  it.skip("matches slop.tokens.mine via 'my tokens' facet hint", async () => {
    const result = await discoverProtocolCapabilities({
      query: "my tokens",
      namespace: "slop",
      limit: 50,
    });
    expect(result.success).toBe(true);
    const ids = result.tools.map((t) => t.toolId);
    expect(ids).toContain("slop.tokens.mine");
  });
});
