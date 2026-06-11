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
 *   6. inline-only cap of DIRECT results: LONG_MEMORY_INLINE_CAP / _CHARS_CAP,
 *      truncate-with-steering (no silent drop — R1-#3), emit search.truncated.
 *   7. graph expansion (S8, expand_graph default ON): 1 hop over
 *      memory_entities/memory_edges from the top blended seeds, bounded +
 *      score-decayed BELOW every seed, marked via:'graph'. Fills ONLY the
 *      remaining inline slots — never evicts a direct result. Fail-open: an
 *      expansion error never fails the search.
 *   8. format per response_format (concise | detailed) — expansion results
 *      carry a `via_graph(entity)` marker.
 *
 * Boundary discipline: imports the memory module + repos only — never renderer,
 * wallet, or signing authority. `fail(msg)` IS the agent's steering channel.
 */

import { ZodError } from "zod";

import {
  getActiveEntriesByIds,
  recallLongMemoryTopK,
} from "@vex-agent/db/repos/knowledge.js";
import { recallCandidatesTopK } from "@vex-agent/db/repos/memory-candidates/index.js";
import {
  listEntityIdsForEntries,
  listEntryIdsForEntities,
} from "@vex-agent/db/repos/memory-entry-entities/index.js";
import { listActiveEdgesForEntities } from "@vex-agent/db/repos/memory-edges/index.js";
import { embedQuery } from "@vex-agent/embeddings/client.js";
import { loadEmbeddingConfig } from "@vex-agent/embeddings/config.js";
import { scoreRecallCandidate } from "@vex-agent/knowledge/ranking.js";
import { memLog } from "@vex-agent/memory/observability/logger.js";
import {
  blendAndRank,
  graphScore,
  GRAPH_EXPANSION_MAX_ENTITIES,
  GRAPH_EXPANSION_MAX_RESULTS,
  GRAPH_EXPANSION_MAX_SEEDS,
  GRAPH_VIA_ENTITY_MAX,
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

// ── Graph expansion (S8 — fills the D1 hook) ─────────────────────

/** Injectable repo IO so the expansion is unit-testable without a database. */
export interface GraphExpansionDeps {
  listEntityIdsForEntries: typeof listEntityIdsForEntries;
  listActiveEdgesForEntities: typeof listActiveEdgesForEntities;
  listEntryIdsForEntities: typeof listEntryIdsForEntities;
  getActiveEntriesByIds: typeof getActiveEntriesByIds;
}

function defaultGraphExpansionDeps(): GraphExpansionDeps {
  return {
    listEntityIdsForEntries,
    listActiveEdgesForEntities,
    listEntryIdsForEntities,
    getActiveEntriesByIds,
  };
}

export interface GraphExpansion {
  /** Expansion results, graph-score DESC, already capped to the free slots. */
  results: LongMemoryKnowledgeResult[];
  /** Expansion results dropped by the remaining-slot / MAX_RESULTS cap. */
  dropped: number;
  /** Seeds that actually fed the expansion (0 ⇒ the graph was not touched). */
  seedCount: number;
}

const EMPTY_EXPANSION: GraphExpansion = { results: [], dropped: 0, seedCount: 0 };

/**
 * Bounded fetch headroom over the result cap so dedupe vs already-returned ids
 * and duplicate per-entity links cannot starve the fill — still a hard bound
 * (never unbounded fan-out).
 */
const EXPANSION_ENTRY_FETCH_LIMIT = 4 * LONG_MEMORY_INLINE_CAP;

/**
 * ONE-hop graph expansion (S8 / D-EXPAND), post-blend pre-cap:
 *   seeds (top GRAPH_EXPANSION_MAX_SEEDS positive-score ENTRY results)
 *   → seed entities (cap GRAPH_EXPANSION_MAX_ENTITIES)
 *   → active valid-time edges (both directions, per-entity cap)
 *   → neighbor entities → their ACTIVE entries (dedupe vs already returned,
 *     cap min(remainingSlots, GRAPH_EXPANSION_MAX_RESULTS)).
 * Four batch queries total — zero N+1.
 *
 * Scoring: `graphScore(seed.score, neighbor)` — strictly below every positive
 * seed (the seed's own tier×activation already live in seed.score; only the
 * NEIGHBOR's credibility multiplies in). Seeds with score ≤ 0 are skipped
 * (Codex R1 — the strict inequality is meaningless for them). Results carry
 * `via:'graph'` + `viaEntity` and an EMPTY contentMd (bounded pointers — the
 * agent fetches full content via long_memory_get).
 */
export async function expandViaGraph(
  seedResults: readonly LongMemoryResult[],
  alreadyReturnedIds: ReadonlySet<number>,
  remainingSlots: number,
  deps: GraphExpansionDeps = defaultGraphExpansionDeps(),
): Promise<GraphExpansion> {
  if (remainingSlots <= 0) return EMPTY_EXPANSION;

  const seeds = seedResults
    .filter(
      (r): r is LongMemoryKnowledgeResult => r.source === "long_memory" && r.score > 0,
    )
    .slice(0, GRAPH_EXPANSION_MAX_SEEDS);
  if (seeds.length === 0) return EMPTY_EXPANSION;

  // 1. Seed entries → their entities (batch).
  const links = await deps.listEntityIdsForEntries(seeds.map((s) => s.id));
  if (links.length === 0) return { ...EMPTY_EXPANSION, seedCount: seeds.length };

  const seedScoreByEntry = new Map<number, number>();
  for (const s of seeds) {
    const prev = seedScoreByEntry.get(s.id);
    if (prev === undefined || s.score > prev) seedScoreByEntry.set(s.id, s.score);
  }

  // Per entity: the BEST seed score that reaches it (path certainty source).
  const seedEntityScore = new Map<string, number>();
  for (const link of links) {
    const score = seedScoreByEntry.get(link.entryId);
    if (score === undefined) continue;
    const prev = seedEntityScore.get(link.entityId);
    if (prev === undefined || score > prev) seedEntityScore.set(link.entityId, score);
  }
  const seedEntityIds = Array.from(seedEntityScore.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, GRAPH_EXPANSION_MAX_ENTITIES)
    .map(([id]) => id);

  // 2. Active valid-time edges, both directions (batch, per-entity cap).
  const edges = await deps.listActiveEdgesForEntities(
    seedEntityIds,
    GRAPH_EXPANSION_MAX_ENTITIES,
  );
  const seedEntitySet = new Set(seedEntityIds);
  const neighborScore = new Map<string, number>();
  const propagate = (fromSeedEntity: string, toNeighbor: string): void => {
    const score = seedEntityScore.get(fromSeedEntity);
    if (score === undefined) return;
    const prev = neighborScore.get(toNeighbor);
    if (prev === undefined || score > prev) neighborScore.set(toNeighbor, score);
  };
  for (const edge of edges) {
    const sourceSeeded = seedEntitySet.has(edge.sourceEntityId);
    const targetSeeded = seedEntitySet.has(edge.targetEntityId);
    if (sourceSeeded && !targetSeeded) propagate(edge.sourceEntityId, edge.targetEntityId);
    else if (targetSeeded && !sourceSeeded) propagate(edge.targetEntityId, edge.sourceEntityId);
    // Both endpoints seeded → no NEW neighbor; nothing to expand through.
  }
  if (neighborScore.size === 0) return { ...EMPTY_EXPANSION, seedCount: seeds.length };

  const neighborEntityIds = Array.from(neighborScore.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, GRAPH_EXPANSION_MAX_ENTITIES)
    .map(([id]) => id);

  // 3. Neighbor entities → their ACTIVE entries (batch; bounded headroom).
  const refs = await deps.listEntryIdsForEntities(
    neighborEntityIds,
    EXPANSION_ENTRY_FETCH_LIMIT,
  );
  const viaByEntry = new Map<number, { seedScore: number; entityName: string }>();
  for (const ref of refs) {
    if (alreadyReturnedIds.has(ref.entryId)) continue; // dedupe vs direct hits
    const score = neighborScore.get(ref.entityId);
    if (score === undefined) continue;
    const prev = viaByEntry.get(ref.entryId);
    if (prev === undefined || score > prev.seedScore) {
      viaByEntry.set(ref.entryId, { seedScore: score, entityName: ref.entityName });
    }
  }
  if (viaByEntry.size === 0) return { ...EMPTY_EXPANSION, seedCount: seeds.length };

  // 4. Entry DTOs (active + non-expired in SQL — the S3 invariant holds).
  const entries = await deps.getActiveEntriesByIds(Array.from(viaByEntry.keys()));
  const scored: LongMemoryKnowledgeResult[] = [];
  for (const entry of entries) {
    // Every requested id has a via-path by construction; an unrequested row
    // (anomalous repo behavior) is SKIPPED, never emitted with a zero score.
    const via = viaByEntry.get(entry.id);
    if (via === undefined) continue;
    scored.push({
      source: "long_memory" as const,
      id: entry.id,
      kind: entry.kind,
      title: entry.title,
      summary: entry.summary,
      // Bounded pointer — expansion never inlines full content; the agent
      // fetches it via long_memory_get when the lead matters.
      contentMd: "",
      similarity: 0,
      score: graphScore(via.seedScore, {
        sourceTier: entry.source,
        activationStrength: entry.activationStrength,
      }),
      sourceTier: entry.source,
      maturityState: entry.maturityState,
      activationStrength: entry.activationStrength,
      tags: [],
      validUntil: entry.validUntil,
      evidenceRefs: {},
      rerankScore: 0,
      via: "graph" as const,
      viaEntity: via.entityName.slice(0, GRAPH_VIA_ENTITY_MAX),
    });
  }
  scored.sort((a, b) => b.score - a.score);

  const take = Math.min(remainingSlots, GRAPH_EXPANSION_MAX_RESULTS);
  return {
    results: scored.slice(0, take),
    dropped: Math.max(0, scored.length - take),
    seedCount: seeds.length,
  };
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
  /** S8 — `via_graph(<entity>)` marker on graph-expansion results (concise AND detailed). */
  via?: string;
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
  // S8: expansion results are MARKED, never silently mixed with direct hits.
  if (r.source === "long_memory" && r.via === "graph") {
    base.via = `via_graph(${r.viaEntity ?? ""})`;
  }
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

  // 6. Inline-only cap of DIRECT results + truncate-with-steering (no silent
  // drop — R1-#3). Chars cap applies only to detailed (concise omits contentMd)
  // — final-gate fix.
  const direct = capInline(blended.results, input.responseFormat === "detailed");

  // 7. Graph expansion (S8 / D-EXPAND, default ON — F3): fills ONLY the inline
  // slots the direct results left free — it NEVER evicts a direct result.
  // Dedupe is against EVERY directly-recalled entry (returned or truncated),
  // so a truncated direct hit can never resurface mislabeled as a graph lead
  // (that would bypass the truncation steering). Fail-open: an expansion error
  // never fails the search (graph is help, not truth).
  let expansion: GraphExpansion = EMPTY_EXPANSION;
  if (input.expandGraph) {
    const directKnowledgeIds = new Set<number>();
    for (const r of blended.results) {
      if (r.source === "long_memory") directKnowledgeIds.add(r.id);
    }
    const remainingSlots = LONG_MEMORY_INLINE_CAP - direct.inline.length;
    try {
      expansion = await expandViaGraph(blended.results, directKnowledgeIds, remainingSlots);
      memLog("search", "graph_expanded", {
        expandedCount: expansion.results.length,
        seedCount: expansion.seedCount,
      });
    } catch {
      memLog.warn("search", "graph_expansion_failed", { errorKind: "expansion_error" });
      expansion = EMPTY_EXPANSION;
    }
  }

  const inline: LongMemoryResult[] = [...direct.inline, ...expansion.results];
  // droppedCount split (S8): direct truncation vs expansion-cap drops are
  // reported separately — neither is silent.
  const droppedDirect = direct.dropped;
  const droppedExpansion = expansion.dropped;
  const dropped = droppedDirect + droppedExpansion;

  const candidateCount = candidateResults.length;
  memLog("search", "candidates", { count: candidateCount });
  if (droppedDirect > 0) memLog("search", "truncated", { count: droppedDirect });
  if (droppedExpansion > 0) {
    memLog("search", "graph_expansion_truncated", { count: droppedExpansion });
  }
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
    ...(dropped > 0
      ? { droppedCount: dropped, droppedDirect, droppedExpansion, steering }
      : {}),
    candidateCount,
    droppedCandidates: blended.droppedCandidates,
    results: items,
  });
}
