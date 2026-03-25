import { describe, it, expect } from "vitest";
import { sanitizeContent } from "../../agent/tool-parser.js";

describe("sanitizeContent", () => {
  it("passes clean text through unchanged", () => {
    expect(sanitizeContent("Hello, how can I help?")).toBe("Hello, how can I help?");
  });

  it("strips closed <tool_call> blocks", () => {
    const input = "Before <tool_call>{\"name\":\"test\"}</tool_call> After";
    expect(sanitizeContent(input)).toBe("Before  After");
  });

  it("strips unclosed <tool_call> tags to end of string", () => {
    const input = "Before <tool_call>some leftover content";
    expect(sanitizeContent(input)).toBe("Before");
  });

  it("strips fenced tool_calls blocks", () => {
    const input = "Before ```tool_calls\n{\"name\":\"test\"}\n``` After";
    expect(sanitizeContent(input)).toBe("Before  After");
  });

  it("strips orphan closing </tool_call> tags", () => {
    const input = "Text </tool_call> more text";
    expect(sanitizeContent(input)).toBe("Text  more text");
  });

  it("strips </think> reasoning artifacts", () => {
    const input = "Answer text</think>";
    expect(sanitizeContent(input)).toBe("Answer text");
  });

  it("strips multiple artifacts in one pass", () => {
    const input = "<tool_call>x</tool_call>Text```tool_calls\ny\n```</think> final";
    expect(sanitizeContent(input)).toBe("Text final");
  });

  it("trims result", () => {
    const input = "  <tool_call>x</tool_call>  Hello  ";
    expect(sanitizeContent(input)).toBe("Hello");
  });

  it("returns empty string for all-artifact input", () => {
    const input = "<tool_call>test</tool_call>";
    expect(sanitizeContent(input)).toBe("");
  });

  it("preserves content between artifacts", () => {
    const input = "<tool_call>a</tool_call> keep this <tool_call>b</tool_call>";
    expect(sanitizeContent(input)).toBe("keep this");
  });
});
