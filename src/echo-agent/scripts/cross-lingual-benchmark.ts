/**
 * cross-lingual-benchmark — Phase 0 hard gate for the language pivot.
 *
 * Stand-alone CLI. Embeds the curated benchmark dataset against the local
 * EmbeddingGemma endpoint (or whatever EMBEDDING_BASE_URL points at) and
 * produces a markdown report covering two retrieval modes:
 *
 *   Mode A — raw native query → English episode summary:
 *     validates that PR1 can cut the hot-path translation without regressing
 *     recall on sessions whose summaries are still in English.
 *
 *   Mode B — native query → native episode summary:
 *     validates that the PR2 multilingual session-memory rewrite retrieves
 *     cleanly in each language.
 *
 * Metrics: Recall@1, Recall@3, average and minimum margin vs the best
 * distractor in the candidate pool. No hard threshold is encoded — the
 * operator reads the report and fills in the `Verdict:` line in the
 * Recommendation section. Worst failure cases per language are surfaced
 * automatically so the operator has the data to judge.
 *
 * Usage:
 *   pnpm exec tsx src/echo-agent/scripts/cross-lingual-benchmark.ts
 *
 * Required env (same contract as production embeddings — see config.ts):
 *   EMBEDDING_BASE_URL   e.g. http://localhost:12434/engines/llama.cpp/v1
 *   EMBEDDING_MODEL      e.g. ai/embeddinggemma:300M-Q8_0
 *   EMBEDDING_DIM        e.g. 768
 *   EMBEDDING_PROVIDER   e.g. local
 *
 * Optional:
 *   BENCHMARK_OUTPUT_PATH   override markdown output path
 *                           (default: docs/benchmarks/cross-lingual-recall.md)
 */

import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { embedDocument, embedQuery } from "@echo-agent/embeddings/client.js";
import { loadEmbeddingConfig, type EmbeddingConfig } from "@echo-agent/embeddings/config.js";
import logger from "@utils/logger.js";

import { BENCHMARK_LANGS, BENCHMARK_PAIRS, type BenchmarkLang, type BenchmarkPair } from "./cross-lingual-benchmark-dataset.js";

// ── Types ────────────────────────────────────────────────────────────

type Mode = "A" | "B";

interface PerPairResult {
  pairId: string;
  lang: BenchmarkLang;
  topic: string;
  mode: Mode;
  targetRank: number;          // 1-based rank of the correct doc in the pool
  targetScore: number;         // cosine(query, target doc)
  bestDistractorScore: number; // cosine(query, best-non-target doc)
  margin: number;              // targetScore - bestDistractorScore (positive = target wins)
}

interface PerLangAggregate {
  lang: BenchmarkLang;
  mode: Mode;
  pairs: number;
  hit1: number;
  hit3: number;
  avgMargin: number;
  minMargin: number;
}

interface BenchmarkReport {
  runStartedAt: string;
  runFinishedAt: string;
  config: {
    baseUrl: string;
    requestedModel: string;
    providerModel: string;
    dim: number;
    provider: string;
  };
  datasetSize: number;
  perPair: PerPairResult[];
  perLang: PerLangAggregate[];
  worstPerLang: Record<BenchmarkLang, PerPairResult[]>;
}

// ── Cosine similarity ────────────────────────────────────────────────

/**
 * Cosine similarity between two equal-length vectors.
 *
 * EmbeddingGemma outputs L2-normalized vectors per the model card, so
 * cosine collapses to dot product. We still compute full cosine here to
 * be robust against any provider that returns un-normalized embeddings.
 */
function cosine(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length) {
    throw new Error(`cosine: dim mismatch ${a.length} vs ${b.length}`);
  }
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const av = a[i]!;
    const bv = b[i]!;
    dot += av * bv;
    na += av * av;
    nb += bv * bv;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  if (denom === 0) return 0;
  return dot / denom;
}

// ── Embedding phase ──────────────────────────────────────────────────

interface EmbeddedPair {
  pair: BenchmarkPair;
  queryEmbed: number[];
  docEmbedA: number[]; // Mode A: (titleEn, summaryEn)
  docEmbedB: number[]; // Mode B: (titleNative, summaryNative)
}

async function embedAllPairs(
  config: EmbeddingConfig,
): Promise<{ embedded: EmbeddedPair[]; providerModel: string }> {
  const embedded: EmbeddedPair[] = [];
  let providerModel: string = config.model;
  let providerModelCaptured = false;

  for (let i = 0; i < BENCHMARK_PAIRS.length; i++) {
    const pair = BENCHMARK_PAIRS[i]!;
    logger.info("benchmark.embed.pair", {
      index: i + 1,
      total: BENCHMARK_PAIRS.length,
      id: pair.id,
    });

    const q = await embedQuery(pair.queryNative, config);
    const a = await embedDocument(pair.titleEn, pair.summaryEn, config);
    const b = await embedDocument(pair.titleNative, pair.summaryNative, config);

    // Stash the first provider-reported model name — it goes into the
    // report as the audit value (see embeddings/client.ts contract).
    if (!providerModelCaptured) {
      providerModel = q.providerModel;
      providerModelCaptured = true;
    }

    embedded.push({
      pair,
      queryEmbed: q.embedding,
      docEmbedA: a.embedding,
      docEmbedB: b.embedding,
    });
  }

  logger.info("benchmark.embed.done", {
    pairs: embedded.length,
    providerModel,
  });
  return { embedded, providerModel };
}

// ── Scoring phase ────────────────────────────────────────────────────

function scoreMode(
  embedded: readonly EmbeddedPair[],
  mode: Mode,
): PerPairResult[] {
  // Mode A uses the legacy EN corpus: summaryEn/titleEn are identical across
  // all language variants of the same topic, so 5 of every 6 documents collide
  // at the embedding level. Dedupe down to 6 canonical EN docs (one per topic)
  // and match the target by topic. That gives queries a meaningful pool of
  // distractors (the other 5 topics) instead of 4 indistinguishable duplicates.
  //
  // Mode B uses native-language documents which are unique per pair, so the
  // pool is all 30 docs and target matching is by pair id.
  type PoolDoc = { key: string; topic: string; embed: number[] };

  let pool: PoolDoc[];
  let targetKey: (p: BenchmarkPair) => string;

  if (mode === "A") {
    const seen = new Set<string>();
    pool = [];
    for (const e of embedded) {
      if (seen.has(e.pair.topic)) continue;
      seen.add(e.pair.topic);
      pool.push({
        key: `<topic:${e.pair.topic}>`,
        topic: e.pair.topic,
        embed: e.docEmbedA,
      });
    }
    targetKey = p => `<topic:${p.topic}>`;
  } else {
    pool = embedded.map(e => ({
      key: e.pair.id,
      topic: e.pair.topic,
      embed: e.docEmbedB,
    }));
    targetKey = p => p.id;
  }

  const results: PerPairResult[] = [];

  for (const { pair, queryEmbed } of embedded) {
    const scored = pool.map(d => ({
      key: d.key,
      score: cosine(queryEmbed, d.embed),
    }));

    // Sort descending so rank=1 is best match.
    scored.sort((a, b) => b.score - a.score);

    const wantKey = targetKey(pair);
    const targetRank = scored.findIndex(s => s.key === wantKey) + 1;
    if (targetRank === 0) {
      throw new Error(`scoreMode: target ${wantKey} not found in pool (mode=${mode})`);
    }
    const targetScore = scored[targetRank - 1]!.score;

    const bestDistractor = scored.find(s => s.key !== wantKey);
    if (!bestDistractor) {
      throw new Error(`scoreMode: pool of size 1 — no distractors (mode=${mode})`);
    }

    results.push({
      pairId: pair.id,
      lang: pair.lang,
      topic: pair.topic,
      mode,
      targetRank,
      targetScore,
      bestDistractorScore: bestDistractor.score,
      margin: targetScore - bestDistractor.score,
    });
  }

  return results;
}

// ── Aggregation ──────────────────────────────────────────────────────

function aggregate(perPair: readonly PerPairResult[]): PerLangAggregate[] {
  const out: PerLangAggregate[] = [];

  for (const lang of BENCHMARK_LANGS) {
    for (const mode of ["A", "B"] as const) {
      const subset = perPair.filter(r => r.lang === lang && r.mode === mode);
      if (subset.length === 0) continue;
      const hit1 = subset.filter(r => r.targetRank === 1).length;
      const hit3 = subset.filter(r => r.targetRank <= 3).length;
      const avgMargin = subset.reduce((s, r) => s + r.margin, 0) / subset.length;
      const minMargin = Math.min(...subset.map(r => r.margin));
      out.push({ lang, mode, pairs: subset.length, hit1, hit3, avgMargin, minMargin });
    }
  }

  return out;
}

/**
 * Pick worst failures per language: up to 3 pairs across both modes,
 * preferring misses (targetRank > 1) over low-margin hits.
 */
function pickWorstFailures(
  perPair: readonly PerPairResult[],
): Record<BenchmarkLang, PerPairResult[]> {
  const out = Object.fromEntries(
    BENCHMARK_LANGS.map(l => [l, [] as PerPairResult[]]),
  ) as Record<BenchmarkLang, PerPairResult[]>;

  for (const lang of BENCHMARK_LANGS) {
    const subset = perPair.filter(r => r.lang === lang);
    const ranked = [...subset].sort((a, b) => {
      // Prioritize misses (rank > 1 = higher bucket), then smallest margin.
      if (a.targetRank !== b.targetRank) return b.targetRank - a.targetRank;
      return a.margin - b.margin;
    });
    out[lang] = ranked.slice(0, 3);
  }

  return out;
}

// ── Report rendering ─────────────────────────────────────────────────

function fmtPct(num: number, den: number): string {
  if (den === 0) return "n/a";
  return `${((num / den) * 100).toFixed(1)}%`;
}

function fmtMargin(m: number): string {
  return (m >= 0 ? "+" : "") + m.toFixed(3);
}

function renderModeTable(perLang: readonly PerLangAggregate[], mode: Mode): string {
  const rows = perLang.filter(p => p.mode === mode);
  const header = "| Lang | Pairs | Recall@1 | Recall@3 | Avg margin | Min margin |\n|---|---|---|---|---|---|";
  const body = rows
    .map(r => `| ${r.lang} | ${r.pairs} | ${r.hit1}/${r.pairs} (${fmtPct(r.hit1, r.pairs)}) | ${r.hit3}/${r.pairs} (${fmtPct(r.hit3, r.pairs)}) | ${fmtMargin(r.avgMargin)} | ${fmtMargin(r.minMargin)} |`)
    .join("\n");

  const totalPairs = rows.reduce((s, r) => s + r.pairs, 0);
  const totalHit1 = rows.reduce((s, r) => s + r.hit1, 0);
  const totalHit3 = rows.reduce((s, r) => s + r.hit3, 0);
  const footer = `\n\n**Overall (all ${totalPairs} pairs):** Recall@1 = ${totalHit1}/${totalPairs} (${fmtPct(totalHit1, totalPairs)}), Recall@3 = ${totalHit3}/${totalPairs} (${fmtPct(totalHit3, totalPairs)})`;

  return `${header}\n${body}${footer}`;
}

function renderWorstSection(
  worst: Record<BenchmarkLang, PerPairResult[]>,
  pairsById: Map<string, BenchmarkPair>,
): string {
  const blocks: string[] = [];
  for (const lang of BENCHMARK_LANGS) {
    const items = worst[lang];
    if (items.length === 0) {
      blocks.push(`- **${lang}**: no pairs (empty dataset for this language)`);
      continue;
    }
    const lines = items.map(r => {
      const pair = pairsById.get(r.pairId);
      const queryPreview = pair ? `"${pair.queryNative}"` : "";
      return `  - \`${r.pairId}\` mode ${r.mode}: rank ${r.targetRank}, target ${r.targetScore.toFixed(3)} vs best distractor ${r.bestDistractorScore.toFixed(3)} (margin ${fmtMargin(r.margin)}) — query: ${queryPreview}`;
    });
    blocks.push(`- **${lang}**:\n${lines.join("\n")}`);
  }
  return blocks.join("\n");
}

function renderReport(report: BenchmarkReport): string {
  const pairsById = new Map(BENCHMARK_PAIRS.map(p => [p.id, p]));

  return `# Cross-lingual Recall Benchmark

**Run started:** ${report.runStartedAt}
**Run finished:** ${report.runFinishedAt}
**Provider:** ${report.config.provider} @ ${report.config.baseUrl}
**Model:** \`${report.config.requestedModel}\` (provider reported: \`${report.config.providerModel}\`, dim=${report.config.dim})
**Dataset:** ${report.datasetSize} pairs across ${BENCHMARK_LANGS.join("/")} (6 per language)
**Title strategy:** simulated LLM-generated titles (the PR2 target shape, not legacy \`summary.slice(0, 120)\`)

---

## Mode A — raw native query → English episode summary

Validates that PR1 can cut the hot-path translation without regressing recall
on sessions whose summaries are still in English (legacy corpus).

${renderModeTable(report.perLang, "A")}

---

## Mode B — native query → native episode summary

Validates that the PR2 multilingual session-memory rewrite retrieves cleanly
in each language (post-pivot target).

${renderModeTable(report.perLang, "B")}

---

## Recommendation

**Verdict:** \`<TO BE FILLED BY OPERATOR: proceed | do not proceed>\`

**Rationale:** \`<one paragraph — why this result supports or blocks the language pivot>\`

---

## Worst failure cases

Per language, up to 3 pairs ranked by: misses (targetRank > 1) first, then
smallest margin among hits. These are the cases most likely to degrade
recall in production.

${renderWorstSection(report.worstPerLang, pairsById)}

---

## Methodology notes

- **Mode A pool**: 6 canonical English documents — one per topic. We dedupe
  because summaryEn/titleEn are identical across language variants of the
  same topic (they represent the same legacy episode seen from different
  user-side queries). Mode A scores every query (all ${report.datasetSize}
  across 5 languages) against the same 6-doc EN pool; target match is by
  topic. Random baseline: 1/6 = 16.7% Recall@1.
- **Mode B pool**: all ${report.datasetSize} native documents. Each pair has
  a unique native summary, so target matching is by pair id. Distractors
  include same-topic docs in other languages — deliberately harder than
  production, where \`memory_scope_key\` narrows the pool to a single
  session's episodes. Random baseline: 1/${report.datasetSize} ≈ ${((1 / report.datasetSize) * 100).toFixed(1)}% Recall@1.
- Cosine similarity is computed with full normalization (robust to providers
  that may not L2-normalize).
- Title input to \`embedDocument\` simulates the LLM-generated title PR2
  introduces. If the benchmark passes and the pivot ships, the runtime will
  use actual LLM output — this dataset is the operator's best-faith model of
  what that output will look like.
`;
}

// ── Orchestration ────────────────────────────────────────────────────

export async function runBenchmark(
  outputPath: string = resolve(process.cwd(), "docs/benchmarks/cross-lingual-recall.md"),
): Promise<BenchmarkReport> {
  const config = loadEmbeddingConfig();

  const runStartedAt = new Date().toISOString();
  logger.info("benchmark.start", {
    pairs: BENCHMARK_PAIRS.length,
    langs: BENCHMARK_LANGS,
    baseUrl: config.baseUrl,
    model: config.model,
    dim: config.dim,
  });

  const { embedded, providerModel } = await embedAllPairs(config);

  const modeA = scoreMode(embedded, "A");
  const modeB = scoreMode(embedded, "B");
  const perPair = [...modeA, ...modeB];
  const perLang = aggregate(perPair);
  const worstPerLang = pickWorstFailures(perPair);

  const runFinishedAt = new Date().toISOString();
  const report: BenchmarkReport = {
    runStartedAt,
    runFinishedAt,
    config: {
      baseUrl: config.baseUrl,
      requestedModel: config.model,
      providerModel,
      dim: config.dim,
      provider: config.provider,
    },
    datasetSize: BENCHMARK_PAIRS.length,
    perPair,
    perLang,
    worstPerLang,
  };

  const md = renderReport(report);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, md, "utf-8");

  logger.info("benchmark.done", {
    outputPath,
    modeA: {
      hit1: modeA.filter(r => r.targetRank === 1).length,
      pairs: modeA.length,
    },
    modeB: {
      hit1: modeB.filter(r => r.targetRank === 1).length,
      pairs: modeB.length,
    },
  });

  return report;
}

// ── CLI entry ────────────────────────────────────────────────────────

const isMain = (() => {
  try {
    return import.meta.url === pathToFileURL(realpathSync(process.argv[1]!)).href;
  } catch {
    return false;
  }
})();

if (isMain) {
  const outputPath = process.env.BENCHMARK_OUTPUT_PATH
    ? resolve(process.env.BENCHMARK_OUTPUT_PATH)
    : resolve(process.cwd(), "docs/benchmarks/cross-lingual-recall.md");

  runBenchmark(outputPath)
    .then(report => {
      const totalScored = report.datasetSize * 2; // Mode A + Mode B
      const totalHit1 = report.perLang.reduce((s, r) => s + r.hit1, 0);
      logger.info("benchmark.summary", {
        outputPath,
        totalScored,
        totalHit1,
        recall1Pct: Number(((totalHit1 / totalScored) * 100).toFixed(1)),
        nextStep:
          "review the report, fill in the Recommendation section, decide go/no-go on the language pivot",
      });
      process.exit(0);
    })
    .catch(err => {
      logger.error("benchmark.failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      process.exit(1);
    });
}
