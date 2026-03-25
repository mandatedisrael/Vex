import { describe, it, expect } from "vitest";
import { generateId } from "../../agent/id.js";

describe("generateId", () => {
  it("starts with the given prefix", () => {
    const id = generateId("session");
    expect(id.startsWith("session-")).toBe(true);
  });

  it("contains a UUID-like pattern after the prefix", () => {
    const id = generateId("tool");
    const uuidPart = id.slice("tool-".length);
    // UUID v4 pattern: 8-4-4-4-12 hex chars
    expect(uuidPart).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it("produces unique IDs on successive calls", () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateId("test")));
    expect(ids.size).toBe(100);
  });

  it("works with empty prefix", () => {
    const id = generateId("");
    expect(id.startsWith("-")).toBe(true);
  });

  it("works with special characters in prefix", () => {
    const id = generateId("sub-agent");
    expect(id.startsWith("sub-agent-")).toBe(true);
  });
});
