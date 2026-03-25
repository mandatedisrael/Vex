import { describe, it, expect } from "vitest";
import { getModeDescription, buildCurrentDateSection, buildLoadedKnowledgeSection } from "../../../agent/prompts/system.js";

describe("getModeDescription", () => {
  it("returns MANUAL for 'off'", () => {
    expect(getModeDescription("off")).toContain("MANUAL");
  });

  it("returns RESTRICTED for 'restricted'", () => {
    expect(getModeDescription("restricted")).toContain("RESTRICTED");
  });

  it("returns FULL AUTONOMOUS for 'full'", () => {
    expect(getModeDescription("full")).toContain("FULL AUTONOMOUS");
  });
});

describe("buildCurrentDateSection", () => {
  it("includes ISO date", () => {
    const date = new Date("2026-03-25T12:00:00Z");
    const result = buildCurrentDateSection(date);
    expect(result).toContain("2026-03-25");
  });

  it("includes weekday name", () => {
    const date = new Date("2026-03-25T12:00:00Z");
    const result = buildCurrentDateSection(date);
    expect(result).toContain("Wednesday");
  });

  it("uses current date when no arg", () => {
    const result = buildCurrentDateSection();
    expect(result).toContain("Current Date");
  });
});

describe("buildLoadedKnowledgeSection", () => {
  it("returns null for empty map", () => {
    expect(buildLoadedKnowledgeSection(new Map())).toBeNull();
  });

  it("includes file path and content", () => {
    const files = new Map([["skills/trading.md", "Buy low sell high"]]);
    const result = buildLoadedKnowledgeSection(files);
    expect(result).toContain("skills/trading.md");
    expect(result).toContain("Buy low sell high");
  });

  it("includes multiple files", () => {
    const files = new Map([
      ["a.md", "Content A"],
      ["b.md", "Content B"],
    ]);
    const result = buildLoadedKnowledgeSection(files);
    expect(result).toContain("a.md");
    expect(result).toContain("b.md");
  });
});
