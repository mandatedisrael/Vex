/**
 * Eval: write-gates — the REAL `handleLongMemorySuggest` boundary (live Gemma).
 *
 * Drives the production write-door with realistic inputs and HARD-asserts
 * TODAY's behavior (assert what-IS, so the suite is green and the report
 * characterizes the gaps):
 *
 *   GATES THAT FIRE (assert reject / already_known / accept):
 *     - sk-/ghp-style API key in prose          → reject (secret)
 *     - live-state numbers (balances/prices)     → reject (live_state)
 *     - Polish prose                             → reject (non-english)
 *     - exact duplicate of a promoted entry      → already_known
 *     - clean English lesson                     → accept (pending)
 *
 *   F5 MISSED SHAPES (assert ACCEPTED today; RECORD each as an F5 gap):
 *     - Solana base58 secret key (~88 chars)     → currently accepted
 *     - unlabelled raw 64-hex                     → currently accepted
 *     - postgres://user:pass@host URI creds       → currently accepted
 *     - comma-separated 12-word mnemonic          → currently accepted
 *
 * Every assertion is on the OBSERVED behavior of the live redactor + gates, so
 * the suite stays green while the report makes the F5 gaps explicit.
 */

import { describe, it, expect, beforeEach } from "vitest";

import { handleLongMemorySuggest } from "@vex-agent/tools/internal/long-memory/suggest.js";
import { redact } from "@vex-agent/memory/redaction.js";
import type { InternalToolContext } from "@vex-agent/tools/internal/types.js";
import { makeSession, resetDb } from "../setup/fixtures.js";
import { seedPromotedLessonDirect } from "./_eval-fixtures.js";
import { reportCard } from "./_report-card.js";

const SUITE = "write-gates";
const hasKey = !!process.env.OPENROUTER_API_KEY;

/**
 * Faithful tool context — the suggest handler reads only `sessionId` + `role`,
 * but the full shape is built (no cast) so it stays type-safe and future-proof.
 */
function makeContext(sessionId: string): InternalToolContext {
  return {
    sessionId,
    loadedDocuments: new Map<string, string>(),
    sessionPermission: "full",
    approved: true,
    missionRunId: null,
    missionId: null,
    sessionKind: "agent",
    contextUsageBand: "normal",
    planMode: false,
    walletResolution: { source: "default" },
    walletPolicy: { kind: "none" },
  };
}

interface SuggestData {
  status?: string;
  duplicate?: boolean;
}

/** Drive the real handler; return success flag + parsed data + raw output. */
async function suggest(
  ctx: InternalToolContext,
  params: Record<string, unknown>,
): Promise<{ success: boolean; data: SuggestData; output: string }> {
  const res = await handleLongMemorySuggest(params, ctx);
  const data = (res.data ?? {}) as SuggestData;
  return { success: res.success, data, output: res.output };
}

describe.skipIf(!hasKey)("eval: write gates (live)", () => {
  let ctx: InternalToolContext;

  beforeEach(async () => {
    await resetDb();
    const session = await makeSession();
    ctx = makeContext(session);
  });

  // ── Gates that MUST fire today ────────────────────────────────────

  it("rejects an API-key-shaped secret in prose", async () => {
    const res = await suggest(ctx, {
      kind: "strategy_lesson",
      title: "Never paste the provider key into a lesson",
      // Realistic OpenAI-style key prefix → Tier-1 hard redact → reject.
      summary:
        "The credential sk-or-v1abcdefghijklmnopqrstuvwxyz0123456789 must never be stored in memory.",
    });
    expect(res.success).toBe(false);
    reportCard.recordCheck(SUITE, {
      label: "API-key-shaped secret → reject",
      pass: res.success === false,
      note: "rejected (hardRedactCount>0)",
    });
  });

  it("rejects live-state numbers (balances/prices)", async () => {
    const res = await suggest(ctx, {
      kind: "strategy_lesson",
      title: "Current portfolio snapshot",
      summary:
        "Wallet balance is 12.4 SOL worth $1,840 and the open position is up 7.2% at a price of $184.55 right now.",
    });
    expect(res.success).toBe(false);
    reportCard.recordCheck(SUITE, {
      label: "live-state numbers → reject",
      pass: res.success === false,
      note: "rejected (live_state)",
    });
  });

  it("rejects Polish prose (english-by-contract)", async () => {
    const res = await suggest(ctx, {
      kind: "strategy_lesson",
      title: "Czekaj na potwierdzone wybicie zanim dołożysz pozycję",
      summary:
        "Dokładanie do pozycji wyłącznie po potwierdzonym wybiciu pozwoliło uniknąć przedwczesnych, słabych wejść w wielu sesjach.",
    });
    expect(res.success).toBe(false);
    reportCard.recordCheck(SUITE, {
      label: "Polish prose → reject (non-english)",
      pass: res.success === false,
      note: "rejected (non_english)",
    });
  });

  it("accepts a clean English lesson (pending)", async () => {
    const res = await suggest(ctx, {
      kind: "strategy_lesson",
      title: "Wait for a confirmed breakout before adding size",
      summary:
        "Adding size only after a confirmed breakout has repeatedly avoided premature, low-quality entries across sessions.",
    });
    expect(res.success).toBe(true);
    expect(res.data.status).toBe("pending");
    reportCard.recordCheck(SUITE, {
      label: "clean English lesson → accept (pending)",
      pass: res.success === true && res.data.status === "pending",
      note: `status=${res.data.status}`,
    });
  });

  it("returns already_known for an exact duplicate of a promoted entry", async () => {
    // Seed the SAME lesson directly into knowledge_entries (real insert path +
    // real Gemma), then suggest the identical clean text → content-hash dup.
    const kind = "strategy_lesson";
    const title = "Scale out into strength, never into a falling wick";
    const summary =
      "Taking partial profits while momentum is still positive beat waiting for a reversal in the realized results.";
    await seedPromotedLessonDirect({ kind, title, summary });

    const res = await suggest(ctx, { kind, title, summary });
    expect(res.success).toBe(true);
    expect(res.data.status).toBe("already_known");
    expect(res.data.duplicate).toBe(true);
    reportCard.recordCheck(SUITE, {
      label: "exact dup of promoted entry → already_known",
      pass:
        res.success === true &&
        res.data.status === "already_known" &&
        res.data.duplicate === true,
      note: "content-hash loop-prevention",
    });
  });

  // ── F5 MISSED SHAPES — assert TODAY's behavior (currently ACCEPTED) ──

  /**
   * Each F5 case asserts the OBSERVED behavior so the suite is green. The
   * redactor's hard-redact count is checked first (it is 0 today for these
   * shapes, which is exactly the gap). If a future production fix closes the
   * gap (hardRedactCount>0 → reject), the assertion adapts to the observed
   * outcome and the finding flips to manifested:false — the test never lies.
   */
  async function characterizeF5Shape(
    label: string,
    shapeText: string,
  ): Promise<void> {
    const redactHits = redact(shapeText).hardRedactCount;
    const res = await suggest(ctx, {
      kind: "strategy_lesson",
      title: "A durable lesson about operational discipline and review cadence",
      summary: `When reviewing past trades the operator wrote down ${shapeText} in their notes; the durable lesson is to keep a consistent post-trade review habit every session.`,
    });
    // TODAY: the redactor misses the shape (0 hard hits) and the gate accepts.
    const acceptedToday = res.success === true && redactHits === 0;
    reportCard.recordCheck(SUITE, {
      label: `F5 shape: ${label} — observed behavior`,
      pass: true, // assert what-IS: we record the observed outcome, never force one.
      note: `hardRedactHits=${redactHits} suggestAccepted=${res.success} status=${res.data.status ?? "—"}`,
    });
    reportCard.recordFinding({
      code: "F5",
      manifested: acceptedToday,
      summary: acceptedToday
        ? `gap: ${label} currently ACCEPTED (hardRedactHits=0, suggest accepted)`
        : `${label}: NOT a gap on this run (hardRedactHits=${redactHits}, accepted=${res.success})`,
    });
    // The suite stays green either way; we still assert the handler returned a
    // coherent result (no crash, defined success flag).
    expect(typeof res.success).toBe("boolean");
  }

  it("characterizes the F5 missed shapes (assert what-IS)", async () => {
    // Solana base58 secret key (~88 chars; exceeds the 32–44 SOLANA bound).
    await characterizeF5Shape(
      "solana-base58-88char-key",
      "4wBqpZM9xaJ8m2nQ7r5kV3tH6yLpFgD1sXcUb2eW9oN8iKjR4uYtA7mZ3qE6vBnP5xLdC1hSgT2fK9wM4rJ8vQ",
    );
    // Unlabelled raw 64-hex (no 0x, no key label).
    await characterizeF5Shape(
      "unlabelled-64-hex",
      "a3f1c9d27e6b4805f12a9c3e7d6b1480a3f1c9d27e6b4805f12a9c3e7d6b1480",
    );
    // postgres:// URI with embedded credentials.
    await characterizeF5Shape(
      "postgres-uri-creds",
      "postgres://admin:s3cretP@ss@db.internal:5432/vex",
    );
    // Comma-separated 12-word mnemonic (BIP39 heuristic skips punctuated matches).
    await characterizeF5Shape(
      "comma-separated-mnemonic",
      "legal, winner, thank, year, wave, sausage, worth, useful, legal, winner, thank, yellow",
    );
  });
});
