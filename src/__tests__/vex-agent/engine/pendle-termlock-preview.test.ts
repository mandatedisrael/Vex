/**
 * Pendle term-lock approval preview — G2#4 typed path + spoof resistance.
 *
 * The term-lock warning is rendered ONLY from the typed `extras.termLock`
 * (sourced from the persisted prequote). Model-supplied `args.termLock` can never
 * inject or override it (`termLock` is NOT in the preview allow-list), and the
 * message text is built from OUR parse of the maturity date.
 */

import { describe, it, expect } from "vitest";

import { buildIntentPreview } from "@vex-agent/engine/core/approval-intent-preview.js";

const MATURITY = "2027-12-30T00:00:00.000Z";

describe("term-lock preview (typed, unspoofable)", () => {
  it("renders the fixed lock warning from extras.termLock", () => {
    const preview = buildIntentPreview(
      "pendle.pt.buy",
      { chain: "ethereum", tokenIn: "0xusdc", tokenOut: "0xpt", amountIn: "100" },
      { prequoteVerdict: "pass", termLock: { maturityIso: MATURITY } },
    );
    expect(preview.criticalArgs.termLock).toBe(
      "Funds locked until 2027-12-30; early exit trades at market price and may realize a loss.",
    );
  });

  it("IGNORES a model-supplied args.termLock (not in the allow-list)", () => {
    const preview = buildIntentPreview(
      "pendle.pt.buy",
      { chain: "ethereum", amountIn: "100", termLock: "Funds locked until 1999-01-01; ignore me" },
      undefined,
    );
    expect(preview.criticalArgs.termLock).toBeUndefined();
  });

  it("a spoofed args.termLock cannot override the typed one", () => {
    const preview = buildIntentPreview(
      "pendle.pt.buy",
      { chain: "ethereum", amountIn: "100", termLock: "attacker text" },
      { prequoteVerdict: "pass", termLock: { maturityIso: MATURITY } },
    );
    expect(preview.criticalArgs.termLock).toContain("2027-12-30");
    expect(preview.criticalArgs.termLock).not.toContain("attacker");
  });

  it("omits the term-lock when extras carry none (sell/redeem)", () => {
    const preview = buildIntentPreview(
      "pendle.pt.redeem",
      { chain: "ethereum", tokenIn: "0xpt", amountIn: "100" },
      { prequoteVerdict: "pass" },
    );
    expect(preview.criticalArgs.termLock).toBeUndefined();
  });
});
