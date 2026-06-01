import { describe, expect, it } from "vitest";

import type { EngineContext } from "../../../../vex-agent/engine/types.js";
import {
  buildPromptStack,
  buildMissionRunPrompt,
  buildMissionSetupPrompt,
  buildToolUsagePrompt,
} from "../../../../vex-agent/engine/prompts/index.js";

function makeMissionContext(overrides: Partial<EngineContext> = {}): EngineContext {
  return {
    sessionId: "session-1",
    sessionKind: "mission",
    sessionPermission: "restricted",
    missionId: "mission-1",
    missionRunId: null,
    isSubagent: false,
    loadedDocuments: new Map(),
    ...overrides,
  };
}

describe("mission state prompts", () => {
  it("makes mission setup a draft-planning flow with tool-backed readiness", () => {
    const prompt = buildMissionSetupPrompt(makeMissionContext());

    expect(prompt).toContain("Draft-first");
    expect(prompt).toContain("Do not do broad market research during setup");
    expect(prompt).toContain("research belongs after mission start unless the user explicitly asks for preflight research");
    expect(prompt).toContain("`mission_draft_update` is the source of truth for readiness");
  });

  it("treats partial meme-token mission ideas as draft input instead of research triggers", () => {
    const prompt = buildMissionSetupPrompt(makeMissionContext());

    expect(prompt).toContain("hunt Solana meme tokens with $6");
    expect(prompt).toContain("treat it as draft input");
    expect(prompt).toContain("Do not turn a partial mission idea into a token/market research session");
  });

  it("research workflow acknowledges mode-specific behavior (PR3 reorg)", () => {
    // PR3-clarity reorg: "Mode-specific instructions override this generic
    // research workflow" + the per-mode paragraphs were folded into a
    // single "Research workflow varies by mode" sentence + a Mission SETUP
    // / Mission RUN / Chat per-mode breakdown. Contract preserved (mission
    // setup is draft-first, mission run ends in an actionable decision,
    // chat answers and stops); phrasing tighter.
    const prompt = buildToolUsagePrompt();

    expect(prompt).toMatch(/Research workflow varies by mode/i);
    expect(prompt).toMatch(/Mission SETUP.*do not do broad market research/i);
    expect(prompt).toMatch(/Mission RUN.*end in an actionable decision/i);
    expect(prompt).toMatch(/Chat.*answer the current request/i);
  });

  it("makes active mission runs ignore stale setup start instructions", () => {
    const prompt = buildMissionRunPrompt(
      makeMissionContext({ missionRunId: "run-1" }),
      {
        missionPromptContext: "# Mission: SOL Sprint",
        iterationCount: 0,
      },
    );

    expect(prompt).toContain("started the run from the host UI (the Start or Continue control); the run is active");
    expect(prompt).toContain("Treat earlier setup messages asking the operator to start the mission as historical context only");
    expect(prompt).toContain("do not call `loop_defer` because you are waiting for mission activation");
    expect(prompt).toContain("each research loop must produce a shortlist, an execution candidate, a defer decision, or a contract-valid stop");
  });

});
