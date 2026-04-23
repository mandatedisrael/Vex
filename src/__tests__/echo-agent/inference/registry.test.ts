import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Mock 0G compute readiness to avoid loading .cts SDK bridge in vitest
vi.mock("../../../tools/0g-compute/readiness.js", () => ({
  loadComputeState: () => null,
}));

const { resolveProvider, getActiveProvider, resetProvider, switchProvider } = await import(
  "../../../echo-agent/inference/registry.js"
);

describe("registry", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    resetProvider();
    for (const key of Object.keys(process.env)) {
      if (key.startsWith("AGENT_") || key.startsWith("OPENROUTER_")) {
        delete process.env[key];
      }
    }
  });

  afterEach(() => {
    resetProvider();
    process.env = { ...originalEnv };
  });

  it("getActiveProvider returns null before resolveProvider", () => {
    expect(getActiveProvider()).toBeNull();
  });

  it("returns null when no provider configured and no compute state", async () => {
    const provider = await resolveProvider();
    expect(provider).toBeNull();
  });

  it("caches provider after first resolve", async () => {
    const first = await resolveProvider();
    const second = await resolveProvider();
    expect(first).toBe(second);
  });

  it("resetProvider clears cache", async () => {
    await resolveProvider();
    resetProvider();
    expect(getActiveProvider()).toBeNull();
  });

  it("rejects invalid AGENT_PROVIDER early", async () => {
    process.env.AGENT_PROVIDER = "invalid-provider";
    await expect(resolveProvider()).rejects.toThrow("AGENT_PROVIDER");
  });

  it("switchProvider sets AGENT_PROVIDER and replaces cached instance", async () => {
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    process.env.AGENT_MODEL = "openai/gpt-4o";
    const first = await resolveProvider();
    expect(first).not.toBeNull();
    expect(first!.id).toBe("openrouter");

    const switched = await switchProvider("openrouter");
    expect(switched).not.toBeNull();
    expect(switched!.id).toBe("openrouter");
    expect(switched).not.toBe(first);
    expect(process.env.AGENT_PROVIDER).toBe("openrouter");
    expect(getActiveProvider()).toBe(switched);
  });
});
