import { describe, it, expect } from "vitest";
import "./_dispatcher-test-mocks.js";
import { makeTestContext } from "./_test-context.js";

const { dispatchTool } = await import("../../../vex-agent/tools/dispatcher.js");

const baseContext = makeTestContext();

describe("dispatcher — web tools", () => {
  it("routes web_research search to live handler (fails without TAVILY_API_KEY, not stub)", async () => {
    const result = await dispatchTool(
      { name: "web_research", args: { query: "test" }, toolCallId: "call_9" },
      baseContext,
    );

    // Without TAVILY_API_KEY: returns error but NOT a [STUB]
    expect(result.output).not.toContain("[STUB]");
  });

  it("web_research fails on missing query/url (Zod XOR rejects neither)", async () => {
    const result = await dispatchTool(
      { name: "web_research", args: {}, toolCallId: "call_9b" },
      baseContext,
    );

    expect(result.success).toBe(false);
    expect(result.output).toMatch(/exactly one of `query` or `url`/);
  });

  it("web_research fails on invalid URL", async () => {
    const result = await dispatchTool(
      { name: "web_research", args: { url: "not-a-url" }, toolCallId: "call_9c" },
      baseContext,
    );

    expect(result.success).toBe(false);
    // Zod's z.string().url() rejects pre-handler; we expect a clean failure.
    expect(result.output.toLowerCase()).toMatch(/url|invalid/);
  });

  it("web_research fails when both query and url are set (Zod XOR rejects both)", async () => {
    const result = await dispatchTool(
      { name: "web_research", args: { query: "x", url: "https://example.com" }, toolCallId: "call_9d" },
      baseContext,
    );

    expect(result.success).toBe(false);
    expect(result.output).toMatch(/exactly one of `query` or `url`/);
  });
});
