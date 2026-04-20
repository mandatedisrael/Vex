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
 * Two-phase write (PR2, post-migration 008):
 *   Phase I is all remote work (language code read, summarize, extract,
 *   embed) and happens OUTSIDE any transaction — long idle-in-tx against
 *   remote LLM calls is an antipattern. Phase II is the single atomic tx
 *   that commits the whole write set (language_code persist if inferred,
 *   rolling summary, episodes, archive move / giant-tool fork). A crash
 *   mid-Phase-II rolls the entire set back — no split-brain where summary
 *   is updated but episodes missed the write, and no partial archive.
 *
 * `summarizePrefix` is load-bearing (throws if it can't produce a summary).
 * `extractEpisodes` is best-effort (warns + returns empty on failure).
 * Embedding is per-episode and non-fatal within Phase I.
 */

import type { PoolClient } from "pg";
import type { InferenceProvider, InferenceConfig, ProviderMessage, ToolDefinition } from "@echo-agent/inference/types.js";
import * as sessionsRepo from "@echo-agent/db/repos/sessions.js";
import * as messagesRepo from "@echo-agent/db/repos/messages.js";
import * as episodesRepo from "@echo-agent/db/repos/session-episodes.js";
import * as checkpointHandoffsRepo from "@echo-agent/db/repos/checkpoint-handoffs.js";
import type { NewEpisode } from "@echo-agent/db/repos/session-episodes.js";
import type { CheckpointHandoffPayload } from "@echo-agent/db/repos/checkpoint-handoffs.js";
import { getPool } from "@echo-agent/db/client.js";
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
import { getAllTools } from "@echo-agent/tools/registry.js";
import { toOpenAITools } from "@echo-agent/tools/types.js";
import { handleCheckpointHandoffPrepare } from "@echo-agent/tools/internal/checkpoint-handoff.js";
import { computeBand } from "./context-band.js";
import logger from "@utils/logger.js";

/** Threshold: checkpoint when tokenCount exceeds 90% of context limit. */
const CHECKPOINT_THRESHOLD = 0.9;

/** Cooldown after a noop so a stuck session doesn't re-enter the same path every turn. */
const NOOP_COOLDOWN_MS = 5 * 60 * 1000;

/**
 * Cooldown for the Phase 0 forced handoff pass. 60s — enough to prevent a
 * token_count re-trigger loop (band stays critical across several turns
 * until the normal checkpoint clears it) without starving recovery when the
 * model actually produces a useful handoff.
 */
const FORCED_HANDOFF_COOLDOWN_MS = 60 * 1000;

/** Fallback title hint length — matches the pre-PR2 slice(0, 120) cap. */
const TITLE_FALLBACK_CHARS = 120;

/**
 * In-memory cooldown map — process-lifetime only. Sessions landing in `noop`
 * get a 5-min back-off to prevent infinite retry. Restart clears it; a fresh
 * attempt after a restart is an acceptable conservative default.
 */
const noopCooldownUntil = new Map<string, number>();

/**
 * Per-session cooldown for the PR-9 forced handoff pass. Matches
 * `noopCooldownUntil` semantics (process-lifetime only, cleared on restart)
 * so an over-critical band doesn't fire the forced pass on every turn.
 */
const forcedPassCooldownUntil = new Map<string, number>();

/**
 * Per-session serialization for `executeCheckpoint`. Process-local mutex —
 * single-process wake executor contract (see ADR-001) means this plus the
 * `SELECT … FOR UPDATE` row lock inside Phase II is sufficient. Spanning
 * both Phase I (remote LLM I/O, outside any tx) and Phase II (short tx) with
 * a PG advisory *xact* lock would be wrong — xact locks release on COMMIT,
 * which sits in the middle of the combined flow.
 *
 * Two callers racing on the same session queue up on this promise chain and
 * run sequentially. Unrelated sessions are independent.
 */
const checkpointInFlight = new Map<string, Promise<void>>();

async function withCheckpointMutex<T>(
  sessionId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const prev = checkpointInFlight.get(sessionId) ?? Promise.resolve();

  let resolveCurrent!: () => void;
  const current = new Promise<void>((r) => { resolveCurrent = r; });
  const chained = prev.then(() => current);
  checkpointInFlight.set(sessionId, chained);

  try {
    await prev;
    return await fn();
  } finally {
    resolveCurrent();
    // Tail cleanup — only remove if no later caller has chained behind us.
    if (checkpointInFlight.get(sessionId) === chained) {
      checkpointInFlight.delete(sessionId);
    }
  }
}

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
  return withCheckpointMutex(sessionId, () =>
    executeCheckpointInner(sessionId, memoryScopeKey, provider, config),
  );
}

async function executeCheckpointInner(
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
  const currentCode = session?.memoryLanguageCode ?? null;

  // Phase 0 — forced handoff pass. Fires only when the band is already
  // `critical`, no active handoff exists for the next generation, and the
  // per-session cooldown has elapsed. See PR-9 in the wake roadmap and
  // ADR-001 for the side-effect-light contract (no usageRepo, no
  // sessionsRepo.updateTokenCount, no saveAssistantMessage).
  if (session) {
    const band = computeBand(session.tokenCount, config.contextLimit);
    if (band === "critical") {
      await maybeRunForcedHandoffPass(
        sessionId,
        session.checkpointGeneration + 1,
        messagesWithId,
        provider,
        config,
      );
    }
  }

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

  // ── Phase I — remote (NO open transaction) ─────────────────────
  // Summary is load-bearing — a throw here aborts the whole checkpoint
  // before any DB write happens, so state is clean for the next retry.
  const summary = await summarizePrefix(input, previousSummary, provider, config, currentCode);

  // Episodes are best-effort — schema-invalid or provider-fail returns empty.
  let extraction = await extractEpisodes(input, provider, config, currentCode);

  // Giant-tool mode needs at least one tool_result_summary episode so the live
  // placeholder has something substantive to point at. Synthesize a fallback
  // if the extractor didn't produce one.
  if (plan.mode === "giant_tool") {
    const hasSummary = extraction.episodes.some((ep) => ep.episodeKind === "tool_result_summary");
    if (!hasSummary) {
      extraction = {
        ...extraction,
        episodes: [...extraction.episodes, synthesizeToolResultSummary(plan.bloatedContent)],
      };
    }
  }

  // Embed all episodes up front. Failures drop the row (tracked by warn log)
  // but do NOT abort the checkpoint — inserts still go through for the rest.
  const embeddedRows = await embedAllEpisodes({
    extracted: extraction.episodes,
    sessionId,
    memoryScopeKey,
    sourceStartMessageId,
    sourceEndMessageId,
  });

  // ── Phase II — atomic DB write (single tx) ────────────────────
  // All writes commit together; a failure rolls the whole set back so the
  // invariant "summary ↔ episodes ↔ archive state" never desyncs.
  const { insertedEpisodes } = await runCheckpointWriteTx({
    sessionId,
    summary,
    currentCode,
    inferredCode: extraction.sessionLanguageInferred,
    embeddedRows,
    plan,
  });

  const episodeIds = insertedEpisodes.map((r) => r.id);
  return { mode: plan.mode, summary, episodeIds };
}

// ── Internals ──────────────────────────────────────────────────

interface InsertedEpisodeRef {
  id: number;
  episodeKind: ExtractedEpisode["episodeKind"];
}

async function embedAllEpisodes(args: {
  extracted: readonly ExtractedEpisode[];
  sessionId: string;
  memoryScopeKey: string;
  sourceStartMessageId: number | null;
  sourceEndMessageId: number | null;
}): Promise<NewEpisode[]> {
  if (args.extracted.length === 0) return [];

  const rows: NewEpisode[] = [];
  for (const ep of args.extracted) {
    try {
      // LLM-generated title is authoritative post-PR2. Fallback to the
      // truncated summary when the LLM omitted it — extract.ts already
      // logs a `checkpoint.extract.title_missing` warn in that case.
      const titleHint =
        ep.title.trim().length > 0 ? ep.title : ep.summaryText.slice(0, TITLE_FALLBACK_CHARS);
      const { embedding, providerModel } = await embedDocument(titleHint, ep.summaryText);
      rows.push({
        sessionId: args.sessionId,
        memoryScopeKey: args.memoryScopeKey,
        episodeKind: ep.episodeKind,
        title: ep.title,
        summaryText: ep.summaryText,
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
  return rows;
}

/**
 * Phase II — one transaction that holds the whole checkpoint write set.
 *
 * Order matters:
 *   1. Persist memory_language_code only when the session didn't have one
 *      (first checkpoint). Later checkpoints re-send the persisted code but
 *      the UPDATE is gated by `WHERE memory_language_code IS NULL` so
 *      we're idempotent either way.
 *   2. Rolling summary is always updated.
 *   3. Episode inserts are bundled — zero rows is acceptable.
 *   4. Archive: prefix or giant-tool fork, depending on plan.
 *
 * A failure anywhere rolls the whole tx back. The caller surfaces the
 * throw; `turn-loop.ts` treats checkpoint errors as best-effort and
 * swallows them with a warn log.
 */
async function runCheckpointWriteTx(args: {
  sessionId: string;
  summary: string;
  currentCode: string | null;
  inferredCode: string;
  embeddedRows: readonly NewEpisode[];
  plan: Extract<CheckpointPlan, { mode: "prefix" } | { mode: "giant_tool" }>;
}): Promise<{ insertedEpisodes: InsertedEpisodeRef[] }> {
  const pool = getPool();
  const tx = await pool.connect();
  try {
    await tx.query("BEGIN");

    // 1. Persist inferred language on the first checkpoint only.
    if (args.currentCode === null && args.inferredCode.length > 0) {
      try {
        await sessionsRepo.setMemoryLanguageCode(args.sessionId, args.inferredCode, tx);
        logger.info("checkpoint.language_code.inferred", {
          sessionId: args.sessionId,
          code: args.inferredCode,
        });
      } catch (err) {
        // Invalid code from the LLM — keep the checkpoint going without
        // persisting; next checkpoint will try again. Log LOUD because this
        // is a compliance signal against the LLM prompt, not DB pressure.
        logger.error("checkpoint.language_code.invalid", {
          sessionId: args.sessionId,
          received: args.inferredCode,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // 2. Rolling summary.
    await sessionsRepo.setRollingSummary(args.sessionId, args.summary, tx);

    // 3. Generation bump — serialize concurrent checkpoints on the same
    //    session via row lock. FOR UPDATE blocks a second executeCheckpoint
    //    that skipped the in-process mutex (different process) until this tx
    //    commits. Inside a single process the module-level mutex already
    //    serializes callers; this row lock is the second line of defense for
    //    multi-process deployments we don't have yet but don't want to break.
    const genRow = await tx.query<{ checkpoint_generation: number }>(
      "SELECT checkpoint_generation FROM sessions WHERE id = $1 FOR UPDATE",
      [args.sessionId],
    );
    const currentGen = genRow.rows[0]?.checkpoint_generation ?? 0;
    const nextGen = currentGen + 1;

    // 4. Episodes — stamped with the new generation. Null-return (zero
    //    embedded rows) still bumps the counter below: a checkpoint that
    //    produces a summary + archive but no episodes is still a checkpoint.
    const stampedRows = args.embeddedRows.map((r) => ({
      ...r,
      checkpointGeneration: nextGen,
    }));
    const inserted =
      stampedRows.length > 0
        ? await episodesRepo.insertEpisodes(stampedRows, tx)
        : [];
    const insertedEpisodes: InsertedEpisodeRef[] = inserted.map((r) => ({
      id: r.id,
      episodeKind: r.episodeKind,
    }));

    // 5. Persist the bumped counter.
    await tx.query(
      "UPDATE sessions SET checkpoint_generation = $2 WHERE id = $1",
      [args.sessionId, nextGen],
    );

    // 5b. Consume any active handoff for the freshly-bumped generation. PR-9
    //     Phase 0 + `checkpoint_handoff_prepare` both target `target_gen =
    //     current_gen + 1`; here is the atomic read/flip inside the same tx.
    //     A handoff written for a STALE target_gen (writer saw old generation
    //     and lost the race) is left in `active` — it's visible to the next
    //     checkpoint and will either be consumed or superseded then.
    try {
      const active = await checkpointHandoffsRepo.getActive(args.sessionId, nextGen, tx);
      if (active) {
        const flipped = await checkpointHandoffsRepo.consume(active.id, tx);
        if (flipped === 0) {
          logger.warn("checkpoint.handoff.consume_raced", {
            sessionId: args.sessionId,
            handoffId: active.id,
            targetGen: nextGen,
          });
        } else {
          logger.info("checkpoint.handoff.consumed", {
            sessionId: args.sessionId,
            handoffId: active.id,
            targetGen: nextGen,
          });
        }
      }
    } catch (err) {
      // Handoff consume is best-effort — a checkpoint that compacted
      // correctly must not roll back because the handoff flip failed.
      logger.warn("checkpoint.handoff.consume_failed", {
        sessionId: args.sessionId,
        targetGen: nextGen,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // 6. Archive — branch on plan mode.
    if (args.plan.mode === "prefix") {
      await sessionsRepo.archivePrefix(
        args.sessionId,
        args.plan.cutoffMessageId,
        args.plan.tail.length,
        tx,
      );
    } else {
      // Use the tool_result_summary episode id (not the first inserted id,
      // which could be a `decision` / `fact` in a mixed batch). If embed
      // failed for every tool_result_summary, fall through to a placeholder
      // without an episode reference — better than a misleading one.
      const placeholderEpisodeId = insertedEpisodes.find(
        (r) => r.episodeKind === "tool_result_summary",
      )?.id;
      const placeholder = buildGiantToolPlaceholder(args.plan.bloatedMessageId, placeholderEpisodeId);
      await sessionsRepo.forkToolMessageToArchive(args.plan.bloatedMessageId, placeholder, tx);
    }

    await tx.query("COMMIT");
    return { insertedEpisodes };
  } catch (err) {
    await rollback(tx);
    throw err;
  } finally {
    tx.release();
  }
}

async function rollback(tx: PoolClient): Promise<void> {
  try {
    await tx.query("ROLLBACK");
  } catch {
    // ROLLBACK failures are non-actionable; the original error is what matters.
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
    title: "Oversized tool output (archived)",
    summaryText: clamped,
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
  forcedPassCooldownUntil.clear();
}

/**
 * Reset the in-memory serialization map. Test-only hatch so a failed test
 * can't leak a stuck promise across test cases.
 */
export function __resetCheckpointMutexForTests(): void {
  checkpointInFlight.clear();
}

// ── PR-9 Phase 0: forced handoff pass ───────────────────────────

/**
 * Cap on the number of recent live messages shown to the Phase 0 pass.
 * Keeps the inline `chatCompletion` call cheap even on pressure-loaded
 * sessions (we're at ≥ 90% for a reason).
 */
const FORCED_PASS_MESSAGE_WINDOW = 12;

/** Cap per message shown to Phase 0 — same idea as `PER_MESSAGE_CHAR_CAP` in merge.ts. */
const FORCED_PASS_PER_MESSAGE_CAP = 500;

/**
 * Phase 0 orchestration — decide whether to fire the forced pass. Skips
 * when:
 *   - an active handoff already exists for `targetGeneration`
 *     (either `checkpoint_handoff_prepare` fired earlier this turn, or a
 *     previous Phase 0 succeeded and we haven't compacted yet),
 *   - the per-session cooldown is still active.
 *
 * On miss we fall back to a deterministic DB-based handoff so
 * `effectiveRecallSeed` always sees a non-empty `preferred_recall_query`.
 */
async function maybeRunForcedHandoffPass(
  sessionId: string,
  targetGeneration: number,
  messages: readonly messagesRepo.MessageWithId[],
  provider: InferenceProvider,
  config: InferenceConfig,
): Promise<void> {
  const existing = await checkpointHandoffsRepo.getActive(sessionId, targetGeneration);
  if (existing) return;

  const cooldownUntil = forcedPassCooldownUntil.get(sessionId);
  if (cooldownUntil !== undefined && Date.now() < cooldownUntil) {
    logger.info("checkpoint.forced_pass.cooldown_active", {
      sessionId,
      targetGeneration,
      resumesAtMs: cooldownUntil - Date.now(),
    });
    return;
  }

  forcedPassCooldownUntil.set(sessionId, Date.now() + FORCED_HANDOFF_COOLDOWN_MS);

  const modelWroteHandoff = await runForcedHandoffPass(
    sessionId,
    targetGeneration,
    messages,
    provider,
    config,
  );

  // Always confirm a handoff exists — the model may have declined the tool
  // call, or the inline call may have errored silently. `effectiveRecallSeed`
  // depends on a non-empty `preferred_recall_query`, so fall back to a
  // deterministic DB-based payload when the model didn't land one.
  if (!modelWroteHandoff) {
    await writeDeterministicFallbackHandoff(sessionId, targetGeneration);
  }
}

/**
 * Side-effect-light forced pass. Calls `provider.chatCompletion` directly
 * with the SINGLE tool we want (`checkpoint_handoff_prepare`). No
 * `executeTurn`, no `saveAssistantMessage`, no `usageRepo.logUsage`, no
 * `sessionsRepo.updateTokenCount` — if the model emits the tool call, we
 * drive the handler inline and exit.
 *
 * Returns `true` when the handoff row landed, `false` otherwise (caller
 * falls back to the deterministic writer).
 */
async function runForcedHandoffPass(
  sessionId: string,
  targetGeneration: number,
  messages: readonly messagesRepo.MessageWithId[],
  provider: InferenceProvider,
  config: InferenceConfig,
): Promise<boolean> {
  const allTools = getAllTools();
  const handoffTool = allTools.find((t) => t.name === "checkpoint_handoff_prepare");
  if (!handoffTool) {
    logger.error("checkpoint.forced_pass.tool_missing", { sessionId });
    return false;
  }

  const tools: ToolDefinition[] = toOpenAITools([handoffTool]).map((ot) => ({
    type: "function" as const,
    function: ot.function,
  }));

  const providerMessages = buildForcedPassMessages(messages);

  let response;
  try {
    response = await provider.chatCompletion(providerMessages, tools, config);
  } catch (err) {
    logger.warn("checkpoint.forced_pass.completion_failed", {
      sessionId,
      targetGeneration,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }

  const toolCalls = response.toolCalls ?? [];
  if (toolCalls.length === 0) {
    logger.info("checkpoint.forced_pass.no_tool_call", { sessionId, targetGeneration });
    return false;
  }

  // Dispatch the handoff handler directly — NOT via the dispatcher, so we
  // bypass approval / logging / engine-signal plumbing. The handler itself
  // writes the row and is the ONLY DB side effect of this pass.
  const call = toolCalls[0]!;
  if (call.name !== "checkpoint_handoff_prepare") {
    logger.warn("checkpoint.forced_pass.unexpected_tool", {
      sessionId,
      toolName: call.name,
    });
    return false;
  }

  try {
    const result = await handleCheckpointHandoffPrepare(call.arguments, {
      sessionId,
      loadedDocuments: new Map(),
      loopMode: "off",
      approved: true,
      role: "parent",
      missionRunId: null,
      sessionKind: "mission",
      contextUsageBand: "critical",
    });
    if (!result.success) {
      logger.warn("checkpoint.forced_pass.handler_rejected", {
        sessionId,
        reason: result.output,
      });
      return false;
    }
    logger.info("checkpoint.forced_pass.handoff_written", {
      sessionId,
      targetGeneration,
    });
    return true;
  } catch (err) {
    logger.warn("checkpoint.forced_pass.handler_threw", {
      sessionId,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

function buildForcedPassMessages(
  messages: readonly messagesRepo.MessageWithId[],
): ProviderMessage[] {
  const tail = messages.slice(-FORCED_PASS_MESSAGE_WINDOW);
  const excerpt = tail
    .map((m) => `[${m.role}]: ${m.content.slice(0, FORCED_PASS_PER_MESSAGE_CAP)}`)
    .join("\n");
  const system =
    "Context is critical (>= 90%). A checkpoint will compact the prompt in a moment. " +
    "Call `checkpoint_handoff_prepare` ONCE to record what the post-compact turn needs: " +
    "`preserve_md` (what must survive), `preferred_recall_query` (recall seed), " +
    "`important_entities` (wallets, symbols, ids), `open_loops` (unresolved follow-ups). " +
    "Pass arrays as JSON strings, keep every string inside the declared bounds, and " +
    "do NOT emit any other tool call or assistant text.";
  return [
    { role: "system", content: system },
    { role: "user", content: `Recent conversation excerpt (last ${tail.length} messages):\n${excerpt}` },
  ];
}

/**
 * Deterministic fallback — synthesises a non-empty handoff payload from the
 * most recent episodes when the model refused or failed to call the tool.
 */
async function writeDeterministicFallbackHandoff(
  sessionId: string,
  targetGeneration: number,
): Promise<void> {
  try {
    const recent = await episodesRepo.listRecentBySession(sessionId, 5);
    const payload = buildDeterministicFallbackPayload(recent);
    await checkpointHandoffsRepo.writeHandoff(sessionId, targetGeneration, payload);
    logger.info("checkpoint.forced_pass.fallback_written", {
      sessionId,
      targetGeneration,
      entityCount: payload.importantEntities.length,
      openLoopCount: payload.openLoops.length,
    });
  } catch (err) {
    // A failed fallback is non-fatal — the checkpoint proceeds and the post-
    // compact recall falls back to `findLastUserInput`. Logging loud so we
    // can spot the pattern if it recurs.
    logger.error("checkpoint.forced_pass.fallback_failed", {
      sessionId,
      targetGeneration,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

function buildDeterministicFallbackPayload(
  recent: readonly episodesRepo.SessionEpisode[],
): CheckpointHandoffPayload {
  if (recent.length === 0) {
    return {
      preserveMd: "",
      preferredRecallQuery: "Resume session after compaction",
      importantEntities: [],
      openLoops: [],
    };
  }

  // Top-3 episode titles → recall seed. Drop empty titles so legacy rows
  // don't produce `" / foo / "` patterns.
  const titles = recent
    .slice(0, 3)
    .map((ep) => ep.title.trim())
    .filter((t) => t.length > 0);

  const preferredRecallQuery = titles.length > 0
    ? titles.join(" / ")
    : "Resume session after compaction";

  // Top-5 episode entities → deduped, clipped to entity bound.
  const entities = new Set<string>();
  for (const ep of recent) {
    for (const e of ep.entities) {
      if (typeof e !== "string") continue;
      const trimmed = e.trim().slice(0, 100);
      if (trimmed.length === 0) continue;
      entities.add(trimmed);
      if (entities.size >= 20) break;
    }
    if (entities.size >= 20) break;
  }

  // Top-5 episode open_loops (JSONB shape: {"short label": "detail"}).
  const openLoops: string[] = [];
  for (const ep of recent) {
    for (const [key, value] of Object.entries(ep.openLoops)) {
      const detail = typeof value === "string" ? value : JSON.stringify(value);
      const combined = `${key}: ${detail}`.slice(0, 200);
      openLoops.push(combined);
      if (openLoops.length >= 20) break;
    }
    if (openLoops.length >= 20) break;
  }

  return {
    preserveMd: "",
    preferredRecallQuery: preferredRecallQuery.slice(0, 500),
    importantEntities: [...entities],
    openLoops,
  };
}
