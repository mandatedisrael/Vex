import { describe, expect, it } from "vitest";

import { parseModelProvider } from "../parseModelProvider.js";

describe("parseModelProvider", () => {
  it("extracts the lowercased prefix from a normal openrouter id", () => {
    expect(parseModelProvider("deepseek/deepseek-v4-flash")).toBe("deepseek");
    expect(parseModelProvider("anthropic/claude-sonnet-4.5")).toBe("anthropic");
    expect(parseModelProvider("openai/gpt-4")).toBe("openai");
  });

  it("lowercases mixed-case prefixes", () => {
    expect(parseModelProvider("WEIRD/foo")).toBe("weird");
    expect(parseModelProvider("OpenAI/gpt-4o-mini")).toBe("openai");
  });

  it("trims surrounding whitespace inside the prefix", () => {
    expect(parseModelProvider("  anthropic /claude-haiku")).toBe("anthropic");
  });

  it("returns null when the id has no slash", () => {
    expect(parseModelProvider("noslash")).toBeNull();
    expect(parseModelProvider("anthropic")).toBeNull();
  });

  it("returns null when the prefix is empty or whitespace-only", () => {
    expect(parseModelProvider("/foo")).toBeNull();
    expect(parseModelProvider("   /foo")).toBeNull();
  });

  it("returns null for empty input", () => {
    expect(parseModelProvider("")).toBeNull();
  });

  it("handles ids that include nested slashes by taking the first segment", () => {
    expect(parseModelProvider("anthropic/claude/3.5")).toBe("anthropic");
  });
});
