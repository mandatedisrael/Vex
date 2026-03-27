import { describe, it, expect } from "vitest";
import { SLOP_APP_TOOLS } from "../../../echo-agent/tools/protocols/0g/slop-app/manifest.js";

describe("slop-app manifest", () => {
  it("has 10 tools total", () => {
    expect(SLOP_APP_TOOLS).toHaveLength(10);
  });

  const EXPECTED_TOOL_IDS = [
    // Profile (2)
    "slop-app.profile.show",
    "slop-app.profile.register",
    // Image (2)
    "slop-app.image.upload",
    "slop-app.image.generate",
    // Agents (4)
    "slop-app.agents.query",
    "slop-app.agents.trending",
    "slop-app.agents.newest",
    "slop-app.agents.search",
    // Chat (2)
    "slop-app.chat.post",
    "slop-app.chat.read",
  ];

  it("expected toolId count matches manifest count", () => {
    expect(EXPECTED_TOOL_IDS).toHaveLength(10);
  });

  for (const toolId of EXPECTED_TOOL_IDS) {
    it(`declares ${toolId}`, () => {
      expect(SLOP_APP_TOOLS.find(t => t.toolId === toolId)).toBeDefined();
    });
  }

  it("has no tools beyond expected list", () => {
    const expectedSet = new Set(EXPECTED_TOOL_IDS);
    expect(SLOP_APP_TOOLS.filter(t => !expectedSet.has(t.toolId))).toHaveLength(0);
  });

  it("all tools belong to slop-app namespace", () => {
    for (const tool of SLOP_APP_TOOLS) expect(tool.namespace).toBe("slop-app");
  });

  it("all tools are active lifecycle", () => {
    for (const tool of SLOP_APP_TOOLS) expect(tool.lifecycle).toBe("active");
  });

  it("all toolIds start with slop-app.", () => {
    for (const tool of SLOP_APP_TOOLS) expect(tool.toolId).toMatch(/^slop-app\./);
  });

  // ── Mutating classification ──────────────────────────────────────

  const EXPECTED_MUTATING = [
    "slop-app.profile.register",
    "slop-app.image.upload",
    "slop-app.image.generate",
    "slop-app.chat.post",
  ];

  it("has correct number of mutating tools (4)", () => {
    expect(SLOP_APP_TOOLS.filter(t => t.mutating)).toHaveLength(4);
  });

  for (const toolId of EXPECTED_MUTATING) {
    it(`${toolId} is mutating`, () => {
      expect(SLOP_APP_TOOLS.find(t => t.toolId === toolId)!.mutating).toBe(true);
    });
  }

  it("read-only tools are not mutating", () => {
    const mutatingSet = new Set(EXPECTED_MUTATING);
    for (const tool of SLOP_APP_TOOLS.filter(t => !mutatingSet.has(t.toolId))) {
      expect(tool.mutating).toBe(false);
    }
  });

  // ── Required params ──────────────────────────────────────────────

  it("slop-app.profile.register requires username", () => {
    const tool = SLOP_APP_TOOLS.find(t => t.toolId === "slop-app.profile.register")!;
    const required = tool.params.filter(p => p.required).map(p => p.key);
    expect(required).toContain("username");
  });

  it("slop-app.profile.show has no required params", () => {
    const tool = SLOP_APP_TOOLS.find(t => t.toolId === "slop-app.profile.show")!;
    expect(tool.params.filter(p => p.required)).toHaveLength(0);
  });

  it("slop-app.image.upload requires filePath", () => {
    const tool = SLOP_APP_TOOLS.find(t => t.toolId === "slop-app.image.upload")!;
    const required = tool.params.filter(p => p.required).map(p => p.key);
    expect(required).toEqual(["filePath"]);
  });

  it("slop-app.image.generate requires prompt", () => {
    const tool = SLOP_APP_TOOLS.find(t => t.toolId === "slop-app.image.generate")!;
    const required = tool.params.filter(p => p.required).map(p => p.key);
    expect(required).toEqual(["prompt"]);
  });

  it("slop-app.agents.query requires source", () => {
    const tool = SLOP_APP_TOOLS.find(t => t.toolId === "slop-app.agents.query")!;
    const required = tool.params.filter(p => p.required).map(p => p.key);
    expect(required).toEqual(["source"]);
  });

  it("slop-app.agents.trending has no required params", () => {
    const tool = SLOP_APP_TOOLS.find(t => t.toolId === "slop-app.agents.trending")!;
    expect(tool.params.filter(p => p.required)).toHaveLength(0);
  });

  it("slop-app.agents.search requires name", () => {
    const tool = SLOP_APP_TOOLS.find(t => t.toolId === "slop-app.agents.search")!;
    const required = tool.params.filter(p => p.required).map(p => p.key);
    expect(required).toEqual(["name"]);
  });

  it("slop-app.chat.post requires message", () => {
    const tool = SLOP_APP_TOOLS.find(t => t.toolId === "slop-app.chat.post")!;
    const required = tool.params.filter(p => p.required).map(p => p.key);
    expect(required).toEqual(["message"]);
  });

  it("slop-app.chat.read has no required params", () => {
    const tool = SLOP_APP_TOOLS.find(t => t.toolId === "slop-app.chat.read")!;
    expect(tool.params.filter(p => p.required)).toHaveLength(0);
  });

  // ── Quality checks ───────────────────────────────────────────────

  it("every tool has non-empty description", () => {
    for (const tool of SLOP_APP_TOOLS) expect(tool.description.length).toBeGreaterThan(15);
  });

  it("every param has non-empty description", () => {
    for (const tool of SLOP_APP_TOOLS) {
      for (const param of tool.params) expect(param.description.length).toBeGreaterThan(3);
    }
  });

  it("no tools require ENV", () => {
    for (const tool of SLOP_APP_TOOLS) expect((tool as Record<string, unknown>).requiresEnv).toBeUndefined();
  });
});
