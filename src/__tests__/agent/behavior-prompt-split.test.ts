/**
 * Tests for behavior prompt mode-awareness (CORE vs AUTONOMOUS vs MANUAL_MODE_OVERRIDE).
 */

import { describe, it, expect } from "vitest";
import { getBehaviorInstructions } from "../../agent/prompts/behavior.js";

describe("getBehaviorInstructions", () => {
  it("defaults to 'off' when no mode passed", () => {
    const result = getBehaviorInstructions();
    expect(result).toContain("manual mode");
    expect(result).not.toContain("autonomous entity");
  });

  it("includes MANUAL_MODE_OVERRIDE for 'off' mode", () => {
    const result = getBehaviorInstructions("off");
    expect(result).toContain("You are in manual mode");
    expect(result).toContain("Do NOT proactively check");
  });

  it("does NOT include AUTONOMOUS_BEHAVIOR for 'off' mode", () => {
    const result = getBehaviorInstructions("off");
    expect(result).not.toContain("autonomous entity");
    expect(result).not.toContain("purpose is to win");
    expect(result).not.toContain("Trade Logging (MANDATORY)");
  });

  it("includes AUTONOMOUS_BEHAVIOR for 'restricted' mode", () => {
    const result = getBehaviorInstructions("restricted");
    expect(result).toContain("autonomous entity");
    expect(result).toContain("Trade Logging (MANDATORY)");
  });

  it("does NOT include MANUAL_MODE_OVERRIDE for 'restricted' mode", () => {
    const result = getBehaviorInstructions("restricted");
    expect(result).not.toContain("You are in manual mode");
    expect(result).not.toContain("Do NOT proactively check");
  });

  it("includes AUTONOMOUS_BEHAVIOR for 'full' mode", () => {
    const result = getBehaviorInstructions("full");
    expect(result).toContain("autonomous entity");
    expect(result).toContain("purpose is to win");
  });
});

describe("CORE_BEHAVIOR content (present in all modes)", () => {
  const modes = ["off", "restricted", "full"] as const;

  for (const mode of modes) {
    it(`contains Tool Priority section in '${mode}' mode`, () => {
      expect(getBehaviorInstructions(mode)).toContain("Tool Priority");
    });

    it(`contains safety rules in '${mode}' mode`, () => {
      expect(getBehaviorInstructions(mode)).toContain("Transfers are ALWAYS 2-step");
    });

    it(`contains Data Interpretation in '${mode}' mode (Skill Router removed)`, () => {
      // Skill Router removed — discover+execute routing replaces it
      expect(getBehaviorInstructions(mode)).not.toContain("Skill Router");
    });

    it(`contains Data Interpretation in '${mode}' mode`, () => {
      expect(getBehaviorInstructions(mode)).toContain("Data Interpretation");
    });

    it(`contains Response Format in '${mode}' mode`, () => {
      expect(getBehaviorInstructions(mode)).toContain("Response Format");
    });
  }
});

describe("AUTONOMOUS_BEHAVIOR content (restricted/full only)", () => {
  it("contains Prediction Markets section", () => {
    expect(getBehaviorInstructions("full")).toContain("Prediction Markets");
  });

  it("contains Scheduled Tasks section", () => {
    expect(getBehaviorInstructions("restricted")).toContain("Scheduled Tasks");
  });

  it("contains Knowledge Capture Workflow (not full Management — moved to Papa)", () => {
    expect(getBehaviorInstructions("full")).toContain("Knowledge");
    expect(getBehaviorInstructions("full")).toContain("CAPTURE information during work");
  });

  it("references Echo Papa for maintenance", () => {
    expect(getBehaviorInstructions("full")).toContain("Echo Papa");
    expect(getBehaviorInstructions("full")).toContain("Papa handles maintenance");
  });

  it("contains Subagents section", () => {
    expect(getBehaviorInstructions("restricted")).toContain("Subagents");
  });

  it("does NOT contain Knowledge Hygiene (moved to Papa)", () => {
    expect(getBehaviorInstructions("full")).not.toContain("Knowledge Hygiene");
    expect(getBehaviorInstructions("full")).not.toContain("bloated knowledge base degrades");
  });

  it("does NOT contain Self-Reflection section (capture trigger kept, but section moved)", () => {
    // Mama still captures reflections ("write a reflection in thoughts/") but the full section is Papa's domain
    expect(getBehaviorInstructions("full")).toContain("reflection in thoughts/");
    expect(getBehaviorInstructions("full")).not.toContain("What did I do well?");
  });
});

describe("prompt size comparison", () => {
  it("'off' mode prompt is significantly shorter than 'full' mode", () => {
    const offLength = getBehaviorInstructions("off").length;
    const fullLength = getBehaviorInstructions("full").length;
    // Manual mode should be at least 50% shorter
    expect(offLength).toBeLessThan(fullLength * 0.5);
  });

  it("'restricted' and 'full' mode prompts are the same length", () => {
    const restricted = getBehaviorInstructions("restricted").length;
    const full = getBehaviorInstructions("full").length;
    expect(restricted).toBe(full);
  });
});
