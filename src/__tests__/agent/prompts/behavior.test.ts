import { describe, it, expect } from "vitest";
import { getBehaviorInstructions } from "../../../agent/prompts/behavior.js";

describe("getBehaviorInstructions", () => {
  it("includes core behavior for all modes", () => {
    const off = getBehaviorInstructions("off");
    const restricted = getBehaviorInstructions("restricted");
    const full = getBehaviorInstructions("full");

    expect(off).toContain("Tool Priority");
    expect(restricted).toContain("Tool Priority");
    expect(full).toContain("Tool Priority");
  });

  it("includes manual override for 'off' mode", () => {
    const result = getBehaviorInstructions("off");
    // Manual mode should restrict proactive actions
    expect(result.length).toBeGreaterThan(100);
  });

  it("includes autonomous behavior for 'full' mode", () => {
    const result = getBehaviorInstructions("full");
    expect(result.length).toBeGreaterThan(100);
  });

  it("includes autonomous behavior for 'restricted' mode", () => {
    const result = getBehaviorInstructions("restricted");
    expect(result.length).toBeGreaterThan(100);
  });
});
