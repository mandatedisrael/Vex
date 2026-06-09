/**
 * long_memory_search handler (S3) — the agent's high-level cross-session recall.
 * Hides the strategy (vector + dual-trace + rerank) behind one tool (genesis
 * §398). Ordered, fail-loud, IO only at the edges:
 *
 *   1. validate input (Zod) — query/k/kind/response_format/include_candidates/
 *      expand_graph. NO `scope` (R1-#5): S3 always returns active + non-expired.
 *   2. embedQuery → { embedding, providerModel }. providerModel + embedding.length
 *      are the recall filter for BOTH stores (write/read consistency).
 *   3. knowledge recall WITH `source` (recallLongMemoryTopK, includeExpired:false).
 *   4. dual-trace candidate recall (recallCandidatesTopK) when include_candidates.
 *   5. blendAndRank — knowledge scored by rerank-base × source-tier weight,
 *      candidates by similarity × 0.6 (no boosts); gated + capped; merged.
 *   6. graph-expansion hook (expand_graph) — empty until S8 (D1).
 *   7. inline-only: cap to LONG_MEMORY_INLINE_CAP / _CHARS_CAP, truncate-with-
 *      steering (no silent drop — R1-#3), emit search.truncated.
 *   8. format per response_format (concise | detailed).
 *
 * Boundary discipline: imports the memory module + repos only — never renderer,
 * wallet, or signing authority. `fail(msg)` IS the agent's steering channel.
 */

import { ZodError } from "zod";

import { recallLongMemoryTopK } from "@vex-agent/db/repos/knowledge.js";
import { recallCandidatesTopK } from "@vex-agent/db/repos/memory-candidates/index.js";
import { embedQuery } from "@vex-agent/embeddings/client.js";
import { loadEmbeddingConfig } from "@vex-agent/embeddings/config.js";
import { scoreRecallCandidate } from "@vex-agent/knowledge/ranking.js";
import { memLog } from "@vex-agent/memory/observability/logger.js";
import {
  blendAndRank,
  LONG_MEMORY_INLINE_CAP,
  LONG_MEMORY_INLINE_CHARS_CAP,
  type LongMemoryResult,
  type LongMemoryKnowledgeResult,
  type LongMemoryCandidateResult,
} from "@vex-agent/memory/long-memory-retrieval-policy.js";
import {
  longMemorySearchInputSchema,
  type LongMemorySearchInput,
} from "@vex-agent/memory/schema/long-memory-search.js";

import type { ToolResult } from "../../types.js";
import type { InternalToolContext } from "../types.js";
import { ok, fail } from "../types.js";

// ── Steering messages (agent-facing) ─────────────────────────────

const NOTHING_FOUND_MESSAGE =
  "No long-term memory matched this query. Nothing has been stored yet that is relevant — proceed without it, or refine the query and try again.";

/** The only accepted tool params. An unknown key (typo / a removed param like `scope`) is rejected with a steering message rather than silently dropped (final-gate fix). */
const ALLOWED_SEARCH_PARAMS = [
  "query",
  "k",
  "kind",
  "response_format",
  "include_candidates",
  "expand_graph",
] as const;

// ── snake_case → camelCase mapping + validation ──────────────────

/**
 * Map the snake_case tool params to the camelCase search-input schema and
 * validate. Only forwards keys the agent supplied so the schema applies its own
 * defaults; `.strict()` rejects unknown keys. Returns the parsed input or a
 * typed Zod error for a readable steering message.
 */
function mapAndValidate(
  params: Record<string, unknown>,
): { ok: true; input: LongMemorySearchInput } | { ok: false; error: ZodError } {
  const mapped: Record<string, unknown> = {};
  if (params["query"] !== undefined) mapped["query"] = params["query"];
  if (params["k"] !== undefined) mapped["k"] = params["k"];
  if (params["kind"] !== undefined) mapped["kind"] = params["kind"];
  if (params["response_format"] !== undefined) mapped["responseFormat"] = params["response_format"];
  if (params["include_candidates"] !== undefined) {
    mapped["includeCandidates"] = params["include_candidates"];
  }
  if (params["expand_graph"] !== undefined) mapped["expandGraph"] = params["expand_graph"];

  const parsed = longMemorySearchInputSchema.safeParse(mapped);
  if (!parsed.success) return { ok: false, error: parsed.error };
  return { ok: true, input: parsed.data };
}

/** First Zod issue rendered as a readable field/message steering hint. */
function firstIssueMessage(error: ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "invalid input";
  const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
  return `${path}: ${issue.message}`;
}

// ── Graph-expansion hook (D1) ────────────────────────────────────

/**
 * Graph-expansion stub (D1) — returns empty until S8 populates
 * `memory_entities` / `memory_edges`. Present now so `expand_graph` has stable
 * signature semantics and S8 does not churn the tool contract.
 */
function expandViaGraph(_seedEntryIds: readonly number[]): LongMemoryResult[] {
  return [];
}

// ── Inline cap (inline-only — R1-#3) ─────────────────────────────

interface InlineSplit {
  readonly inline: LongMemoryResult[];
  readonly dropped: number;
}

/**
 * Cap the ranked set to LONG_MEMORY_INLINE_CAP entries (ALWAYS) and — ONLY when
 * the response actually carries `contentMd` (detailed format) — to
 * LONG_MEMORY_INLINE_CHARS_CAP total chars. concise responses do NOT return
 * `contentMd`, so the chars cap must never truncate them (final-gate fix). The
 * first result is always kept even if it alone busts the chars cap (otherwise the
 * top hit would be lost). NO overflow cache (R1-#3) — the dropped count drives the
 * steering hint + `search.truncated`.
 */
function capInline(ranked: readonly LongMemoryResult[], applyCharsCap: boolean): InlineSplit {
  if (ranked.length === 0) return { inline: [], dropped: 0 };

  const inline: LongMemoryResult[] = [];
  let totalChars = 0;

  for (const entry of ranked) {
    if (inline.length >= LONG_MEMORY_INLINE_CAP) break;
    // Chars cap (detailed only); the first result is always kept.
    if (
      applyCharsCap &&
      inline.length > 0 &&
      totalChars + entry.contentMd.length > LONG_MEMORY_INLINE_CHARS_CAP
    ) {
      break;
    }
    inline.push(entry);
    totalChars += entry.contentMd.length;
  }

  return { inline, dropped: ranked.length - inline.length };
}

// ── Output formatting (concise | detailed) ───────────────────────

interface ConciseItem {
  source: LongMemoryResult["source"];
  id: number | string;
  kind: string;
  title: string;
  similarity: number;
  score: number;
  notConsolidated?: true;
}

function toConcise(r: LongMemoryResult): ConciseItem {
  const base: ConciseItem = {
    source: r.source,
    id: r.id,
    kind: r.kind,
    title: r.title,
    similarity: round(r.similarity),
    score: round(r.score),
  };
  if (r.source === "memory_candidate") base.notConsolidated = true;
  return base;
}

function toDetailed(r: LongMemoryResult): Record<string, unknown> {
  const base = toConcise(r);
  if (r.source === "long_memory") {
    return {
      ...base,
      summary: r.summary,
      contentMd: r.contentMd,
      tags: r.tags,
      validUntil: r.validUntil,
      maturityState: r.maturityState,
      sourceTier: r.sourceTier,
      evidenceRefs: r.evidenceRefs,
    };
  }
  return {
    ...base,
    summary: r.summary,
    contentMd: r.contentMd,
    tags: r.tags,
    validUntil: r.retrievalUntil,
    sourceTier: r.sourceTier,
    evidenceRefs: r.evidenceRefs,
  };
}

/** Round a unit-interval number to 4 dp for stable, compact output. */
function round(x: number): number {
  return Math.round(x * 1e4) / 1e4;
}

// ── Handler ──────────────────────────────────────────────────────

export async function handleLongMemorySearch(
  params: Record<string, unknown>,
  _context: InternalToolContext,
): Promise<ToolResult> {
  const startedAt = Date.now();

  // 1. Validate. Reject unknown params (a typo or a removed param like `scope`
  // must not be silently ignored — final-gate fix).
  const unknownParams = Object.keys(params).filter(
    (key) => !(ALLOWED_SEARCH_PARAMS as readonly string[]).includes(key),
  );
  if (unknownParams.length > 0) {
    return fail(
      `long_memory_search rejected the input — unknown parameter(s): ${unknownParams.join(", ")}. Allowed: ${ALLOWED_SEARCH_PARAMS.join(", ")}.`,
    );
  }
  const mapResult = mapAndValidate(params);
  if (!mapResult.ok) {
    return fail(`long_memory_search rejected the input — ${firstIssueMessage(mapResult.error)}`);
  }
  const input = mapResult.input;

  // 2. Embed (fail-loud — no non-embedded fallback).
  let config;
  try {
    config = loadEmbeddingConfig();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return fail(`embedding config invalid: ${msg}`);
  }

  let embedding: number[];
  let providerModel: string;
  try {
    const result = await embedQuery(input.query, config);
    embedding = result.embedding;
    providerModel = result.providerModel;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return fail(`embedding service unavailable: ${msg}`);
  }

  // 3 + 4. Recall both stores under the SAME provider/dim filter.
  const now = new Date();
  let knowledgeResults: Omit<LongMemoryKnowledgeResult, "score">[];
  let candidateResults: Omit<LongMemoryCandidateResult, "score">[];
  try {
    const knowledge = await recallLongMemoryTopK(
      embedding,
      {
        embeddingModel: providerModel,
        embeddingDim: embedding.length,
        kind: input.kind,
        includeExpired: false,
      },
      input.k,
    );
    knowledgeResults = knowledge.map((c) => ({
      source: "long_memory" as const,
      id: c.id,
      kind: c.kind,
      title: c.title,
      summary: c.summary,
      contentMd: c.contentMd,
      similarity: c.similarity,
      sourceTier: c.source,
      maturityState: c.maturityState,
      activationStrength: c.activationStrength,
      tags: c.tags,
      validUntil: c.validUntil ? c.validUntil.toISOString() : null,
      evidenceRefs: c.sourceRefs,
      rerankScore: scoreRecallCandidate(c, now),
    }));

    if (input.includeCandidates) {
      const candidates = await recallCandidatesTopK(
        embedding,
        { embeddingModel: providerModel, embeddingDim: embedding.length },
        input.k,
      );
      candidateResults = candidates.map((c) => ({
        source: "memory_candidate" as const,
        id: c.id,
        kind: c.kind,
        title: c.title,
        summary: c.summary,
        contentMd: c.contentMd,
        similarity: c.similarity,
        notConsolidated: true as const,
        sourceTier: c.source,
        tags: c.tags,
        evidenceRefs: c.evidenceRefs,
        retrievalUntil: c.retrievalUntil,
      }));
    } else {
      candidateResults = [];
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    memLog.error("search", "failed", { errorKind: "query_failed" });
    return fail(`long_memory_search failed: ${msg}`);
  }

  // 5. Blend + rank (pure).
  const blended = blendAndRank(knowledgeResults, candidateResults);

  // 6. Graph-expansion hook (D1) — empty until S8.
  const ranked: LongMemoryResult[] = input.expandGraph
    ? [...blended.results, ...expandViaGraph(knowledgeResults.map((k) => k.id))]
    : blended.results;

  // 7. Inline-only cap + truncate-with-steering (no silent drop — R1-#3).
  // Chars cap applies only to detailed (concise omits contentMd) — final-gate fix.
  const { inline, dropped } = capInline(ranked, input.responseFormat === "detailed");

  const candidateCount = candidateResults.length;
  memLog("search", "candidates", { count: candidateCount });
  if (dropped > 0) memLog("search", "truncated", { count: dropped });
  memLog("search", "served", { count: inline.length, durationMs: Date.now() - startedAt });

  // 8. Format + steering.
  if (inline.length === 0) {
    return fail(NOTHING_FOUND_MESSAGE);
  }

  const items =
    input.responseFormat === "detailed" ? inline.map(toDetailed) : inline.map(toConcise);

  const steering =
    dropped > 0
      ? `showing top ${inline.length} of ${inline.length + dropped} — refine your query for more`
      : undefined;

  return ok({
    count: inline.length,
    truncated: dropped > 0,
    ...(dropped > 0 ? { droppedCount: dropped, steering } : {}),
    candidateCount,
    droppedCandidates: blended.droppedCandidates,
    results: items,
  });
}
