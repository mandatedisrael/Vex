import { describe, it, expect } from "vitest";
import { getCompactionSystemPrompt, buildCompactionPrompt } from "../../../agent/prompts/compaction.js";
import { mockMessage } from "../_fixtures.js";

describe("getCompactionSystemPrompt", () => {
  it("returns session summarizer prompt", () => {
    const prompt = getCompactionSystemPrompt();
    expect(prompt).toContain("session summarizer");
  });
});

describe("buildCompactionPrompt", () => {
  it("includes message transcript", () => {
    const messages = [
      mockMessage("user", "What is SOL price?"),
      mockMessage("assistant", "SOL is at $150"),
    ];
    const prompt = buildCompactionPrompt(messages);
    expect(prompt).toContain("SOL price");
    expect(prompt).toContain("$150");
  });

  it("excludes system messages from transcript", () => {
    const messages = [
      mockMessage("system", "System instructions here"),
      mockMessage("user", "Hello"),
    ];
    const prompt = buildCompactionPrompt(messages);
    expect(prompt).not.toContain("System instructions");
    expect(prompt).toContain("Hello");
  });

  it("includes loaded file paths", () => {
    const prompt = buildCompactionPrompt([], ["skills/trading.md", "journal/2026-03.md"]);
    expect(prompt).toContain("skills/trading.md");
    expect(prompt).toContain("journal/2026-03.md");
  });

  it("notes when no files were loaded", () => {
    const prompt = buildCompactionPrompt([]);
    expect(prompt).toContain("No knowledge files");
  });

  it("truncates long messages", () => {
    const longContent = "x".repeat(1000);
    const messages = [mockMessage("user", longContent)];
    const prompt = buildCompactionPrompt(messages);
    // Content should be truncated to 500 chars
    const transcript = prompt.split("Session transcript:")[1];
    expect(transcript.length).toBeLessThan(longContent.length);
  });

  it("includes required section headers", () => {
    const prompt = buildCompactionPrompt([]);
    expect(prompt).toContain("## Session Summary");
    expect(prompt).toContain("## Continuation Context");
    expect(prompt).toContain("## Key Insights");
  });
});
