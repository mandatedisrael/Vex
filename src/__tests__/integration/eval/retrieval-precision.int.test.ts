/**
 * Eval: retrieval precision — real Gemma corpus + golden queries (live).
 *
 * Seeds a ~12-entry promoted corpus via `seedPromotedLessonDirect` (REAL Gemma
 * vectors, real provider model/dim), then runs ~15 golden queries through the
 * production recall (`recallLongMemoryTopK`). MEASURED: precision@k (recorded in
 * the report). HARD assertions (deterministic facts):
 *   - a confirmed `observed` knowledge entry OUTRANKS an equal-text `inferred`
 *     dual-trace candidate (source-tier weighting beats candidate × 0.6),
 *   - superseded + expired entries NEVER surface in recall.
 */

import { describe, it, expect, beforeAll } from "vitest";

import { recallLongMemoryTopK } from "@vex-agent/db/repos/knowledge.js";
import { handleLongMemorySearch } from "@vex-agent/tools/internal/long-memory/search.js";
import { embedQuery } from "@vex-agent/embeddings/client.js";
import { execute } from "@vex-agent/db/client.js";
import type { InternalToolContext } from "@vex-agent/tools/internal/types.js";
import { makeSession, resetDb } from "../setup/fixtures.js";
import { seedPromotedLessonDirect, seedGemmaCandidate } from "./_eval-fixtures.js";
import { reportCard } from "./_report-card.js";

const SUITE = "retrieval-precision";
const hasKey = !!process.env.OPENROUTER_API_KEY;

/** A golden corpus row + the topic label golden queries map to. */
interface CorpusRow {
  topic: string;
  title: string;
  summary: string;
}

/** 12 distinct lessons across recognizable topics (for precision labelling). */
const CORPUS: CorpusRow[] = [
  { topic: "breakout", title: "Wait for a confirmed breakout before adding size", summary: "Adding size only after a confirmed breakout avoided premature entries." },
  { topic: "stoploss", title: "Honor the stop-loss instead of widening it", summary: "Moving a stop further away to avoid a loss consistently produced larger losses." },
  { topic: "funding", title: "Avoid perps with extreme positive funding", summary: "Opening longs into very high funding rates eroded returns through carry costs." },
  { topic: "liquidity", title: "Check pool liquidity before large swaps", summary: "Routing a large swap through a thin pool caused severe slippage." },
  { topic: "slippage", title: "Set tighter slippage on volatile names", summary: "Loose slippage tolerance on volatile tokens led to bad fills during spikes." },
  { topic: "scaling", title: "Scale out into strength, not into weakness", summary: "Taking partial profits while momentum is positive beat waiting for a reversal." },
  { topic: "gas", title: "Batch approvals to reduce gas overhead", summary: "Separate approval transactions wasted gas that batching would have saved." },
  { topic: "rugcheck", title: "Verify token authority before buying", summary: "Buying a token with an unrevoked mint authority exposed funds to a rug." },
  { topic: "rebalance", title: "Rebalance gradually to avoid market impact", summary: "Rebalancing the whole position at once moved the price against the fill." },
  { topic: "news", title: "Wait out high-impact news before entering", summary: "Entering right before a major announcement led to whipsaw losses." },
  { topic: "correlation", title: "Avoid stacking correlated long exposure", summary: "Holding several correlated longs concentrated risk into one move." },
  { topic: "fees", title: "Prefer venues with lower taker fees for scalps", summary: "High taker fees turned small scalping edges into net losers." },
];

/** ~15 golden queries → the topic each should surface in the top result. */
const GOLDEN_QUERIES: { query: string; topic: string }[] = [
  { query: "should I wait for a breakout confirmation before sizing up", topic: "breakout" },
  { query: "is it ok to move my stop loss further to avoid getting stopped out", topic: "stoploss" },
  { query: "perpetual futures funding rate too high to go long", topic: "funding" },
  { query: "low liquidity pool slippage when swapping a big amount", topic: "liquidity" },
  { query: "how tight should slippage tolerance be on a volatile token", topic: "slippage" },
  { query: "when to take partial profits and scale out of a winner", topic: "scaling" },
  { query: "reduce gas cost by batching token approvals", topic: "gas" },
  { query: "check token mint authority before buying to avoid a rug", topic: "rugcheck" },
  { query: "rebalancing slowly to reduce market impact on price", topic: "rebalance" },
  { query: "avoid trading right before high impact news events", topic: "news" },
  { query: "too much correlated long exposure concentrates risk", topic: "correlation" },
  { query: "lower taker fees matter for scalping strategies", topic: "fees" },
  { query: "confirm the breakout first then add to the position", topic: "breakout" },
  { query: "respect the predefined stop instead of widening it", topic: "stoploss" },
  { query: "thin liquidity causing bad fills on large orders", topic: "liquidity" },
];

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

interface ConciseResult {
  source: string;
  id: number | string;
  title: string;
  kind: string;
  score: number;
  similarity: number;
}
interface SearchData {
  results?: ConciseResult[];
}

describe.skipIf(!hasKey)("eval: retrieval precision (live)", () => {
  let providerModel = "";
  let session = "";

  beforeAll(async () => {
    await resetDb();
    session = await makeSession();
    for (const row of CORPUS) {
      const r = await seedPromotedLessonDirect({
        kind: "strategy_lesson",
        title: row.title,
        summary: row.summary,
        source: "observed",
      });
      providerModel = r.providerModel;
    }
  });

  it("measures precision@1 over golden queries (real Gemma)", async () => {
    // Map each corpus topic to its seeded entry id (resolve via a recall of the
    // exact title — robust to insert order).
    const idByTopic = new Map<string, number>();
    for (const row of CORPUS) {
      const { embedding } = await embedQuery(`${row.title} ${row.summary}`);
      const top = await recallLongMemoryTopK(
        embedding,
        { embeddingModel: providerModel, embeddingDim: embedding.length, includeExpired: false },
        1,
      );
      if (top[0]) idByTopic.set(row.topic, top[0].id);
    }

    let hits = 0;
    for (const g of GOLDEN_QUERIES) {
      const { embedding } = await embedQuery(g.query);
      const top = await recallLongMemoryTopK(
        embedding,
        { embeddingModel: providerModel, embeddingDim: embedding.length, includeExpired: false },
        1,
      );
      const expectedId = idByTopic.get(g.topic);
      if (top[0] && expectedId !== undefined && top[0].id === expectedId) hits += 1;
    }

    const precisionAt1 = GOLDEN_QUERIES.length === 0 ? 0 : hits / GOLDEN_QUERIES.length;
    reportCard.recordPrecision({
      k: 1,
      precisionAtK: precisionAt1,
      queries: GOLDEN_QUERIES.length,
      relevantHits: hits,
    });
    reportCard.recordCheck(SUITE, {
      label: "precision@1 measured over golden queries",
      pass: true,
      note: `p@1=${precisionAt1.toFixed(3)} (${hits}/${GOLDEN_QUERIES.length})`,
    });
    // A real embedding corpus should clear a low floor; this is a soft sanity
    // gate (recorded as a check), not a brittle exact threshold.
    expect(precisionAt1).toBeGreaterThan(0.4);
  });

  it("confirmed knowledge outranks an equal-text inferred candidate", async () => {
    // Fresh isolated state so only these two rows compete.
    await resetDb();
    const s = await makeSession();
    const ctx = makeContext(s);
    const title = "Close losing trades quickly to preserve capital";
    const summary =
      "Cutting a losing position early rather than hoping for a recovery preserved capital across the sample.";

    const entry = await seedPromotedLessonDirect({
      kind: "risk_lesson",
      title,
      summary,
      source: "observed", // hot-context tier, top source weight
    });
    // An equal-text dual-trace candidate at `inferred` (the de-weighted tier).
    await seedGemmaCandidate({
      sessionId: s,
      kind: "risk_lesson",
      title,
      summary,
      source: "inferred",
    });

    const res = await handleLongMemorySearch(
      { query: "should I cut a losing trade early to protect capital", include_candidates: true, k: 10 },
      ctx,
    );
    expect(res.success).toBe(true);
    const data = (res.data ?? {}) as SearchData;
    const results = data.results ?? [];
    const knowledgeIdx = results.findIndex(
      (r) => r.source === "long_memory" && r.id === entry.id,
    );
    const candidateIdx = results.findIndex((r) => r.source === "memory_candidate");
    expect(knowledgeIdx).toBeGreaterThanOrEqual(0);
    expect(candidateIdx).toBeGreaterThanOrEqual(0);
    // HARD: the confirmed knowledge entry ranks ABOVE the equal-text candidate.
    expect(knowledgeIdx).toBeLessThan(candidateIdx);
    reportCard.recordCheck(SUITE, {
      label: "confirmed knowledge outranks equal-text inferred candidate",
      pass: knowledgeIdx >= 0 && candidateIdx >= 0 && knowledgeIdx < candidateIdx,
      note: `knowledgeRank=${knowledgeIdx} candidateRank=${candidateIdx}`,
    });
  });

  it("superseded and expired entries never surface in recall", async () => {
    await resetDb();
    const s = await makeSession();
    const query = "lesson about managing position risk during volatility";

    // Active control (must surface).
    const active = await seedPromotedLessonDirect({
      kind: "risk_lesson",
      title: "Reduce size when realized volatility spikes",
      summary: "Cutting position size during volatility spikes limited drawdowns in the sample.",
      source: "observed",
    });
    // Superseded (status flipped → must NOT surface).
    const superseded = await seedPromotedLessonDirect({
      kind: "risk_lesson",
      title: "Old volatility rule that was later replaced",
      summary: "An earlier volatility heuristic about reducing exposure that was superseded by a better rule.",
      source: "observed",
    });
    await execute(`UPDATE knowledge_entries SET status = 'superseded' WHERE id = $1`, [
      superseded.id,
    ]);
    // Expired (valid_until in the past, unpinned → must NOT surface).
    const expired = await seedPromotedLessonDirect({
      kind: "risk_lesson",
      title: "Time-bound volatility note that has expired",
      summary: "A volatility note about cutting exposure that carried a TTL which has already elapsed.",
      source: "observed",
      validUntil: new Date(Date.now() - 86_400_000),
    });
    void s;

    const { embedding, providerModel: pm } = await embedQuery(query);
    const rows = await recallLongMemoryTopK(
      embedding,
      { embeddingModel: pm, embeddingDim: embedding.length, includeExpired: false },
      20,
    );
    const ids = new Set(rows.map((r) => r.id));
    const activeSurfaced = ids.has(active.id);
    const supersededSurfaced = ids.has(superseded.id);
    const expiredSurfaced = ids.has(expired.id);

    expect(activeSurfaced).toBe(true);
    expect(supersededSurfaced).toBe(false);
    expect(expiredSurfaced).toBe(false);
    reportCard.recordCheck(SUITE, {
      label: "superseded + expired excluded; active surfaces",
      pass: activeSurfaced && !supersededSurfaced && !expiredSurfaced,
      note: `active=${activeSurfaced} superseded=${supersededSurfaced} expired=${expiredSurfaced}`,
    });
  });
});
