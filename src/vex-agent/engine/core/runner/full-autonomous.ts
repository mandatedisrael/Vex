/**
 * Engine runner — standalone full-autonomous turn entrypoint (PR-10).
 *
 * Shape diverges from chat/mission:
 *   - `sessionKind = "full_autonomous"` and no mission attached.
 *   - `loopMode = "full"` so `loop_defer` is visible in the toolset.
 *   - `maxIterations` follows `DEFAULT_LOOP_CONFIG` (50) as a per-slice
 *     guard. Slice exhaustion schedules a wake continuation instead of
 *     terminating the session.
 *
 * Resume semantics: `resumeFullAutonomousSession(sessionId)` is what PR-7's
 * wake executor invokes for `kind='full_autonomous'` rows. It re-reads
 * hydrated state, rebuilds the tool surface under the lagging context band,
 * and re-enters the turn loop with NO new user input (the wake banner is
 * already persisted by the executor).
 */

import type { TurnResult } from "../../types.js";
import { hydrateEngineSession } from "../hydrate.js";
import type { TurnLoopConfig } from "../turn-loop.js";
import { runTurnLoop } from "../turn-loop.js";
import { getOpenAITools } from "@vex-agent/tools/registry.js";
import { computeBand, type ContextUsageBand } from "../context-band.js";
import { resolveProvider } from "@vex-agent/inference/registry.js";
import * as messagesRepo from "@vex-agent/db/repos/messages.js";
import * as episodesRepo from "@vex-agent/db/repos/session-episodes.js";
import * as fullAutonomousRunsRepo from "@vex-agent/db/repos/full-autonomous-runs.js";
import { refreshBlobTtlForRecentMessages } from "../../wake/blob-refresh.js";
import type { FullAutonomousContext } from "../../prompts/full-autonomous.js";
import logger from "@utils/logger.js";
import { toToolDefinitions, DEFAULT_LOOP_CONFIG } from "./shared.js";
import {
  isContinuableRuntimeStop,
  scheduleRuntimeContinuation,
} from "./runtime-continuation.js";

const OPEN_LOOPS_CAP = 10;
const RECENT_EPISODES_CAP = 3;
const LOOP_DETAIL_MAX_CHARS = 200;

export async function processFullAutonomousTurn(
  sessionId: string,
  userInput: string,
): Promise<TurnResult> {
  logger.info("engine.full_autonomous.turn", { sessionId });

  const provider = await resolveProvider();
  if (!provider) throw new Error("No inference provider available");

  const config = await provider.loadConfig();
  if (!config) throw new Error("No inference config available");

  await messagesRepo.addMessage(
    sessionId,
    { role: "user", content: userInput, timestamp: new Date().toISOString() },
    { source: "user", messageType: "chat", visibility: "user" },
  );

  const existing = await fullAutonomousRunsRepo.getActiveRunBySession(sessionId);
  if (existing) {
    throw new Error(
      `Full-autonomous run ${existing.id} is already active (${existing.status}); queue an operator instruction instead.`,
    );
  }

  const runId = `farun-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await fullAutonomousRunsRepo.createRun(runId, sessionId);
  return runFullAutonomousLoop(runId, provider, config);
}

export async function resumeFullAutonomousSession(sessionId: string): Promise<TurnResult> {
  logger.info("engine.full_autonomous.resume", { sessionId });

  const provider = await resolveProvider();
  if (!provider) throw new Error("No inference provider available");

  const config = await provider.loadConfig();
  if (!config) throw new Error("No inference config available");

  const run = await fullAutonomousRunsRepo.getActiveRunBySession(sessionId);
  if (!run) {
    throw new Error(`No active full-autonomous run for session ${sessionId}`);
  }
  if (run.status !== "running") {
    throw new Error(`Full-autonomous run ${run.id} is ${run.status}; cannot resume without a CAS claim.`);
  }

  return runFullAutonomousLoop(run.id, provider, config);
}

// ── Shared loop entry ──────────────────────────────────────────────

async function runFullAutonomousLoop(
  runId: string,
  provider: Awaited<ReturnType<typeof resolveProvider>>,
  config: NonNullable<Awaited<ReturnType<NonNullable<Awaited<ReturnType<typeof resolveProvider>>>["loadConfig"]>>>,
): Promise<TurnResult> {
  if (!provider) throw new Error("No inference provider available");

  const run = await fullAutonomousRunsRepo.getRun(runId);
  if (!run) throw new Error(`Full-autonomous run ${runId} not found`);
  const sessionId = run.sessionId;

  // Refresh tool_output_blob TTLs up front so overflow pointers in the
  // session's tail are still resolvable after a long wait. See the
  // mirror call in `resumeMissionRun` for rationale. Non-fatal on error.
  await refreshBlobTtlForRecentMessages(sessionId);

  const hydrated = await hydrateEngineSession(sessionId);
  if (!hydrated) throw new Error(`Session ${sessionId} not found`);

  // Defense-in-depth — caller was supposed to ensure the session is
  // full_autonomous before reaching this runner. Guard so we never silently
  // upgrade a chat session.
  if (hydrated.context.sessionKind !== "full_autonomous") {
    throw new Error(
      `processFullAutonomousTurn called on non-full_autonomous session (kind=${hydrated.context.sessionKind})`,
    );
  }

  const buildToolsForBand = (contextUsageBand: ContextUsageBand) => toToolDefinitions(getOpenAITools({
    chatMode: "full",
    role: "parent",
    sessionKind: "full_autonomous",
    missionRunActive: false,
    contextUsageBand,
  }));
  const resumeBand = computeBand(hydrated.tokenCount, config.contextLimit);
  const tools = buildToolsForBand(resumeBand);

  const loopConfig: TurnLoopConfig = {
    ...DEFAULT_LOOP_CONFIG,
    contextLimit: config.contextLimit,
    buildToolsForBand,
  };

  const fullAutonomousContext = await buildFullAutonomousContext(sessionId);

  try {
    const result = await runTurnLoop(
      {
        ...hydrated.context,
        sessionKind: "full_autonomous",
        loopMode: "full",
        fullAutonomousRunId: runId,
      },
      hydrated.messages,
      hydrated.summary,
      hydrated.tokenCount,
      provider,
      config,
      tools,
      loopConfig,
      { fullAutonomousContext },
    );

    if (result.stopReason === "waiting_for_wake") {
      await fullAutonomousRunsRepo.updateStatus(
        runId,
        "paused_wake",
        "waiting_for_wake",
        result.stopPayload,
      );
    } else if (isContinuableRuntimeStop(result.stopReason)) {
      await scheduleRuntimeContinuation({
        sessionId,
        missionRunId: null,
        kind: "full_autonomous",
        trigger: result.stopReason,
      });
      await fullAutonomousRunsRepo.updateStatus(runId, "paused_wake", "waiting_for_wake", {
        summary: "Runtime slice yielded and scheduled continuation.",
        evidence: { trigger: result.stopReason },
      });
    } else if (result.stopReason) {
      await fullAutonomousRunsRepo.updateStatus(
        runId,
        result.stopReason === "user_stopped" ? "stopped" : "failed",
        result.stopReason,
        result.stopPayload,
      );
    }

    return {
      text: result.text,
      toolCallsMade: result.toolCallsMade,
      pendingApprovals: result.pendingApprovals,
      stopReason: result.stopReason,
      missionStatus: null,
    };
  } catch (err: unknown) {
    await fullAutonomousRunsRepo.updateStatus(runId, "paused_error", "system_error", {
      summary: err instanceof Error ? err.message : String(err),
      evidence: { error: err instanceof Error ? err.message : String(err) },
    });
    throw err;
  }
}

/**
 * Build the `FullAutonomousContext` from recent session episodes. Shares the
 * same data shape `resolveRecallSeed` in `turn.ts` extracts for seed fallback
 * (`recentEpisodeTitles`, `openLoops`) — we just render it into the prompt
 * instead of using it as a recall seed. Failure is non-fatal: returns an empty
 * context so the prompt layer skips the "Where you left off" section.
 */
async function buildFullAutonomousContext(sessionId: string): Promise<FullAutonomousContext> {
  try {
    const recent = await episodesRepo.listRecentBySession(sessionId, RECENT_EPISODES_CAP);
    const recentEpisodeTitles = recent
      .map((ep) => ep.title.trim())
      .filter((t) => t.length > 0);

    const loops = new Set<string>();
    for (const ep of recent) {
      for (const [key, value] of Object.entries(ep.openLoops ?? {})) {
        const detail = typeof value === "string" ? value : JSON.stringify(value);
        loops.add(`${key}: ${detail}`.slice(0, LOOP_DETAIL_MAX_CHARS));
        if (loops.size >= OPEN_LOOPS_CAP) break;
      }
      if (loops.size >= OPEN_LOOPS_CAP) break;
    }

    return {
      recentEpisodeTitles,
      openLoops: Array.from(loops),
    };
  } catch (err) {
    logger.warn("engine.full_autonomous.context_fetch_failed", {
      sessionId,
      error: err instanceof Error ? err.message : String(err),
    });
    return { recentEpisodeTitles: [], openLoops: [] };
  }
}
