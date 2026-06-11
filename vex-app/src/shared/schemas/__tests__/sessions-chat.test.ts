import { describe, expect, it } from "vitest";
import { chatStopReasonSchema, chatSubmitInputSchema } from "../chat.js";
import { sessionCreateInputSchema, sessionModelDtoSchema } from "../sessions.js";

describe("sessionCreateInputSchema", () => {
  it("accepts mission creation without an initial goal", () => {
    const parsed = sessionCreateInputSchema.safeParse({
      mode: "mission",
      name: "LP rebalance",
      permission: "restricted",
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects goal text in the create-session payload", () => {
    const parsed = sessionCreateInputSchema.safeParse({
      mode: "mission",
      name: "LP rebalance",
      permission: "restricted",
      initialGoal: "Rebalance Arbitrum LP",
    });
    expect(parsed.success).toBe(false);
  });
});

describe("chatSubmitInputSchema", () => {
  it("trims and accepts the first mission goal as chat text", () => {
    const parsed = chatSubmitInputSchema.safeParse({
      sessionId: "11111111-1111-4111-8111-111111111111",
      message: "  Rebalance Arbitrum LP  ",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.message).toBe("Rebalance Arbitrum LP");
    }
  });

  // S6: reasoningEffort is OPTIONAL + additive — absent means engine default.
  it("accepts the optional per-turn reasoningEffort levels", () => {
    for (const effort of ["low", "medium", "high"] as const) {
      const parsed = chatSubmitInputSchema.safeParse({
        sessionId: "11111111-1111-4111-8111-111111111111",
        message: "think hard",
        reasoningEffort: effort,
      });
      expect(parsed.success).toBe(true);
    }
  });

  it("rejects reasoning efforts outside the v1 enum (no xhigh/minimal/none)", () => {
    for (const effort of ["xhigh", "minimal", "none", "max"]) {
      const parsed = chatSubmitInputSchema.safeParse({
        sessionId: "11111111-1111-4111-8111-111111111111",
        message: "think hard",
        reasoningEffort: effort,
      });
      expect(parsed.success).toBe(false);
    }
  });
});

describe("sessionModelDtoSchema (S6 reasoning capability)", () => {
  const baseDto = {
    sessionId: "11111111-1111-4111-8111-111111111111",
    provider: "openrouter",
    modelId: "anthropic/claude-sonnet-4",
    source: "global_default",
    updatedAt: null,
  };

  it("accepts supportsReasoning true/false/null", () => {
    for (const supportsReasoning of [true, false, null]) {
      const parsed = sessionModelDtoSchema.safeParse({
        ...baseDto,
        supportsReasoning,
      });
      expect(parsed.success).toBe(true);
    }
  });

  it("requires the supportsReasoning field (strict DTO)", () => {
    const parsed = sessionModelDtoSchema.safeParse(baseDto);
    expect(parsed.success).toBe(false);
  });
});

describe("chatStopReasonSchema (engine StopReason mirror)", () => {
  // The engine's full StopReason union (src/vex-agent/engine/types.ts —
  // BusinessStopReason | RuntimeStopReason), enumerated here BY HAND because
  // src/shared must not import vex-agent. chat.submit pipes the engine's
  // stopReason straight into the validated output (and the paused_wake
  // preempt branch can surface ANY turn-loop stop reason via
  // resumeMissionRun), so a member missing from the schema turns a
  // successful turn into an internal.unexpected IPC error. If this list
  // drifts from the engine union, update BOTH the schema and this test.
  const ENGINE_STOP_REASONS = [
    "goal_reached",
    "deadline_reached",
    "capital_depleted",
    "max_loss_hit",
    "no_viable_opportunity",
    "emergency_stop",
    "user_stopped",
    "approval_required",
    "checkpoint_pause",
    "iteration_limit",
    "timeout",
    "waiting_for_parent",
    "waiting_for_wake",
    "waiting_for_compact_commit",
    "compact_unable_at_critical",
    "system_error",
    "user_paused",
    "plan_acceptance_required",
  ] as const;

  it("accepts every engine StopReason member (S7 fix: user_paused + plan_acceptance_required)", () => {
    for (const reason of ENGINE_STOP_REASONS) {
      const parsed = chatStopReasonSchema.safeParse(reason);
      expect(parsed.success, `stop reason "${reason}" must parse`).toBe(true);
    }
  });

  it("rejects values outside the engine union", () => {
    for (const reason of ["paused", "plan_pause", "unknown", ""]) {
      expect(chatStopReasonSchema.safeParse(reason).success).toBe(false);
    }
  });
});
