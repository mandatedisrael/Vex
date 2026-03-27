import { describe, it, expect } from "vitest";
import { SLOP_APP_HANDLERS } from "../../../echo-agent/tools/protocols/0g/slop-app/handlers.js";
import { SLOP_APP_TOOLS } from "../../../echo-agent/tools/protocols/0g/slop-app/manifest.js";

const ctx = { loopMode: "off" as const, approved: false };

describe("slop-app handlers", () => {
  // ── Structural integrity ─────────────────────────────────────────

  it("has a handler for every manifest toolId", () => {
    const handlerKeys = new Set(Object.keys(SLOP_APP_HANDLERS));
    const missing = SLOP_APP_TOOLS.map(t => t.toolId).filter(id => !handlerKeys.has(id));
    expect(missing).toEqual([]);
  });

  it("has no extra handlers without manifests", () => {
    const manifestIds = new Set(SLOP_APP_TOOLS.map(t => t.toolId));
    const extra = Object.keys(SLOP_APP_HANDLERS).filter(key => !manifestIds.has(key));
    expect(extra).toEqual([]);
  });

  it("handler count matches manifest count (10)", () => {
    expect(Object.keys(SLOP_APP_HANDLERS)).toHaveLength(10);
  });

  it("every handler is a function", () => {
    for (const [, handler] of Object.entries(SLOP_APP_HANDLERS)) {
      expect(typeof handler).toBe("function");
    }
  });

  // ── Required param validation (profile) ──────────────────────────

  it("slop-app.profile.register fails without username", async () => {
    const result = await SLOP_APP_HANDLERS["slop-app.profile.register"]!({}, ctx);
    expect(result.success).toBe(false);
    expect(result.output).toContain("username");
  });

  it("slop-app.profile.register fails with invalid username (too short)", async () => {
    const result = await SLOP_APP_HANDLERS["slop-app.profile.register"]!({ username: "ab" }, ctx);
    expect(result.success).toBe(false);
    expect(result.output).toContain("3-15");
  });

  it("slop-app.profile.register fails with invalid username (special chars)", async () => {
    const result = await SLOP_APP_HANDLERS["slop-app.profile.register"]!({ username: "hello world!" }, ctx);
    expect(result.success).toBe(false);
    expect(result.output).toContain("alphanumeric");
  });

  it("slop-app.profile.register fails with invalid twitter URL", async () => {
    const result = await SLOP_APP_HANDLERS["slop-app.profile.register"]!({ username: "valid_user", twitter: "https://twitter.com/bad" }, ctx);
    expect(result.success).toBe(false);
    expect(result.output).toContain("x.com");
  });

  it("slop-app.profile.register fails with avatarCid but no avatarGateway", async () => {
    const result = await SLOP_APP_HANDLERS["slop-app.profile.register"]!({ username: "valid_user", avatarCid: "Qm123" }, ctx);
    expect(result.success).toBe(false);
    expect(result.output).toContain("avatarCid");
    expect(result.output).toContain("avatarGateway");
  });

  // ── Required param validation (image) ────────────────────────────

  it("slop-app.image.upload fails without filePath", async () => {
    const result = await SLOP_APP_HANDLERS["slop-app.image.upload"]!({}, ctx);
    expect(result.success).toBe(false);
    expect(result.output).toContain("filePath");
  });

  it("slop-app.image.upload fails with nonexistent file", async () => {
    const result = await SLOP_APP_HANDLERS["slop-app.image.upload"]!({ filePath: "/nonexistent/file.png" }, ctx);
    expect(result.success).toBe(false);
    expect(result.output).toContain("Failed to read");
  });

  it("slop-app.image.generate fails without prompt", async () => {
    const result = await SLOP_APP_HANDLERS["slop-app.image.generate"]!({}, ctx);
    expect(result.success).toBe(false);
    expect(result.output).toContain("prompt");
  });

  it("slop-app.image.generate fails with too-long prompt", async () => {
    const result = await SLOP_APP_HANDLERS["slop-app.image.generate"]!({ prompt: "x".repeat(1001) }, ctx);
    expect(result.success).toBe(false);
    expect(result.output).toContain("1000");
  });

  // ── Required param validation (agents) ───────────────────────────

  it("slop-app.agents.query fails without source", async () => {
    const result = await SLOP_APP_HANDLERS["slop-app.agents.query"]!({}, ctx);
    expect(result.success).toBe(false);
    expect(result.output).toContain("source");
  });

  it("slop-app.agents.search fails without name", async () => {
    const result = await SLOP_APP_HANDLERS["slop-app.agents.search"]!({}, ctx);
    expect(result.success).toBe(false);
    expect(result.output).toContain("name");
  });

  it("slop-app.agents.search fails with too-long name", async () => {
    const result = await SLOP_APP_HANDLERS["slop-app.agents.search"]!({ name: "x".repeat(101) }, ctx);
    expect(result.success).toBe(false);
    expect(result.output).toContain("100");
  });

  // ── Required param validation (chat) ─────────────────────────────

  it("slop-app.chat.post fails without message", async () => {
    const result = await SLOP_APP_HANDLERS["slop-app.chat.post"]!({}, ctx);
    expect(result.success).toBe(false);
    expect(result.output).toContain("empty");
  });

  it("slop-app.chat.post fails with empty string message", async () => {
    const result = await SLOP_APP_HANDLERS["slop-app.chat.post"]!({ message: "   " }, ctx);
    expect(result.success).toBe(false);
    expect(result.output).toContain("empty");
  });

  it("slop-app.chat.post fails with too-long message", async () => {
    const result = await SLOP_APP_HANDLERS["slop-app.chat.post"]!({ message: "x".repeat(501) }, ctx);
    expect(result.success).toBe(false);
    expect(result.output).toContain("500");
  });

  it("slop-app.chat.read fails with out-of-range limit", async () => {
    const result = await SLOP_APP_HANDLERS["slop-app.chat.read"]!({ limit: 300 }, ctx);
    expect(result.success).toBe(false);
    expect(result.output).toContain("1-250");
  });

  it("slop-app.chat.read fails with limit 0", async () => {
    const result = await SLOP_APP_HANDLERS["slop-app.chat.read"]!({ limit: 0 }, ctx);
    expect(result.success).toBe(false);
    expect(result.output).toContain("1-250");
  });

  // ── Image format validation ──────────────────────────────────────

  it("slop-app.image.upload fails with unsupported extension", async () => {
    // Create a temp file with .txt extension
    const { writeFileSync, unlinkSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const tmpFile = join(tmpdir(), "test-slop-upload.txt");
    writeFileSync(tmpFile, "not an image");
    try {
      const result = await SLOP_APP_HANDLERS["slop-app.image.upload"]!({ filePath: tmpFile }, ctx);
      expect(result.success).toBe(false);
      expect(result.output).toContain("Invalid image format");
    } finally {
      unlinkSync(tmpFile);
    }
  });
});
