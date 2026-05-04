import { describe, expect, it } from "vitest";

import {
  isMissionActivityStatus,
  shouldPollTurnState,
} from "../../../../local/vex-shell/app/hooks/useTurnState.js";

describe("vex-shell live turn polling activation", () => {
  it("polls while a local turn is pending", () => {
    expect(shouldPollTurnState({ startedAt: Date.now() }, "draft")).toBe(true);
  });

  it("polls for active mission statuses even without a local pending turn", () => {
    expect(shouldPollTurnState(null, "running")).toBe(true);
    expect(shouldPollTurnState(null, "paused_approval")).toBe(true);
    expect(shouldPollTurnState(null, "paused_wake")).toBe(true);
  });

  it("polls for active full-autonomous statuses", () => {
    expect(shouldPollTurnState(null, null, "running")).toBe(true);
    expect(shouldPollTurnState(null, null, "paused_wake")).toBe(true);
  });

  it("does not poll idle mission setup or terminal states", () => {
    expect(isMissionActivityStatus("draft")).toBe(false);
    expect(isMissionActivityStatus("ready")).toBe(false);
    expect(isMissionActivityStatus("completed")).toBe(false);
    expect(shouldPollTurnState(null, null)).toBe(false);
  });
});
