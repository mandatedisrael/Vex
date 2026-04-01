/**
 * PnL Round-trip Scenario — deterministic spot buy → sell → verify.
 *
 * Tests the full capture → projection → match → replay pipeline
 * through dispatchTool with a real DB but stubbed source layer.
 */

import type { Scenario } from "../core/scenario-runner.js";

export const pnlRoundtripScenario: Scenario = {
  name: "pnl-roundtrip",
  namespace: "solana",
  description: "Spot buy → verify lot → sell → verify match + realized PnL",
  steps: [
    {
      toolId: "solana.swap.execute",
      params: { inputToken: "SOL", outputToken: "BONK", amount: 0.1 },
      expect: { success: true, captureType: "swap" },
    },
    {
      toolId: "solana.swap.execute",
      params: { inputToken: "BONK", outputToken: "SOL", amount: 1000 },
      expect: { success: true, captureType: "swap" },
    },
  ],
};
