import { describe, it, expect } from "vitest";
import { parseOutcomePrices, parseOutcomes, parseClobTokenIds } from "@tools/polymarket/helpers.js";

describe("parseOutcomePrices", () => {
  it("parses valid JSON", () => {
    expect(parseOutcomePrices('["0.65","0.35"]')).toEqual({ yes: 0.65, no: 0.35 });
  });
  it("returns zeros for null", () => {
    expect(parseOutcomePrices(null)).toEqual({ yes: 0, no: 0 });
  });
  it("returns zeros for invalid JSON", () => {
    expect(parseOutcomePrices("not json")).toEqual({ yes: 0, no: 0 });
  });
});

describe("parseOutcomes", () => {
  it("parses valid JSON", () => {
    expect(parseOutcomes('["Yes","No"]')).toEqual(["Yes", "No"]);
  });
  it("returns defaults for null", () => {
    expect(parseOutcomes(null)).toEqual(["Yes", "No"]);
  });
});

describe("parseClobTokenIds", () => {
  it("parses valid JSON", () => {
    const result = parseClobTokenIds('["token-yes-123","token-no-456"]');
    expect(result.yes).toBe("token-yes-123");
    expect(result.no).toBe("token-no-456");
  });
  it("returns empty for null", () => {
    expect(parseClobTokenIds(null)).toEqual({ yes: "", no: "" });
  });
});
