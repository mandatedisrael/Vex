/**
 * Scenario registry — all E2E scenarios indexed by name.
 */

import type { Scenario } from "../core/scenario-runner.js";
import { pnlRoundtripScenario } from "./pnl-roundtrip.js";

export const ALL_SCENARIOS: Record<string, Scenario> = {
  "pnl-roundtrip": pnlRoundtripScenario,
};
