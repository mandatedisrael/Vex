import { describe, it, expect } from "vitest";

import {
  formatMissionDraftUpdateSummary,
  formatStatus,
} from "../../../../local/vex-shell/app/lib/shellMessages.js";
import { createInitialState } from "../../../../local/vex-shell/app/state/store.js";

describe("vex-shell mission draft message formatting", () => {
  it("surfaces mission_draft_update tool failures", () => {
    expect(
      formatMissionDraftUpdateSummary("Tool mission_draft_update failed: invalid input syntax for type json"),
    ).toBe("Mission draft update failed: invalid input syntax for type json.");
  });

  it("includes token and context counters in /status", () => {
    const snapshot = createInitialState({
      provider: { name: "openrouter", detail: "model=test" },
      mode: "chat",
      wakeEnabled: true,
    });
    snapshot.session = {
      id: "session-1",
      kind: "chat",
      missionStatus: "running",
      fullAutonomousStatus: null,
      missionCommand: null,
      pendingApprovals: 0,
      usage: {
        sessionTokens: 12_345,
        sessionCost: 0.0123,
        requestCount: 4,
        lastRequestAt: "2026-05-03T08:15:00.000Z",
      },
      context: {
        promptTokens: 104_000,
        limit: 128_000,
        percent: 81.25,
        band: "warning",
      },
    };

    const status = formatStatus(snapshot);

    expect(status).toContain("Context: 104k/128k 81.3% warning");
    expect(status).toContain("Tokens: 12.3k total across 4 request(s)");
    expect(status).toContain("Cost: 0.0123");
  });
});
