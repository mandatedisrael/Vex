/**
 * Gamma-manifest FAÇADE surface guard (A-037 structural split).
 *
 * `src/vex-agent/tools/protocols/polymarket/manifests/gamma.ts` was split into
 * per-resource chunk modules under `./gamma/` (events / markets / search /
 * tags / series / comments / profile / sports) while the original path stays a
 * compatibility façade that re-assembles the SAME `GAMMA_TOOLS` array.
 *
 * Array order is OBSERVABLE — the protocol catalog registers tools by iteration
 * order. This test pins the EXACT ordered `toolId` sequence so a later edit
 * cannot silently drop, reorder, rename, or add a manifest entry. Tool BEHAVIOR
 * is covered by `polymarket-handlers.test.ts`; here we only assert the ordered
 * surface and basic shape invariants the catalog depends on.
 */

import { describe, it, expect } from "vitest";

import { GAMMA_TOOLS } from "@vex-agent/tools/protocols/polymarket/manifests/gamma.js";

// EXACT original order (top-to-bottom of the pre-split god-file).
const EXPECTED_TOOL_IDS = [
  // ── Events (4) ──
  "polymarket.gamma.events",
  "polymarket.gamma.event",
  "polymarket.gamma.eventBySlug",
  "polymarket.gamma.eventTags",
  // ── Markets (4) ──
  "polymarket.gamma.markets",
  "polymarket.gamma.market",
  "polymarket.gamma.marketBySlug",
  "polymarket.gamma.marketTags",
  // ── Search (1) ──
  "polymarket.gamma.search",
  // ── Tags (7) ──
  "polymarket.gamma.tags",
  "polymarket.gamma.tag",
  "polymarket.gamma.tagBySlug",
  "polymarket.gamma.relatedTags",
  "polymarket.gamma.relatedTagsBySlug",
  "polymarket.gamma.tagsRelatedToTag",
  "polymarket.gamma.tagsRelatedToTagBySlug",
  // ── Series (2) ──
  "polymarket.gamma.series",
  "polymarket.gamma.seriesById",
  // ── Comments (3) ──
  "polymarket.gamma.comments",
  "polymarket.gamma.comment",
  "polymarket.gamma.commentsByUser",
  // ── Profiles (1) ──
  "polymarket.gamma.profile",
  // ── Sports (3) ──
  "polymarket.gamma.sportsMetadata",
  "polymarket.gamma.sportsMarketTypes",
  "polymarket.gamma.teams",
] as const;

describe("GAMMA_TOOLS façade — ordered surface (A-037 split pin)", () => {
  it("re-assembles the EXACT ordered toolId sequence", () => {
    expect(GAMMA_TOOLS.map((t) => t.toolId)).toEqual([...EXPECTED_TOOL_IDS]);
  });

  it("has no duplicate toolIds", () => {
    const ids = GAMMA_TOOLS.map((t) => t.toolId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("count matches the pinned surface", () => {
    expect(GAMMA_TOOLS).toHaveLength(EXPECTED_TOOL_IDS.length);
  });

  it("every entry carries the gamma discovery payload (verbatim move check)", () => {
    for (const tool of GAMMA_TOOLS) {
      expect(tool.namespace).toBe("polymarket");
      expect(tool.discovery).toBeDefined();
    }
  });
});
