/**
 * Deterministic stage (D1-D11) unit tests — pure rule logic, no DB.
 *
 * Names are self-documenting; gate codes appear only in comments.
 */

import { describe, it, expect } from "vitest";

import {
  runDeterministicStage,
  type DeterministicInput,
  type KnowledgeMatch,
} from "@vex-agent/memory/manager/deterministic-stage.js";
import { makeCandidate } from "./_fixtures.js";

function baseInput(overrides: Partial<DeterministicInput> = {}): DeterministicInput {
  return {
    candidate: makeCandidate(),
    liveStateRejected: false,
    evidenceSoftDeleted: false,
    anchorExists: true,
    evidenceStrengthCeiling: "moderate",
    exactDuplicate: false,
    knowledgeMatches: [],
    recurrenceCount: 2,
    isUserAffirmed: false,
    ...overrides,
  };
}

describe("deterministic stage", () => {
  it("rejects when the live-state re-scan trips (D1)", () => {
    const v = runDeterministicStage(baseInput({ liveStateRejected: true }));
    expect(v).toEqual({ kind: "reject", reason: "secret_or_live_state" });
  });

  it("rejects insufficient_evidence when an anchor session is soft-deleted (D2/OD-3)", () => {
    const v = runDeterministicStage(baseInput({ evidenceSoftDeleted: true }));
    expect(v).toEqual({ kind: "reject", reason: "insufficient_evidence" });
  });

  it("rejects duplicate on an exact content-hash match (D4)", () => {
    const v = runDeterministicStage(baseInput({ exactDuplicate: true }));
    expect(v).toEqual({ kind: "reject", reason: "duplicate" });
  });

  it("rejects a near-duplicate with no differing number or date and carries the matched id for reinforcement (D5)", () => {
    const matches: KnowledgeMatch[] = [
      {
        knowledgeId: 1,
        kind: "strategy_lesson",
        similarity: 0.97,
        text: "Paid boost plus buyer dominance signals a real chance with rising m5 volume.",
      },
    ];
    const candidate = makeCandidate({ title: "no numbers here", summary: "purely qualitative claim" });
    const v = runDeterministicStage(baseInput({ candidate, knowledgeMatches: matches }));
    // S6a: the near-dup match id rides along so consolidate can reinforce that
    // active entry (the candidate is a 2nd confirmation of an existing lesson).
    expect(v).toEqual({ kind: "reject", reason: "duplicate", reinforcesKnowledgeId: 1 });
  });

  it("does NOT treat a high-cosine match that differs on a number as a duplicate (Graphiti guardrail)", () => {
    const matches: KnowledgeMatch[] = [
      { knowledgeId: 1, kind: "strategy_lesson", similarity: 0.97, text: "threshold is 5% volume" },
    ];
    const candidate = makeCandidate({ title: "threshold is 12% volume", summary: "different number" });
    const v = runDeterministicStage(baseInput({ candidate, knowledgeMatches: matches }));
    expect(v.kind).toBe("escalate");
  });

  it("flags a same-kind conflict at moderate cosine carrying a differing number (D6)", () => {
    const matches: KnowledgeMatch[] = [
      { knowledgeId: 9, kind: "strategy_lesson", similarity: 0.88, text: "use 5% slippage" },
    ];
    const candidate = makeCandidate({ title: "use 12% slippage", summary: "revised number" });
    const v = runDeterministicStage(baseInput({ candidate, knowledgeMatches: matches }));
    expect(v.kind).toBe("escalate");
    if (v.kind === "escalate") {
      expect(v.signals.conflictFlag).toBe(true);
      expect(v.signals.conflictKnowledgeId).toBe(9);
    }
  });

  it("retains a mundane candidate (low importance + weak evidence) (D8)", () => {
    const candidate = makeCandidate({ importance: 2 });
    const v = runDeterministicStage(
      baseInput({ candidate, evidenceStrengthCeiling: "weak" }),
    );
    expect(v).toEqual({ kind: "retain", reason: "mundane" });
  });

  it("retains a low-confidence candidate that still has some evidence (D9)", () => {
    const candidate = makeCandidate({ confidence: 0.1 });
    const v = runDeterministicStage(
      baseInput({ candidate, evidenceStrengthCeiling: "weak" }),
    );
    expect(v).toEqual({ kind: "retain", reason: "low_confidence" });
  });

  it("rejects low_confidence only when evidence is also none (D9)", () => {
    const candidate = makeCandidate({ confidence: 0.1, importance: 8 });
    const v = runDeterministicStage(
      baseInput({ candidate, evidenceStrengthCeiling: "none", anchorExists: false }),
    );
    expect(v).toEqual({ kind: "reject", reason: "low_confidence" });
  });

  it("retains a generalization observed only once (recurrence n=1) (D-REC)", () => {
    // strategy_lesson is a generalization kind; n=1 → premature → retain.
    const v = runDeterministicStage(baseInput({ recurrenceCount: 1 }));
    expect(v).toEqual({ kind: "retain", reason: "premature_generalization" });
  });

  it("escalates a generalization with recurrence n>=2", () => {
    const v = runDeterministicStage(baseInput({ recurrenceCount: 2 }));
    expect(v.kind).toBe("escalate");
    if (v.kind === "escalate") {
      expect(v.signals.isGeneralization).toBe(true);
      expect(v.signals.recurrenceCount).toBe(2);
    }
  });

  it("expires a candidate past its retain_until TTL (D10)", () => {
    const candidate = makeCandidate({ retainUntil: "2000-01-01T00:00:00.000Z" });
    const v = runDeterministicStage(baseInput({ candidate, now: new Date("2026-01-01T00:00:00.000Z") }));
    expect(v).toEqual({ kind: "expire", reason: "expired_ttl" });
  });

  it("escalates a clean, well-anchored candidate carrying the computed signals", () => {
    const v = runDeterministicStage(baseInput({ evidenceStrengthCeiling: "moderate", recurrenceCount: 3 }));
    expect(v.kind).toBe("escalate");
    if (v.kind === "escalate") {
      expect(v.signals.evidenceStrengthCeiling).toBe("moderate");
      expect(v.signals.recurrenceCount).toBe(3);
      expect(v.signals.anchorExists).toBe(true);
    }
  });
});
