/**
 * Session manager — lifecycle management with auto-summarization.
 *
 * Used by both Telegram and GUI to create new sessions with context handoff.
 * When a new session starts, the previous one is summarized and key insights
 * are extracted into memory.
 */

import { createSession } from "./engine.js";
import { hydrateSession } from "./session-hydrate.js";
import { inferNonStreaming, loadInferenceConfig } from "./inference.js";
import * as sessionsRepo from "./db/repos/sessions.js";
import * as messagesRepo from "./db/repos/messages.js";
import * as memoryRepo from "./db/repos/memory.js";
import { getCompactionSystemPrompt, buildCompactionPrompt } from "./prompts/compaction.js";
import { parseCompactionResult } from "./context.js";
import type { ConversationSession, Message, SessionScope } from "./types.js";
import logger from "../utils/logger.js";

interface NewSessionResult {
  session: ConversationSession;
  previousSummary: string | null;
}

/**
 * Create a new session with auto-summarization of the previous one.
 * Returns the new session and the summary (if any) for display.
 */
export async function createNewSession(
  previousSessionId: string | null,
  scope: SessionScope = "chat",
): Promise<NewSessionResult | null> {
  let previousSummary: string | null = null;

  // Summarize previous session if it exists and has messages
  if (previousSessionId) {
    try {
      previousSummary = await summarizeSession(previousSessionId);
    } catch (err) {
      logger.warn("session-manager.summarize_failed", {
        sessionId: previousSessionId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Create new session
  const session = createSession();
  if (!session) return null;

  await sessionsRepo.createSession(session.id);
  await sessionsRepo.setScope(session.id, scope);

  // Inject previous summary as context
  if (previousSummary) {
    const contextMsg: Message = {
      role: "system",
      content: `# Previous Session Summary\n\n${previousSummary}`,
      timestamp: new Date().toISOString(),
    };
    session.messages.push(contextMsg);
    await messagesRepo.addMessage(session.id, contextMsg);
  }

  logger.info("session-manager.created", { sessionId: session.id, scope, hasSummary: !!previousSummary });
  return { session, previousSummary };
}

/**
 * Summarize a session: extract summary + key insights.
 * Marks the session as ended. Saves insights to memory.
 */
async function summarizeSession(sessionId: string): Promise<string | null> {
  const existingSession = await sessionsRepo.getSession(sessionId);
  if (!existingSession || existingSession.compacted) return existingSession?.summary ?? null;
  if (existingSession.message_count < 2) return null;

  const hydrated = await hydrateSession(sessionId);
  if (!hydrated || hydrated.messages.length < 2) return null;

  const config = await loadInferenceConfig();
  if (!config) return null;

  const compactionMessages: Message[] = [
    { role: "system", content: getCompactionSystemPrompt(), timestamp: new Date().toISOString() },
    { role: "user", content: buildCompactionPrompt(hydrated.messages, [...hydrated.loadedKnowledge.keys()]), timestamp: new Date().toISOString() },
  ];

  const result = await inferNonStreaming(config, compactionMessages);
  const { summary, insights } = parseCompactionResult(result.content);

  // Save insights to memory
  if (insights) {
    await memoryRepo.appendMemory(insights, "session_end", "session_end");
  }

  // Mark session as ended
  await sessionsRepo.compactSession(sessionId, summary);

  logger.info("session-manager.summarized", { sessionId, summaryLength: summary.length });
  return summary;
}

/**
 * Build an overnight digest from DB data (no inference cost).
 */
export async function buildOvernightDigest(sessionId: string): Promise<string | null> {
  try {
    const session = await sessionsRepo.getSession(sessionId);
    if (!session) return null;

    const { query } = await import("./db/client.js");

    // Get trade count + PnL
    const trades = await query<Record<string, unknown>>(
      "SELECT COUNT(*) as count, COALESCE(SUM((pnl->>'amountUsd')::numeric), 0) as pnl FROM trades WHERE timestamp >= $1",
      [session.started_at],
    );

    // Get loop cycle count
    const cycles = await query<Record<string, unknown>>(
      "SELECT COUNT(*) as count FROM loop_cycles WHERE started_at >= $1",
      [session.started_at],
    );

    // Get subagent count
    const subagents = await query<Record<string, unknown>>(
      "SELECT COUNT(*) as count FROM subagents WHERE started_at >= $1",
      [session.started_at],
    );

    // Get cost spent
    const usage = await query<Record<string, unknown>>(
      "SELECT COALESCE(SUM(cost), 0) as total FROM usage_log WHERE session_id = $1",
      [sessionId],
    );

    const startedAt = new Date(session.started_at);
    const durationMs = Date.now() - startedAt.getTime();
    const hours = Math.floor(durationMs / 3_600_000);
    const minutes = Math.floor((durationMs % 3_600_000) / 60_000);

    const tradeCount = Number(trades[0]?.count ?? 0);
    const pnl = Number(trades[0]?.pnl ?? 0);
    const cycleCount = Number(cycles[0]?.count ?? 0);
    const subagentCount = Number(subagents[0]?.count ?? 0);
    const ogSpent = Number(usage[0]?.total ?? 0);

    return [
      "--- Session Report ---",
      `Duration: ${hours}h ${minutes}m (${cycleCount} cycles)`,
      `Trades: ${tradeCount}`,
      `PnL: ${pnl >= 0 ? "+" : ""}$${pnl.toFixed(2)}`,
      `Subagents spawned: ${subagentCount}`,
      `0G spent: ${ogSpent.toFixed(4)}`,
    ].join("\n");
  } catch (err) {
    logger.warn("session-manager.digest_failed", { error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}
