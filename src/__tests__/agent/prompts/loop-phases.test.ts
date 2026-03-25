import { describe, it, expect } from "vitest";
import { buildPhasePrompt, buildScheduledAlertPrompt } from "../../../agent/prompts/loop-phases.js";

describe("buildPhasePrompt", () => {
  it("returns sense phase prompt", () => {
    const prompt = buildPhasePrompt("sense");
    expect(prompt).toContain("SENSE PHASE");
    expect(prompt).toContain("portfolio balances");
  });

  it("returns assess phase prompt", () => {
    const prompt = buildPhasePrompt("assess");
    expect(prompt).toContain("ASSESS PHASE");
  });

  it("returns decide phase prompt", () => {
    const prompt = buildPhasePrompt("decide");
    expect(prompt).toContain("DECIDE PHASE");
    expect(prompt).toContain("[NO ACTION]");
  });

  it("returns execute phase prompt", () => {
    const prompt = buildPhasePrompt("execute");
    expect(prompt).toContain("EXECUTE PHASE");
  });

  it("returns verify phase prompt", () => {
    const prompt = buildPhasePrompt("verify");
    expect(prompt).toContain("VERIFY PHASE");
  });

  it("returns journal phase prompt", () => {
    const prompt = buildPhasePrompt("journal");
    expect(prompt).toContain("JOURNAL PHASE");
  });

  it("returns empty string for idle phase", () => {
    expect(buildPhasePrompt("idle")).toBe("");
  });

  it("returns empty string for sleep phase", () => {
    expect(buildPhasePrompt("sleep")).toBe("");
  });

  it("prepends previous phase output when provided", () => {
    const prompt = buildPhasePrompt("assess", "Portfolio: $1000");
    expect(prompt).toContain("Previous phase output:");
    expect(prompt).toContain("Portfolio: $1000");
    expect(prompt).toContain("ASSESS PHASE");
  });

  it("does not prepend when no previous output", () => {
    const prompt = buildPhasePrompt("sense");
    expect(prompt).not.toContain("Previous phase output:");
  });
});

describe("buildScheduledAlertPrompt", () => {
  it("includes the alert message", () => {
    const prompt = buildScheduledAlertPrompt("Check SOL price");
    expect(prompt).toContain("SCHEDULED ALERT");
    expect(prompt).toContain("Check SOL price");
  });
});
