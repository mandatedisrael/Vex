/**
 * Checkpoint — compaction when approaching context limit.
 *
 * Three outcomes, decided by `selectPrefixWithGiantFallback`:
 *   - `prefix`: summarize + extract episodes + partial-archive the prefix.
 *   - `giant_tool`: fork-copy the single bloated tool row into the archive,
 *     replace the live row's content with a placeholder, and emit at least
 *     one `tool_result_summary` episode.
 *   - `noop`: nothing compactable; mark the session with a short cooldown so
 *     we don't hammer the provider every turn.
 *
 * `summarizePrefix` is load-bearing (throws if it can't produce a summary).
 * `extractEpisodes` is best-effort (warns + returns `[]` on failure).
 * Embedding is per-episode and non-fatal.
 */

import type { InferenceProvider, InferenceConfig } from "@echo-agent/inference/types.js";
import * as sessionsRepo from "@echo-agent/db/repos/sessions.js";
import * as messagesRepo from "@echo-agent/db/repos/messages.js";
import * as episodesRepo from "@echo-agent/db/repos/session-episodes.js";
import type { NewEpisode } from "@echo-agent/db/repos/session-episodes.js";
import { embedDocument } from "@echo-agent/embeddings/client.js";
import {
  selectPrefixWithGiantFallback,
  GIANT_TOOL_THRESHOLD,
  type CheckpointPlan,
} from "@echo-agent/engine/checkpoint/prefix.js";
import { summarizePrefix } from "@echo-agent/engine/checkpoint/merge.js";
import {
  extractEpisodes,
  computeEpisodeHash,
  type ExtractedEpisode,
} from "@echo-agent/engine/checkpoint/extract.js";
import logger from "@utils/logger.js";

/** Threshold: checkpoint when tokenCount exceeds 90% of context limit. */
const CHECKPOINT_THRESHOLD = 0.9;

/** Cooldown after a noop so a stuck session doesn't re-enter the same path every turn. */
const NOOP_COOLDOWN_MS = 5 * 60 * 1000;

/**
 * In-memory cooldown map — process-lifetime only. Sessions landing in `noop`
 * get a 5-min back-off to prevent infinite retry. Restart clears it; a fresh
 * attempt after a restart is an acceptable conservative default.
 */
const noopCooldownUntil = new Map<string, number>();

// ── Public API ─────────────────────────────────────────────────

export function shouldCheckpoint(tokenCount: number, contextLimit: number): boolean {
  if (contextLimit <= 0) return false;
  return tokenCount >= contextLimit * CHECKPOINT_THRESHOLD;
}

export interface CheckpointResult {
  mode: CheckpointPlan["mode"];
  summary: string | null;
  episodeIds: number[];
}

/**
 * Execute a checkpoint on the given session.
 *
 * The caller is responsible for deciding that a checkpoint is NEEDED (via
 * `shouldCheckpoint`). This function only decides HOW to compact.
 */
export async function executeCheckpoint(
  sessionId: string,
  memoryScopeKey: string,
  provider: InferenceProvider,
  config: InferenceConfig,
): Promise<CheckpointResult> {
  // 1. Back off recent noops so we don't hammer the provider.
  const cooldownUntil = noopCooldownUntil.get(sessionId);
  if (cooldownUntil !== undefined && Date.now() < cooldownUntil) {
    return { mode: "noop", summary: null, episodeIds: [] };
  }

  // 2. Re-read from DB so every message has its canonical id.
  const messagesWithId = await messagesRepo.getLiveMessagesWithId(sessionId);
  const session = await sessionsRepo.getSession(sessionId);
  const previousSummary = session?.summary ?? null;

  // 3. Decide what to compact.
  const plan = selectPrefixWithGiantFallback(messagesWithId);
  if (plan.mode === "noop") {
    noopCooldownUntil.set(sessionId, Date.now() + NOOP_COOLDOWN_MS);
    logger.warn("checkpoint.noop", { sessionId, reason: plan.reason });
    return { mode: "noop", summary: null, episodeIds: [] };
  }

  // Clear any lingering cooldown now that we're actually making progress.
  noopCooldownUntil.delete(sessionId);

  const input = plan.mode === "prefix" ? plan.prefix : plan.virtualPrefix;
  const sourceStartMessageId = input[0]?.id ?? null;
  const sourceEndMessageId = input[input.length - 1]?.id ?? null;

  // 4. Summary is mandatory — a missing summary means degradation we don't accept.
  const summary = await summarizePrefix(input, previousSummary, provider, config);
  await sessionsRepo.setRollingSummary(sessionId, summary);

  // 5. Episodes are best-effort.
  let extracted = await extractEpisodes(input, provider, config);

  // Giant-tool mode needs at least one tool_result_summary episode so the live
  // placeholder has something substantive to point at. Synthesize a fallback
  // if the extractor didn't produce one.
  if (plan.mode === "giant_tool") {
    const hasSummary = extracted.some((ep) => ep.episodeKind === "tool_result_summary");
    if (!hasSummary) {
      extracted = [...extracted, synthesizeToolResultSummary(plan.bloatedContent)];
    }
  }

  // 6. Embed + insert episodes.
  const insertedEpisodes = await embedAndInsertEpisodes({
    extracted,
    sessionId,
    memoryScopeKey,
    sourceStartMessageId,
    sourceEndMessageId,
  });
  const episodeIds = insertedEpisodes.map((r) => r.id);

  // 7. Apply the archive plan.
  if (plan.mode === "prefix") {
    await sessionsRepo.archivePrefix(sessionId, plan.cutoffMessageId, plan.tail.length);
  } else {
    // Use the *tool_result_summary* episode's id (not the first inserted, which
    // could be a `decision` / `fact` when the extractor returns a mixed batch).
    // If embedding failed for every tool_result_summary, fall through to a
    // placeholder without an episode reference — better than a misleading one.
    const placeholderEpisodeId = insertedEpisodes.find(
      (r) => r.episodeKind === "tool_result_summary",
    )?.id;
    const placeholder = buildGiantToolPlaceholder(plan.bloatedMessageId, placeholderEpisodeId);
    await sessionsRepo.forkToolMessageToArchive(plan.bloatedMessageId, placeholder);
  }

  return { mode: plan.mode, summary, episodeIds };
}

// ── Internals ──────────────────────────────────────────────────

interface InsertedEpisodeRef {
  id: number;
  episodeKind: ExtractedEpisode["episodeKind"];
}

async function embedAndInsertEpisodes(args: {
  extracted: ExtractedEpisode[];
  sessionId: string;
  memoryScopeKey: string;
  sourceStartMessageId: number | null;
  sourceEndMessageId: number | null;
}): Promise<InsertedEpisodeRef[]> {
  if (args.extracted.length === 0) return [];

  const rows: NewEpisode[] = [];
  for (const ep of args.extracted) {
    try {
      const titleHint = ep.summaryEn.slice(0, 120);
      const { embedding, providerModel } = await embedDocument(titleHint, ep.summaryEn);
      rows.push({
        sessionId: args.sessionId,
        memoryScopeKey: args.memoryScopeKey,
        episodeKind: ep.episodeKind,
        summaryEn: ep.summaryEn,
        facts: ep.facts,
        decisions: ep.decisions,
        openLoops: ep.openLoops,
        entities: ep.entities,
        toolOutcomes: ep.toolOutcomes,
        sourceSession: args.sessionId,
        sourceStartMessageId: args.sourceStartMessageId,
        sourceEndMessageId: args.sourceEndMessageId,
        episodeHash: ep.episodeHash,
        embeddingModel: providerModel,
        embeddingDim: embedding.length,
        embedding,
      });
    } catch (err) {
      logger.warn("checkpoint.embed.failed", {
        error: err instanceof Error ? err.message : String(err),
        episodeKind: ep.episodeKind,
      });
    }
  }

  if (rows.length === 0) return [];

  try {
    const inserted = await episodesRepo.insertEpisodes(rows);
    return inserted.map((r) => ({ id: r.id, episodeKind: r.episodeKind }));
  } catch (err) {
    logger.warn("checkpoint.insert.failed", {
      error: err instanceof Error ? err.message : String(err),
      rowCount: rows.length,
    });
    return [];
  }
}

function synthesizeToolResultSummary(bloatedContent: string): ExtractedEpisode {
  const preview = bloatedContent.slice(0, GIANT_TOOL_THRESHOLD / 2).trim();
  const summary =
    `Oversized tool output (${bloatedContent.length} chars) archived verbatim. ` +
    `Leading excerpt: ${preview}`;
  const clamped = summary.slice(0, 2000);
  return {
    episodeKind: "tool_result_summary",
    summaryEn: clamped,
    facts: {},
    decisions: {},
    openLoops: {},
    entities: [],
    toolOutcomes: {},
    episodeHash: computeEpisodeHash("tool_result_summary", clamped),
  };
}

function buildGiantToolPlaceholder(bloatedMessageId: number, episodeId: number | undefined): string {
  const episodeRef = episodeId !== undefined ? `#${episodeId}` : "";
  return (
    `[tool_result_summary${episodeRef} — full payload archived at message_id=${bloatedMessageId}. ` +
    `Ask the operator for replay if needed.]`
  );
}

// ── Test-only helpers ──────────────────────────────────────────

/**
 * Reset the in-memory cooldown map. Test-only hatch — production code never
 * calls this, and we don't expose any way to short-circuit noop back-off from
 * the engine.
 */
export function __resetCheckpointCooldownForTests(): void {
  noopCooldownUntil.clear();
}
