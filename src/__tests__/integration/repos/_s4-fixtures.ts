/**
 * Shared seeding + stub helpers for the S4 memory_manager integration suite. NOT
 * a test file (underscore prefix). S4 does NOT call the real OpenRouter judge —
 * a deterministic stub `JudgeVerdict` is injected via the executor deps. The
 * candidate vectors are synthetic (no embedding endpoint needed); promote reuses
 * the stored candidate embedding.
 */

import { createHash } from "node:crypto";

import { query } from "@vex-agent/db/client.js";
import {
  insertCandidate,
  type InsertCandidateInput,
} from "@vex-agent/db/repos/memory-candidates/index.js";
import { defaultConsolidateDeps } from "@vex-agent/memory/manager/index.js";
import type { ConsolidateDeps } from "@vex-agent/memory/manager/index.js";
import type { JudgeVerdict } from "@vex-agent/memory/manager/judge-schema.js";
import { computeContentHash } from "@vex-agent/knowledge/content-hash.js";
import { makeSession, randVector } from "../setup/fixtures.js";

export const EMBEDDING_DIM = 8;
export const EMBEDDING_MODEL = "test-model";

export function hex64(seed: string): string {
  return createHash("sha256").update(seed).digest("hex");
}

/** Seed a protocol_executions row in a given session; returns its id. */
export async function seedExecution(sessionId: string): Promise<number> {
  const rows = await query<{ id: number }>(
    `INSERT INTO protocol_executions (tool_id, namespace, session_id, success)
     VALUES ('t', 'n', $1, TRUE) RETURNING id`,
    [sessionId],
  );
  if (rows.length === 0) throw new Error("seedExecution: no id");
  return rows[0]!.id;
}

/** Soft-delete a session (OD-3). */
export async function softDeleteSession(sessionId: string): Promise<void> {
  await query(`UPDATE sessions SET deleted_at = NOW() WHERE id = $1`, [sessionId]);
}

export interface SeedCandidateOptions {
  kind?: string;
  title?: string;
  summary?: string;
  contentMd?: string;
  executionIds?: number[];
  importance?: number;
  confidence?: number | null;
  vectorSeed?: string;
}

/**
 * Insert ONE pending candidate with the given evidence anchors + a synthetic
 * vector. Content hash is honest (derived from the text) so promote can reuse it.
 */
export async function seedCandidate(
  sessionId: string,
  seed: string,
  opts: SeedCandidateOptions = {},
): Promise<string> {
  const kind = opts.kind ?? "strategy_lesson";
  const title = opts.title ?? `Lesson ${seed}: scale into strength on confirmed momentum`;
  const summary = opts.summary ?? "Durable pre-decision lesson with no live values.";
  const contentMd = opts.contentMd ?? "Process narrative only.";
  const executionIds = opts.executionIds ?? [];
  const input: InsertCandidateInput = {
    sessionId,
    proposedBy: "parent",
    kind,
    title,
    summary,
    contentMd,
    entities: [],
    tags: [],
    sourceRefs: { messageIds: [] },
    evidenceRefs: executionIds.map((id) => ({ executionId: id })),
    source: "hypothesis",
    confidence: opts.confidence === undefined ? 0.7 : opts.confidence,
    importance: opts.importance ?? 7,
    sensitivity: "normal",
    evidenceStrength: "none",
    retrievalVisibility: "not_consolidated",
    retrievalUntil: null,
    retainUntil: null,
    embedding: randVector(EMBEDDING_DIM, opts.vectorSeed ?? `cand-${seed}`),
    embeddingModel: EMBEDDING_MODEL,
    embeddingDim: EMBEDDING_DIM,
    contentHash: computeContentHash({ kind, title, summary, contentMd }),
    eventTime: null,
    observedAt: null,
    availableAtDecisionTime: null,
  };
  const { candidate } = await insertCandidate(input);
  return candidate.id;
}

/** A deterministic stub judge returning a fixed verdict. */
export function stubJudge(verdict: JudgeVerdict): ConsolidateDeps["judge"] {
  return async () => ({ verdict, llmCalls: 1, costUsd: 0.001 });
}

/**
 * Build consolidate deps with the REAL recall/deref against pgvector but a STUB
 * judge (no OpenRouter). The cluster recall + knowledge recall + evidence deref
 * all hit the DB so the full integration path is exercised.
 *
 * S8: `buildGraphPlan` is stubbed to null (extraction fail-open) so these
 * suites NEVER call the real extractor LLM — even when OPENROUTER_API_KEY is
 * present in the environment. Graph-v1 behavior is pinned by its own suite
 * (graph-v1.int.test.ts) with a deterministic extraction stub.
 */
export function depsWithStubJudge(verdict: JudgeVerdict): ConsolidateDeps {
  return {
    ...defaultConsolidateDeps(),
    judge: stubJudge(verdict),
    buildGraphPlan: async () => null,
  };
}

export const PROMOTE_VERDICT: JudgeVerdict = {
  verdict: "promote",
  rubric: { grounding: 3, durability: 3, novelty: 3, generalizability: 4, processNotOutcome: 4 },
  sourceTier: "observed",
  regimeTags: ["bull"],
};

export { makeSession, randVector };
