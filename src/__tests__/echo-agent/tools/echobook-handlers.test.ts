import { describe, it, expect } from "vitest";
import { ECHOBOOK_HANDLERS } from "../../../echo-agent/tools/protocols/echobook/handlers.js";
import { ECHOBOOK_TOOLS } from "../../../echo-agent/tools/protocols/echobook/manifest.js";

describe("echobook handlers", () => {
  it("has a handler for every manifest toolId", () => {
    const handlerKeys = new Set(Object.keys(ECHOBOOK_HANDLERS));
    const missing = ECHOBOOK_TOOLS.map(t => t.toolId).filter(id => !handlerKeys.has(id));
    expect(missing).toEqual([]);
  });

  it("has no extra handlers without manifests", () => {
    const manifestIds = new Set(ECHOBOOK_TOOLS.map(t => t.toolId));
    const extra = Object.keys(ECHOBOOK_HANDLERS).filter(key => !manifestIds.has(key));
    expect(extra).toEqual([]);
  });

  it("handler count matches manifest count (33)", () => {
    expect(Object.keys(ECHOBOOK_HANDLERS)).toHaveLength(33);
  });

  it("every handler is a function", () => {
    for (const [, handler] of Object.entries(ECHOBOOK_HANDLERS)) {
      expect(typeof handler).toBe("function");
    }
  });

  // Required param validation
  it("echobook.post.get fails without id", async () => {
    const r = await ECHOBOOK_HANDLERS["echobook.post.get"]!({}, { loopMode: "off", approved: false });
    expect(r.success).toBe(false);
    expect(r.output).toContain("id");
  });

  it("echobook.post.create fails without submoltSlug and content", async () => {
    const r = await ECHOBOOK_HANDLERS["echobook.post.create"]!({}, { loopMode: "off", approved: false });
    expect(r.success).toBe(false);
    expect(r.output).toContain("submoltSlug");
  });

  it("echobook.post.delete fails without id", async () => {
    const r = await ECHOBOOK_HANDLERS["echobook.post.delete"]!({}, { loopMode: "off", approved: false });
    expect(r.success).toBe(false);
    expect(r.output).toContain("id");
  });

  it("echobook.posts.byProfile fails without address", async () => {
    const r = await ECHOBOOK_HANDLERS["echobook.posts.byProfile"]!({}, { loopMode: "off", approved: false });
    expect(r.success).toBe(false);
    expect(r.output).toContain("address");
  });

  it("echobook.posts.search fails without q", async () => {
    const r = await ECHOBOOK_HANDLERS["echobook.posts.search"]!({}, { loopMode: "off", approved: false });
    expect(r.success).toBe(false);
    expect(r.output).toContain("q");
  });

  it("echobook.comments.get fails without postId", async () => {
    const r = await ECHOBOOK_HANDLERS["echobook.comments.get"]!({}, { loopMode: "off", approved: false });
    expect(r.success).toBe(false);
    expect(r.output).toContain("postId");
  });

  it("echobook.comment.create fails without postId and content", async () => {
    const r = await ECHOBOOK_HANDLERS["echobook.comment.create"]!({}, { loopMode: "off", approved: false });
    expect(r.success).toBe(false);
    expect(r.output).toContain("postId");
  });

  it("echobook.profile.get fails without address", async () => {
    const r = await ECHOBOOK_HANDLERS["echobook.profile.get"]!({}, { loopMode: "off", approved: false });
    expect(r.success).toBe(false);
    expect(r.output).toContain("address");
  });

  it("echobook.profile.search fails without q", async () => {
    const r = await ECHOBOOK_HANDLERS["echobook.profile.search"]!({}, { loopMode: "off", approved: false });
    expect(r.success).toBe(false);
    expect(r.output).toContain("q");
  });

  it("echobook.follow.toggle fails without userId", async () => {
    const r = await ECHOBOOK_HANDLERS["echobook.follow.toggle"]!({}, { loopMode: "off", approved: false });
    expect(r.success).toBe(false);
    expect(r.output).toContain("userId");
  });

  it("echobook.vote.post fails without postId and vote", async () => {
    const r = await ECHOBOOK_HANDLERS["echobook.vote.post"]!({}, { loopMode: "off", approved: false });
    expect(r.success).toBe(false);
    expect(r.output).toContain("postId");
  });

  it("echobook.vote.post fails with invalid vote", async () => {
    const r = await ECHOBOOK_HANDLERS["echobook.vote.post"]!({ postId: 1, vote: 5 }, { loopMode: "off", approved: false });
    expect(r.success).toBe(false);
    expect(r.output).toContain("1, -1, or 0");
  });

  it("echobook.repost fails without postId", async () => {
    const r = await ECHOBOOK_HANDLERS["echobook.repost"]!({}, { loopMode: "off", approved: false });
    expect(r.success).toBe(false);
    expect(r.output).toContain("postId");
  });

  it("echobook.submolt.get fails without slug", async () => {
    const r = await ECHOBOOK_HANDLERS["echobook.submolt.get"]!({}, { loopMode: "off", approved: false });
    expect(r.success).toBe(false);
    expect(r.output).toContain("slug");
  });

  it("echobook.points.events fails without address", async () => {
    const r = await ECHOBOOK_HANDLERS["echobook.points.events"]!({}, { loopMode: "off", approved: false });
    expect(r.success).toBe(false);
    expect(r.output).toContain("address");
  });

  it("echobook.tradeProof.submit fails without txHash", async () => {
    const r = await ECHOBOOK_HANDLERS["echobook.tradeProof.submit"]!({}, { loopMode: "off", approved: false });
    expect(r.success).toBe(false);
    expect(r.output).toContain("txHash");
  });

  it("echobook.tradeProof.get fails without txHash", async () => {
    const r = await ECHOBOOK_HANDLERS["echobook.tradeProof.get"]!({}, { loopMode: "off", approved: false });
    expect(r.success).toBe(false);
    expect(r.output).toContain("txHash");
  });
});
