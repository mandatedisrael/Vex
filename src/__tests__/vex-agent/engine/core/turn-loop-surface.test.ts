/**
 * Surface guard — `engine/core/turn-loop.ts` façade.
 *
 * After the structural split lifted the public config/result shapes into
 * `turn-loop/state.ts`, the original path stays as a compatibility façade. The
 * orchestrator `runTurnLoop` and the in-loop closures remain in the façade; only
 * the pure type declarations moved. This test pins the EXACT public runtime
 * surface (every exported value present with the right `typeof`, and no extra
 * keys) so a future refactor cannot silently drop or add an export. The
 * importers (runner/{agent,shared,mission-run,setup-turn}.ts)
 * consume exactly `runTurnLoop` (value) + `TurnLoopConfig` (type).
 */

import { describe, it, expect } from "vitest";

import * as turnLoop from "@vex-agent/engine/core/turn-loop.js";
// Type-only imports of the re-exported types must compile through the façade.
import type {
  TurnLoopConfig,
  TurnLoopResult,
} from "@vex-agent/engine/core/turn-loop.js";

// Compile-time only: reference the exported types so a dropped/renamed type
// export fails `tsc`, not just the runtime-key assertion below.
type _ConfigRef = TurnLoopConfig;
type _ResultRef = TurnLoopResult;

describe("turn-loop façade surface", () => {
  it("exposes runTurnLoop as a function", () => {
    expect(typeof turnLoop.runTurnLoop).toBe("function");
  });

  it("exports the exact set of runtime keys (no drift)", () => {
    expect(Object.keys(turnLoop).sort()).toEqual(["runTurnLoop"].sort());
  });
});
