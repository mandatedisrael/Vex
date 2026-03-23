import { describe, expect, it } from "vitest";
import { buildCompactionPrompt, getCompactionSystemPrompt } from "../../agent/prompts/compaction.js";
import type { Message } from "../../agent/types.js";

const msg = (role: Message["role"], content: string): Message => ({
  role,
  content,
  timestamp: "2026-03-22T10:00:00Z",
});

describe("getCompactionSystemPrompt", () => {
  it("returns a non-empty string", () => {
    const prompt = getCompactionSystemPrompt();
    expect(prompt.length).toBeGreaterThan(0);
    expect(prompt).toContain("summarizer");
  });
});

describe("buildCompactionPrompt", () => {
  it("filters out system messages from transcript", () => {
    const messages = [
      msg("system", "system instructions"),
      msg("user", "hello"),
      msg("assistant", "hi there"),
    ];
    const prompt = buildCompactionPrompt(messages);
    expect(prompt).not.toContain("[system]");
    expect(prompt).toContain("[user]: hello");
    expect(prompt).toContain("[assistant]: hi there");
  });

  it("truncates long messages", () => {
    const longContent = "A".repeat(1000);
    const messages = [msg("user", longContent)];
    const prompt = buildCompactionPrompt(messages);
    // Content in transcript should be truncated to 500 chars
    const transcriptPart = prompt.split("Session transcript:")[1];
    expect(transcriptPart).toBeDefined();
    // The A's in the transcript should be 500 or fewer
    const aCount = (transcriptPart!.match(/A/g) ?? []).length;
    expect(aCount).toBeLessThanOrEqual(500);
  });

  it("includes loaded file paths when provided", () => {
    const messages = [msg("user", "hello")];
    const paths = ["trades/solana/sol-usdc.md", "references/dexscreener.md"];
    const prompt = buildCompactionPrompt(messages, paths);
    expect(prompt).toContain("trades/solana/sol-usdc.md");
    expect(prompt).toContain("references/dexscreener.md");
    expect(prompt).toContain("Loaded knowledge files");
  });

  it("shows 'No knowledge files' when paths is empty array", () => {
    const messages = [msg("user", "hello")];
    const prompt = buildCompactionPrompt(messages, []);
    expect(prompt).toContain("No knowledge files were loaded");
  });

  it("shows 'No knowledge files' when paths is undefined", () => {
    const messages = [msg("user", "hello")];
    const prompt = buildCompactionPrompt(messages);
    expect(prompt).toContain("No knowledge files were loaded");
  });

  it("contains all three required sections", () => {
    const messages = [msg("user", "test")];
    const prompt = buildCompactionPrompt(messages);
    expect(prompt).toContain("## Session Summary");
    expect(prompt).toContain("## Continuation Context");
    expect(prompt).toContain("## Key Insights for Memory");
  });

  it("contains continuation context instructions", () => {
    const messages = [msg("user", "test")];
    const prompt = buildCompactionPrompt(messages);
    expect(prompt).toContain("Last task in progress");
    expect(prompt).toContain("Files to re-read");
    expect(prompt).toContain("Next steps");
  });

  it("handles empty messages array", () => {
    const prompt = buildCompactionPrompt([]);
    expect(prompt).toContain("Session transcript:");
    // Should not throw, just produce a prompt with empty transcript
    expect(prompt.length).toBeGreaterThan(0);
  });
});
