/**
 * Eval: lifecycle — characterize F1 / F2 / F3 as MEASURED numbers (live Gemma).
 * Every assertion is green by asserting what-IS; the report records whether each
 * finding manifested.
 *
 * F1 — matured lesson absent from the hot LIST but COUNTED.
 *   Seed an `observed` / `established` / NULL-valid_until / unpinned lesson via
 *   the real insert path, then read the PRODUCTION façade `getTurnContext`:
 *     - countActiveHotContextEntries (banner N) COUNTS it,
 *     - listActiveForHotContext (the hot LIST) EXCLUDES it
 *       (`(pinned OR valid_until > now())` drops NULL valid_until).
 *
 * F2 — cold-start banner steers AWAY from search while candidates are searchable.
 *   With ONLY dual-trace candidates present (no hot-context entries), build the
 *   real `# Memory` section: the long-memory banner says "Skip
 *   long_memory_search" while `long_memory_search(include_candidates)` returns
 *   the candidates.
 *
 * F3 — recurrence + 7-day dual-trace TTL kills slow-recurring generalizations.
 *   Two observations of the SAME generalization > 7d apart: the older
 *   candidate's `retrieval_until` has elapsed, so the recurrence-cluster recall
 *   cannot see it → recurrence stays 1 → D7 `premature_generalization` retain →
 *   the lesson does NOT promote (no judge reached).
 */

import { describe, it, expect, beforeEach } from "vitest";

import { execute, query } from "@vex-agent/db/client.js";
import * as knowledgeRepo from "@vex-agent/db/repos/knowledge.js";
import { getTurnContext } from "@vex-agent/memory/turn-context.js";
import { buildMemorySection } from "@vex-agent/engine/prompts/memory-section.js";
import { ACTIVE_KNOWLEDGE_ENTRY_LIMIT } from "@vex-agent/knowledge/policy.js";
import { handleLongMemorySearch } from "@vex-agent/tools/internal/long-memory/search.js";
import type { InternalToolContext } from "@vex-agent/tools/internal/types.js";
import { makeSession, resetDb } from "../setup/fixtures.js";
import {
  seedPromotedLessonDirect,
  seedGemmaCandidate,
  driveConsolidateWithRealJudge,
} from "./_eval-fixtures.js";
import { reportCard } from "./_report-card.js";

const SUITE = "lifecycle";
const hasKey = !!process.env.OPENROUTER_API_KEY;

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

describe.skipIf(!hasKey)("eval: lifecycle (live)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("F1: a matured NULL-TTL unpinned lesson is COUNTED but absent from the hot LIST", async () => {
    const seeded = await seedPromotedLessonDirect({
      kind: "trade_lesson",
      title: "Confirmed-momentum scale-ins matured into a reliable pattern",
      summary:
        "Adding to winners on confirmed momentum has held up across many sessions and is now an established lesson.",
      source: "observed", // hot-context-eligible tier
      maturityState: "established", // matured past probationary
      validUntil: null, // the F1 trigger — NULL valid_until
      pinned: false,
    });

    const count = await knowledgeRepo.countActiveHotContextEntries();
    const hotList = await knowledgeRepo.listActiveForHotContext({
      limit: ACTIVE_KNOWLEDGE_ENTRY_LIMIT,
    });
    const inList = hotList.some((e) => e.id === seeded.id);

    // ASSERT WHAT-IS: counted but not listed (the F1 manifestation).
    expect(count).toBeGreaterThan(0);
    expect(inList).toBe(false);

    const manifested = count > 0 && !inList;
    reportCard.recordCheck(SUITE, {
      label: "F1: matured NULL-TTL lesson counted but not in hot list",
      pass: true,
      note: `count=${count} inHotList=${inList}`,
    });
    reportCard.recordFinding({
      code: "F1",
      manifested,
      summary: manifested
        ? `manifests: matured observed/established/NULL-TTL/unpinned lesson is COUNTED (banner N=${count}) but ABSENT from the hot list`
        : `not reproduced this run (count=${count} inList=${inList})`,
    });
  });

  it("F2: cold-start banner says Skip while dual-trace candidates ARE searchable", async () => {
    const session = await makeSession();
    const ctx = makeContext(session);

    // ONLY dual-trace candidates exist — NO promoted hot-context entries.
    await seedGemmaCandidate({
      sessionId: session,
      kind: "strategy_lesson",
      title: "Early signal: thin liquidity precedes bad fills",
      summary:
        "A repeated early observation that routing size through thin pools produced poor execution.",
    });
    await seedGemmaCandidate({
      sessionId: session,
      kind: "strategy_lesson",
      title: "Early signal: widening stops tends to deepen losses",
      summary:
        "An early observation that moving stops away from price made the eventual loss larger.",
    });

    // Build the REAL # Memory section from the production façade.
    const turnCtx = await getTurnContext({ sessionId: session });
    const section = buildMemorySection(turnCtx);
    const bannerSaysSkip = section.includes("Skip long_memory_search");

    // The candidates ARE searchable via the real handler.
    const searchRes = await handleLongMemorySearch(
      { query: "thin liquidity causing bad execution fills", include_candidates: true, k: 10 },
      ctx,
    );
    const searchData = (searchRes.data ?? {}) as { candidateCount?: number; results?: unknown[] };
    const candidatesSearchable =
      searchRes.success === true && (searchData.results?.length ?? 0) > 0;

    // ASSERT WHAT-IS: the banner suppresses search while results exist.
    expect(bannerSaysSkip).toBe(true);
    expect(candidatesSearchable).toBe(true);

    const manifested = bannerSaysSkip && candidatesSearchable;
    reportCard.recordCheck(SUITE, {
      label: "F2: banner 'Skip long_memory_search' while candidates searchable",
      pass: true,
      note: `bannerSaysSkip=${bannerSaysSkip} candidatesSearchable=${candidatesSearchable}`,
    });
    reportCard.recordFinding({
      code: "F2",
      manifested,
      summary: manifested
        ? "manifests: cold-start banner says 'Skip long_memory_search' while dual-trace candidates are returned by the search handler"
        : `not reproduced this run (skip=${bannerSaysSkip} searchable=${candidatesSearchable})`,
    });
  });

  it("F3: a generalization observed twice >7d apart does NOT promote (recurrence stays 1)", async () => {
    const session = await makeSession();

    // Two distinct execution anchors for the two observations.
    const execRows = await query<{ id: number }>(
      `INSERT INTO protocol_executions (tool_id, namespace, session_id, success)
       VALUES ('t','n',$1,TRUE),('t','n',$1,TRUE) RETURNING id`,
      [session],
    );
    const execOld = execRows[0]!.id;
    const execNew = execRows[1]!.id;

    // Observation #1 (the OLD one) — its dual-trace window has already elapsed.
    const first = await seedGemmaCandidate({
      sessionId: session,
      kind: "trade_lesson", // a generalization kind (recurrence-gated)
      title: "Scaling into confirmed momentum tends to pay off",
      summary:
        "Adding to a winning position on confirmed momentum has produced gains in the observed sample.",
      evidenceRefs: [{ executionId: execOld }],
    });
    // Age its retrieval window past the 7-day TTL — invisible to recurrence recall.
    await execute(
      `UPDATE memory_candidates SET retrieval_until = now() - interval '1 day' WHERE id = $1`,
      [first.candidateId],
    );

    // Observation #2 (the NEW one, judged now) — its own single fresh anchor.
    const second = await seedGemmaCandidate({
      sessionId: session,
      kind: "trade_lesson",
      title: "Scaling into confirmed momentum tends to pay off (again)",
      summary:
        "A second, later observation that adding to winners on confirmed momentum produced gains.",
      evidenceRefs: [{ executionId: execNew }],
      eventTime: new Date(),
    });

    // Drive: the recurrence cluster cannot see the expired first observation, so
    // recurrence stays 1 → D7 premature_generalization retain (no judge reached).
    const drive = await driveConsolidateWithRealJudge(second.candidateId, "f3-w1");

    const didNotPromote = drive.decisionType !== "promote";
    const noJudge = drive.llmCalls === 0;
    expect(didNotPromote).toBe(true);
    expect(noJudge).toBe(true);

    const manifested = didNotPromote && noJudge;
    reportCard.recordCheck(SUITE, {
      label: "F3: slow-recurring generalization retained, not promoted",
      pass: true,
      note: `decision=${drive.decisionType} llmCalls=${drive.llmCalls}`,
    });
    reportCard.recordFinding({
      code: "F3",
      manifested,
      summary: manifested
        ? `manifests: two observations >7d apart → older candidate's retrieval_until elapsed → recurrence stays 1 → D7 retain (decision=${drive.decisionType}, judge not reached)`
        : `not reproduced this run (decision=${drive.decisionType} llmCalls=${drive.llmCalls})`,
    });
  });
});
