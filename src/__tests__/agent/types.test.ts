import { describe, it, expect } from "vitest";
import { toChatMode } from "../../agent/types.js";

describe("toChatMode", () => {
  it("accepts 'full'", () => {
    expect(toChatMode("full")).toBe("full");
  });

  it("accepts 'restricted'", () => {
    expect(toChatMode("restricted")).toBe("restricted");
  });

  it("accepts 'off'", () => {
    expect(toChatMode("off")).toBe("off");
  });

  it("defaults to 'restricted' for invalid string", () => {
    expect(toChatMode("invalid")).toBe("restricted");
    expect(toChatMode("auto")).toBe("restricted");
  });

  it("defaults to 'restricted' for non-string", () => {
    expect(toChatMode(null)).toBe("restricted");
    expect(toChatMode(undefined)).toBe("restricted");
    expect(toChatMode(42)).toBe("restricted");
    expect(toChatMode(true)).toBe("restricted");
  });
});
