import { describe, it, expect } from "vitest";
import { ECHOBOOK_TOOLS } from "../../../echo-agent/tools/protocols/echobook/manifest.js";

describe("echobook manifest", () => {
  it("has 33 tools total", () => {
    expect(ECHOBOOK_TOOLS).toHaveLength(33);
  });

  const EXPECTED_TOOL_IDS = [
    // Posts (7)
    "echobook.feed", "echobook.feed.following", "echobook.post.get",
    "echobook.post.create", "echobook.post.delete",
    "echobook.posts.byProfile", "echobook.posts.search",
    // Comments (3)
    "echobook.comments.get", "echobook.comment.create", "echobook.comment.delete",
    // Profile (3)
    "echobook.profile.get", "echobook.profile.update", "echobook.profile.search",
    // Social (7)
    "echobook.follow.toggle", "echobook.followers", "echobook.following",
    "echobook.follow.status", "echobook.vote.post", "echobook.vote.comment",
    "echobook.repost",
    // Submolts (5)
    "echobook.submolts.list", "echobook.submolt.get", "echobook.submolt.join",
    "echobook.submolt.leave", "echobook.submolt.posts",
    // Notifications (3)
    "echobook.notifications.list", "echobook.notifications.unreadCount",
    "echobook.notifications.markRead",
    // Points (3)
    "echobook.points.me", "echobook.points.leaderboard", "echobook.points.events",
    // TradeProof (2)
    "echobook.tradeProof.submit", "echobook.tradeProof.get",
  ];

  it("expected toolId count matches manifest count", () => {
    expect(EXPECTED_TOOL_IDS).toHaveLength(33);
  });

  for (const toolId of EXPECTED_TOOL_IDS) {
    it(`declares ${toolId}`, () => {
      expect(ECHOBOOK_TOOLS.find(t => t.toolId === toolId)).toBeDefined();
    });
  }

  it("has no tools beyond expected list", () => {
    const expectedSet = new Set(EXPECTED_TOOL_IDS);
    expect(ECHOBOOK_TOOLS.filter(t => !expectedSet.has(t.toolId))).toHaveLength(0);
  });

  it("all tools belong to echobook namespace", () => {
    for (const tool of ECHOBOOK_TOOLS) expect(tool.namespace).toBe("echobook");
  });

  it("all tools are active lifecycle", () => {
    for (const tool of ECHOBOOK_TOOLS) expect(tool.lifecycle).toBe("active");
  });

  it("all toolIds start with echobook.", () => {
    for (const tool of ECHOBOOK_TOOLS) expect(tool.toolId).toMatch(/^echobook\./);
  });

  const EXPECTED_MUTATING = [
    "echobook.post.create", "echobook.post.delete",
    "echobook.comment.create", "echobook.comment.delete",
    "echobook.profile.update",
    "echobook.follow.toggle",
    "echobook.vote.post", "echobook.vote.comment",
    "echobook.repost",
    "echobook.submolt.join", "echobook.submolt.leave",
    "echobook.notifications.markRead",
    "echobook.tradeProof.submit",
  ];

  it("has correct number of mutating tools (13)", () => {
    expect(ECHOBOOK_TOOLS.filter(t => t.mutating)).toHaveLength(13);
  });

  for (const toolId of EXPECTED_MUTATING) {
    it(`${toolId} is mutating`, () => {
      expect(ECHOBOOK_TOOLS.find(t => t.toolId === toolId)!.mutating).toBe(true);
    });
  }

  it("read-only tools are not mutating", () => {
    const mutSet = new Set(EXPECTED_MUTATING);
    for (const tool of ECHOBOOK_TOOLS.filter(t => !mutSet.has(t.toolId))) {
      expect(tool.mutating).toBe(false);
    }
  });

  it("no tools require ENV", () => {
    for (const tool of ECHOBOOK_TOOLS) expect(tool.requiresEnv).toBeUndefined();
  });

  it("every tool has non-empty description", () => {
    for (const tool of ECHOBOOK_TOOLS) expect(tool.description.length).toBeGreaterThan(15);
  });

  it("every param has non-empty description", () => {
    for (const tool of ECHOBOOK_TOOLS)
      for (const param of tool.params) expect(param.description.length).toBeGreaterThan(3);
  });
});
