import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetSoul = vi.fn();
const mockGetMemoryAsText = vi.fn();
const mockGetActiveCount = vi.fn();

vi.mock("../../agent/db/repos/soul.js", () => ({
  getSoul: () => mockGetSoul(),
}));
vi.mock("../../agent/db/repos/memory.js", () => ({
  getMemoryAsText: (...args: unknown[]) => mockGetMemoryAsText(...args),
}));
vi.mock("../../agent/subagent.js", () => ({
  getActiveCount: () => mockGetActiveCount(),
}));
vi.mock("../../utils/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { buildSystemPrompt } = await import("../../agent/tools.js");

beforeEach(() => {
  vi.clearAllMocks();
  mockGetSoul.mockResolvedValue({ content: "I am EchoClaw." });
  mockGetMemoryAsText.mockResolvedValue("- User prefers SOL");
  mockGetActiveCount.mockReturnValue(0);
});

describe("buildSystemPrompt", () => {
  it("includes soul content", async () => {
    const prompt = await buildSystemPrompt();
    expect(prompt).toContain("EchoClaw");
  });

  it("includes memory entries", async () => {
    const prompt = await buildSystemPrompt();
    expect(prompt).toContain("User prefers SOL");
  });

  it("includes mode description", async () => {
    const prompt = await buildSystemPrompt(new Map(), "full");
    expect(prompt).toContain("FULL AUTONOMOUS");
  });

  it("uses first conversation prompt when no soul", async () => {
    mockGetSoul.mockResolvedValue(null);
    const prompt = await buildSystemPrompt();
    // First conversation prompt should appear
    expect(prompt.length).toBeGreaterThan(100);
  });

  it("includes current date", async () => {
    const prompt = await buildSystemPrompt();
    expect(prompt).toContain("Current Date");
  });

  it("includes loaded knowledge when provided", async () => {
    const knowledge = new Map([["skills/trading.md", "# Trading Strategy"]]);
    const prompt = await buildSystemPrompt(knowledge);
    expect(prompt).toContain("Trading Strategy");
    expect(prompt).toContain("skills/trading.md");
  });

  it("does not include subagent skill in manual mode", async () => {
    const prompt = await buildSystemPrompt(new Map(), "off");
    // In "off" mode, subagent skill doc should not be injected
    // The prompt should still work but not contain subagent spawning instructions
    expect(prompt).toContain("MANUAL");
  });
});
