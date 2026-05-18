/**
 * Compact-jobs executor — Track 2 chunking worker.
 *
 * Mirrors `engine/wake/executor.ts` structure: poll loop with idempotent
 * shutdown, in-memory per-session mutex preventing concurrent processing
 * of the same session's jobs, bootstrap stale-recovery on start.
 *
 * Lifecycle per job:
 *   1. claimNextDueJob(workerId) under FOR UPDATE SKIP LOCKED
 *   2. Start heartbeat interval
 *   3. Load archived prefix from messages_archive via source_*_message_id
 *   4. Build chunker prompt + call OpenRouter (same provider as agent —
 *      reads OPENROUTER_API_KEY + AGENT_MODEL from env populated by
 *      local-secret-vault at boot, same path the in-turn provider uses)
 *   5. Parse JSON output, validate themes, redact, exclusion-check
 *   6. For each accepted chunk: prepareMemoryRender → embedDocument →
 *      insertPreparedMemory (exact-body embedding per codex contract)
 *   7. Stop heartbeat
 *   8. markCompleted with audit (workerId-owner-checked)
 *
 * On failure: markFailed schedules retry with exponential backoff (workerId
 * owner-checked); after WORKER_MAX_ATTEMPTS the job goes permanently_failed.
 */

import { randomUUID } from "node:crypto";

import {
  claimNextDueJob,
  heartbeat,
  markCompleted,
  markFailed,
  recoverStaleRunning,
  type CompactJob,
} from "@vex-agent/db/repos/compact-jobs/index.js";
import { query } from "@vex-agent/db/client.js";
import { embedDocument } from "@vex-agent/embeddings/client.js";
import {
  insertPreparedMemory,
  prepareMemoryRender,
} from "@vex-agent/db/repos/session-memories/index.js";
import { redact, type RedactionResult } from "@vex-agent/memory/redaction.js";
import { scanLiveState } from "@vex-agent/memory/exclusion-rules.js";
import { validateTheme, buildFallbackTheme } from "@vex-agent/memory/theme-validation.js";
import { shouldEmitHeartbeatFailure } from "./heartbeat-rate-limit.js";
import {
  MAX_CHUNKS_PER_COMPACT,
  MAX_OUTSTANDING_ITEMS_PER_CHUNK,
  TRACK2_RETRY_BACKOFF_BASE_MS,
  TRACK2_TIMEOUT_MS,
  WORKER_HEARTBEAT_INTERVAL_MS,
  WORKER_STALE_THRESHOLD_MS,
} from "@vex-agent/memory/policy.js";
import { z } from "zod";
import logger from "@utils/logger.js";

export interface CompactJobsExecutorHandle {
  stop: () => Promise<void>;
}

export interface StartOptions {
  /** Poll interval in ms. Default 5000. */
  pollIntervalMs?: number;
}

const POLL_INTERVAL_MS_DEFAULT = 5_000;

export function startCompactJobsExecutor(
  options: StartOptions = {},
): CompactJobsExecutorHandle {
  const interval = options.pollIntervalMs ?? POLL_INTERVAL_MS_DEFAULT;
  const workerId = `compact-worker-${process.pid}-${randomUUID().slice(0, 8)}`;
  let stopped = false;
  let inFlight: Promise<void> | null = null;
  let timer: NodeJS.Timeout | null = null;
  const sessionMutex = new Set<string>(); // per-session in-flight set

  // Bootstrap stale recovery — handles app-crash leftovers. DB failures
  // here are non-fatal for the executor lifecycle (next tick will retry
  // claim), but the rejection must NOT bubble into Node's
  // unhandledRejection trap.
  void recoverStaleRunning(WORKER_STALE_THRESHOLD_MS)
    .then((n) => {
      if (n > 0) {
        logger.info("compact-worker.stale_recovered", { count: n, workerId });
      }
    })
    .catch((err) => {
      logger.warn("compact-worker.stale_recovery_failed", {
        workerId,
        error: err instanceof Error ? err.message : String(err),
      });
    });

  const tick = async (): Promise<void> => {
    try {
      // Pre-claim provider-config gate — claimNextDueJob increments
      // attempt_count, so claiming and then throwing on missing config would
      // burn the retry budget and prematurely escalate jobs to
      // permanently_failed. Stay idle until env is wired (operator unlocks
      // OPENROUTER_API_KEY / sets AGENT_MODEL → next tick claims normally).
      if (!process.env.OPENROUTER_API_KEY || !process.env.AGENT_MODEL) {
        logger.warn("compact-worker.skip_no_provider_config", { workerId });
        return;
      }
      const job = await claimNextDueJob(workerId);
      if (!job) return;
      if (sessionMutex.has(job.sessionId)) {
        // Another in-process pick already touched this session — release the
        // claim by failing it back to pending. Should be rare.
        await markFailed(job.id, workerId, "in_process_session_busy", 5_000);
        return;
      }
      sessionMutex.add(job.sessionId);
      try {
        await processJob(job, workerId);
      } finally {
        sessionMutex.delete(job.sessionId);
      }
    } catch (err) {
      logger.error("compact-worker.tick_failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const schedule = (): void => {
    if (stopped) return;
    inFlight = tick().finally(() => {
      inFlight = null;
      if (!stopped) timer = setTimeout(schedule, interval);
    });
  };

  schedule();

  return {
    async stop(): Promise<void> {
      stopped = true;
      if (timer) clearTimeout(timer);
      if (inFlight) await inFlight;
    },
  };
}

// ── Per-job processing ───────────────────────────────────────────

async function processJob(job: CompactJob, workerId: string): Promise<void> {
  const startMs = Date.now();
  // Cancellation flag — flipped to `true` when the heartbeat reports the
  // worker has lost ownership of this row (another worker recovered the
  // stale claim). Checked between expensive stages so we cap wasted work
  // and avoid the doubly-claimed compact path producing duplicate Track 2
  // output. The owner-checked `markCompleted` / `markFailed` at terminal
  // states already prevents state corruption — this is the upstream
  // cost-control guard codex P2 round 3 requested.
  let claimLost = false;
  const heartbeatTimer = setInterval(async () => {
    try {
      const ok = await heartbeat(job.id, workerId);
      if (!ok && !claimLost) {
        claimLost = true;
        logger.warn("compact-worker.claim_lost", {
          jobId: job.id,
          sessionId: job.sessionId,
          workerId,
        });
      }
    } catch (err) {
      // Network/DB hiccup — don't flip the claim-lost flag (transient ≠ owner
      // loss). Rate-limited per workerId so a long outage window emits one
      // log per minute instead of one per tick.
      if (shouldEmitHeartbeatFailure(workerId)) {
        logger.warn("compact-worker.heartbeat_failed", {
          jobId: job.id,
          sessionId: job.sessionId,
          workerId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }, WORKER_HEARTBEAT_INTERVAL_MS);

  try {
    const archivedPrefix = await loadArchivedPrefix(
      job.sessionId,
      job.sourceStartMessageId,
      job.sourceEndMessageId,
    );
    if (claimLost) return;
    if (archivedPrefix.length === 0) {
      // An empty range against committed source_*_message_id values means
      // the archive write was rolled back, the messages were re-archived
      // elsewhere, or a row range disappeared — none of which are a "0
      // chunks" success. Marking completed would silently drop the job's
      // implied work; treat as retryable so the next attempt re-reads the
      // archive after any in-flight Phase II finishes, or surfaces a
      // permanent corruption signal once attempts are exhausted.
      logger.warn("compact-worker.empty_archive_range", {
        jobId: job.id,
        sessionId: job.sessionId,
        sourceStartMessageId: job.sourceStartMessageId,
        sourceEndMessageId: job.sourceEndMessageId,
      });
      throw new Error("compact_worker_empty_archive_range");
    }

    const chunkerOutput = await callChunkerLLM(job, archivedPrefix);
    if (claimLost) return;

    let inserted = 0;
    let rejectedExclusion = 0;

    for (const raw of chunkerOutput.slice(0, MAX_CHUNKS_PER_COMPACT)) {
      // Redaction across ALL generated string fields the chunker emitted —
      // narrative + outstanding items + entities/protocols/error_classes/
      // chains/tasks/theme. Anything that lands in the row's structured
      // columns (or in the body_md / embedded text) must be redacted before
      // DB write so secrets and address/tx identifiers never reach storage.
      const themeR = redact(raw.theme ?? "");
      const r1 = redact(raw.happened_md ?? "");
      const r2 = redact(raw.did_md ?? "");
      const r3 = redact(raw.tried_md ?? "");
      const rOuts = (raw.outstanding_items ?? []).slice(0, MAX_OUTSTANDING_ITEMS_PER_CHUNK).map(
        (t) => redact(t),
      );
      const entitiesR = redactStringArray(raw.entities ?? []);
      const protocolsR = redactStringArray(raw.protocols ?? []);
      const errorClassesR = redactStringArray(raw.error_classes ?? []);
      const chainsR = redactStringArray(raw.chains ?? []);
      const tasksR = redactStringArray(raw.tasks ?? []);

      const totalHard =
        themeR.hardRedactCount
        + r1.hardRedactCount + r2.hardRedactCount + r3.hardRedactCount
        + rOuts.reduce((acc, r) => acc + r.hardRedactCount, 0)
        + entitiesR.hardCount + protocolsR.hardCount + errorClassesR.hardCount
        + chainsR.hardCount + tasksR.hardCount;

      // Validate the REDACTED theme — hard-redact placeholders would fail
      // slug validation anyway, but the build-fallback path still needs
      // sanitized inputs so a leaked identifier doesn't survive via the
      // fallback theme construction.
      const themeResult = validateTheme(themeR.text);
      const theme = themeResult.ok
        ? themeResult.theme
        : buildFallbackTheme({
            entities: entitiesR.values,
            protocols: protocolsR.values,
            errorClasses: errorClassesR.values,
            chains: chainsR.values,
            tasks: tasksR.values,
            generation: job.checkpointGeneration,
          });
      const themeSource = themeResult.ok ? "chunker" : "fallback";

      // Exclusion check on the redacted body — if it's mostly live state,
      // drop the chunk. Outstanding items ARE part of `body_md` (rendered
      // by `renderBodyMd` + embedded into pgvector), so a chunk with bland
      // narrative sections but live-state-only outstanding items would
      // otherwise sneak past the rejection rule and pollute recall. Include
      // the redacted outstanding text in the scan input. (codex P1 — round 2.)
      const outstandingTextForExclusion = rOuts.map((r) => r.text).join("\n");
      const bodyForExclusion =
        `${r1.text}\n${r2.text}\n${r3.text}\n${outstandingTextForExclusion}`;
      const exclusionScan = scanLiveState(bodyForExclusion);
      if (exclusionScan.rejected) {
        rejectedExclusion += 1;
        logger.info("compact-worker.chunk_rejected_exclusion", {
          jobId: job.id,
          theme,
          liveFraction: exclusionScan.liveFraction,
        });
        continue;
      }
      if (totalHard > 0) {
        // We don't drop on hard-redaction count (the text is already
        // sanitised) but we log it for telemetry. Heavy redaction may mean
        // a junk chunk — codex's review can decide whether to tighten.
        logger.info("compact-worker.chunk_redacted", {
          jobId: job.id,
          theme,
          hardCount: totalHard,
        });
      }

      // Exact-body embedding contract: pre-render outstanding items + body_md
      // + content_hash ONCE via `prepareMemoryRender`, embed the rendered
      // body, then persist via `insertPreparedMemory` so the bytes embedded
      // are the bytes stored. Without this split the repo would regenerate
      // fresh outstanding-item UUIDs/timestamps and the embedded body would
      // describe a body the DB no longer contains.
      if (claimLost) return;

      const prep = prepareMemoryRender({
        theme,
        happenedMd: r1.text,
        didMd: r2.text,
        triedMd: r3.text,
        outstandingTexts: rOuts.map((r) => r.text),
      });
      const embedded = await embedDocument(theme, prep.bodyMd);
      if (claimLost) return;

      const result = await insertPreparedMemory(
        {
          sessionId: job.sessionId,
          checkpointGeneration: job.checkpointGeneration,
          theme,
          themeSource: themeSource as "chunker" | "fallback",
          entities: entitiesR.values,
          protocols: protocolsR.values,
          errorClasses: errorClassesR.values,
          chains: chainsR.values,
          tasks: tasksR.values,
          happenedMd: r1.text,
          didMd: r2.text,
          triedMd: r3.text,
          outstandingTexts: rOuts.map((r) => r.text),
          sourceStartMessageId: job.sourceStartMessageId,
          sourceEndMessageId: job.sourceEndMessageId,
          languageCode: null,
          inferenceModel: process.env.AGENT_MODEL ?? null,
          embedding: embedded.embedding,
          embeddingModel: embedded.providerModel,
          embeddingDim: embedded.embedding.length,
        },
        prep,
      );
      if (result.inserted) inserted += 1;
    }

    if (claimLost) {
      logger.warn("compact-worker.exit_after_claim_lost", {
        jobId: job.id,
        sessionId: job.sessionId,
        workerId,
        chunksInserted: inserted,
      });
      return;
    }

    const inferenceModel = process.env.AGENT_MODEL ?? "unknown";
    const completedOk = await markCompleted(job.id, workerId, {
      chunksInserted: inserted,
      chunksRejectedByExclusion: rejectedExclusion,
      // PR2 never drops a chunk on redaction count alone — hard-redact
      // placeholders sanitize in-place. The audit column stays available
      // (schema-preserved) and reports 0 here; a redaction-threshold drop
      // policy can populate it in a follow-up PR.
      chunksRejectedByRedaction: 0,
      inferenceProvider: "openrouter",
      inferenceModel,
      costUsd: null, // cost telemetry deferred to PR3
    });
    if (completedOk) {
      logger.info("compact-worker.completed", {
        jobId: job.id,
        sessionId: job.sessionId,
        generation: job.checkpointGeneration,
        chunksInserted: inserted,
        chunksRejectedByExclusion: rejectedExclusion,
        chunksRejectedByRedaction: 0,
        durationMs: Date.now() - startMs,
        inferenceModel,
      });
    } else {
      // Owner-check failed — another worker recovered the claim mid-run or
      // the row was already terminated. Log so operator can spot the race;
      // no retry, the chunks are already in the DB so the work is durable.
      logger.warn("compact-worker.completion_claim_lost", {
        jobId: job.id,
        sessionId: job.sessionId,
        workerId,
      });
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    const backoff = TRACK2_RETRY_BACKOFF_BASE_MS * Math.max(1, job.attemptCount);
    const result = await markFailed(job.id, workerId, errorMsg, backoff);
    logger.warn("compact-worker.job_failed", {
      jobId: job.id,
      sessionId: job.sessionId,
      error: errorMsg,
      terminal: result.terminal,
      ok: result.ok,
    });
  } finally {
    clearInterval(heartbeatTimer);
  }
}

// ── Archived prefix loading ──────────────────────────────────────

/**
 * Apply `redact` to every element of a string array and aggregate the hard-
 * redact counts. Used for the structured columns the chunker emits
 * (entities / protocols / error_classes / chains / tasks). Anything that
 * tripped a hard-redact pattern (BIP39, private keys, JWT, API keys) is
 * replaced with a placeholder; mask patterns (addresses, tx hashes) are
 * masked. Both flavours are reflected in the returned counts.
 */
function redactStringArray(values: readonly string[]): {
  values: string[];
  hardCount: number;
  maskCount: number;
} {
  const out: string[] = [];
  let hardCount = 0;
  let maskCount = 0;
  for (const v of values) {
    const r: RedactionResult = redact(v);
    out.push(r.text);
    hardCount += r.hardRedactCount;
    maskCount += r.maskCount;
  }
  return { values: out, hardCount, maskCount };
}

async function loadArchivedPrefix(
  sessionId: string,
  startId: number | null,
  endId: number,
): Promise<Array<{ role: string; content: string; tool_call_id: string | null }>> {
  const startClause = startId === null ? "" : "AND id >= $3 ";
  const params: unknown[] = startId === null ? [sessionId, endId] : [sessionId, endId, startId];
  const rows = await query<{ role: string; content: string; tool_call_id: string | null }>(
    `SELECT role, content, tool_call_id
     FROM messages_archive
     WHERE session_id = $1 AND id <= $2 ${startClause}
     ORDER BY id ASC`,
    params,
  );
  return rows;
}

// ── Chunker LLM call ─────────────────────────────────────────────

const ChunkerOutputSchema = z.object({
  chunks: z.array(
    z.object({
      theme: z.string(),
      entities: z.array(z.string()).optional().default([]),
      protocols: z.array(z.string()).optional().default([]),
      error_classes: z.array(z.string()).optional().default([]),
      chains: z.array(z.string()).optional().default([]),
      tasks: z.array(z.string()).optional().default([]),
      happened_md: z.string().optional().default(""),
      did_md: z.string().optional().default(""),
      tried_md: z.string().optional().default(""),
      outstanding_items: z.array(z.string()).optional().default([]),
    }),
  ).max(MAX_CHUNKS_PER_COMPACT),
});

type ChunkerChunk = z.infer<typeof ChunkerOutputSchema>["chunks"][number];

async function callChunkerLLM(
  job: CompactJob,
  archivedPrefix: ReadonlyArray<{ role: string; content: string; tool_call_id: string | null }>,
): Promise<ChunkerChunk[]> {
  // Use the same env-driven OpenRouter constructor the in-turn provider
  // uses. Worker calls it on-demand so settings changes after restart
  // pick up the new model. If env is missing or the loader can't produce a
  // config, we THROW (not silently return []) so `processJob`'s catch leaves
  // the outbox row in `pending` with a backoff for retry. Returning an
  // empty array here would let `markCompleted(0 chunks)` silently lose
  // the job — codex flagged this as a permanent-loss bug.
  if (!process.env.OPENROUTER_API_KEY || !process.env.AGENT_MODEL) {
    logger.warn("compact-worker.provider_config_missing", { jobId: job.id });
    throw new Error("compact_worker_provider_config_missing");
  }
  const { OpenRouterProvider } = await import("@vex-agent/inference/openrouter.js");
  const provider = new OpenRouterProvider();
  const config = await provider.loadConfig();
  if (!config) {
    logger.warn("compact-worker.provider_config_load_failed", { jobId: job.id });
    throw new Error("compact_worker_provider_config_load_failed");
  }

  const transcript = archivedPrefix
    .map((m) => `[${m.role}${m.tool_call_id ? ` tool=${m.tool_call_id}` : ""}] ${m.content}`)
    .join("\n");

  const systemPrompt = [
    "You are a chunker for per-session agent memory. You receive a conversation prefix that was just archived.",
    "Produce 1-3 narrative chunks describing WHAT HAPPENED, WHAT THE AGENT DID, WHAT IT TRIED, and OUTSTANDING follow-ups.",
    "EXCLUDE live state: balances, prices, gas, intent IDs, transaction hashes, position values. These are queryable live and would just become stale.",
    "INCLUDE: decisions and rationale, observed patterns, lessons learned, user signals, mission state.",
    "Output strict JSON: { chunks: [ { theme, entities[], protocols[], error_classes[], chains[], tasks[], happened_md, did_md, tried_md, outstanding_items[] } ] }",
    "Theme: 3-8 lowercase underscore-separated tokens, specific (e.g. 'kyber_quote_timeout_pattern' NOT 'debug').",
    "If nothing worth chunking, return { chunks: [] }.",
  ].join(" ");
  const userPrompt = [
    `Agent's own summary of the conversation:\n${job.agentSummary}`,
    job.preserveMd ? `Preserve hints:\n${job.preserveMd}` : "",
    job.threadThemesHints.length > 0
      ? `Theme hints (advisory, validate before using):\n${job.threadThemesHints.join("\n")}`
      : "",
    `Archived conversation prefix (session=${job.sessionId}, generation=${job.checkpointGeneration}):\n${transcript}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const response = await Promise.race([
    provider.chatCompletionSimple(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      config,
    ),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("chunker_timeout")), TRACK2_TIMEOUT_MS),
    ),
  ]);

  const text = response.content?.trim() ?? "";
  const jsonStart = text.indexOf("{");
  const jsonEnd = text.lastIndexOf("}");
  if (jsonStart < 0 || jsonEnd < jsonStart) {
    throw new Error(`chunker_malformed_json: missing braces in response (len=${text.length})`);
  }
  const parsed = JSON.parse(text.slice(jsonStart, jsonEnd + 1));
  const validated = ChunkerOutputSchema.safeParse(parsed);
  if (!validated.success) {
    throw new Error(`chunker_schema_invalid: ${validated.error.message}`);
  }
  return validated.data.chunks;
}
