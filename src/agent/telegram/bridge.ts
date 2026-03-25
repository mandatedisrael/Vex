/**
 * Telegram bridge — wires incoming Telegram messages to the agent engine.
 *
 * Creates a delivery-agnostic `emit` callback (same type as engine.ts EventEmitter)
 * that forwards AgentEvents to Telegram API calls. This is the same pattern
 * as handlers/chat.ts (SSE) and the scheduler (text accumulator).
 *
 * Per-session mutex prevents race conditions when GUI and Telegram
 * hit the same session concurrently.
 */

import type { Bot } from "grammy";
import { processMessage, createSession } from "../engine.js";
import { hydrateSession } from "../session-hydrate.js";
import * as telegramRepo from "../db/repos/telegram.js";
import * as sessionsRepo from "../db/repos/sessions.js";
import {
  formatTextForTelegram, formatToolStart,
  formatError, chunkMessage,
  formatSubagentSpawned, formatSubagentCompleted,
  formatLoopPhase, formatTopupEvent,
} from "./formatter.js";
import { sendApprovalRequest } from "./approval-handler.js";
import { withSessionLock } from "./session-lock.js";
import type { TelegramConfig } from "./types.js";
import type { AgentEvent } from "../types.js";
import logger from "../../utils/logger.js";

// ── Main message handler ─────────────────────────────────────────────

export async function handleIncomingMessage(
  chatId: number,
  text: string,
  bot: Bot,
  config: TelegramConfig,
  username?: string,
  firstName?: string,
): Promise<void> {
  // 1. Look up or create session
  const existing = await telegramRepo.getSessionForChat(chatId);
  let session = existing ? await hydrateSession(existing.sessionId) : null;
  let isNewSession = false;

  if (!session) {
    session = createSession();
    if (!session) {
      await bot.api.sendMessage(chatId, formatError("Agent not ready \u2014 inference provider not configured."));
      return;
    }
    isNewSession = true;
  }

  // 2. Update session mapping and scope
  await telegramRepo.upsertSession(chatId, session.id, username, firstName);
  if (isNewSession) {
    // Ensure DB row exists before setScope (processMessage also creates it, but setScope needs it first)
    await sessionsRepo.createSession(session.id);
    await sessionsRepo.setScope(session.id, "telegram");
  }

  // 3. Execute with session lock (serializes concurrent messages)
  await withSessionLock(session.id, async () => {
    let textBuffer = "";
    let typingInterval: ReturnType<typeof setInterval> | null = null;

    // Keep "typing" indicator alive while processing
    const startTyping = () => {
      if (typingInterval) return;
      typingInterval = setInterval(() => {
        bot.api.sendChatAction(chatId, "typing").catch(() => {});
      }, 4000);
    };
    const stopTyping = () => {
      if (typingInterval) { clearInterval(typingInterval); typingInterval = null; }
    };

    // 4. Create custom emit — same type as engine.ts EventEmitter
    const emit = (event: AgentEvent) => {
      // Fire-and-forget: queue event handling but don't block the engine
      handleEvent(event, chatId, bot, config, textBuffer, startTyping).then(result => {
        if (result !== undefined) textBuffer = result;
      }).catch(err => {
        logger.warn("telegram.emit.failed", { type: event.type, error: err instanceof Error ? err.message : String(err) });
      });
    };

    try {
      startTyping();
      await bot.api.sendChatAction(chatId, "typing");

      // 5. Process message — same function as GUI
      await processMessage(session!, text, emit, config.loopMode);

      // 6. Flush remaining text buffer with HTML formatting
      stopTyping();
      if (textBuffer.trim()) {
        const { html, plain } = formatTextForTelegram(textBuffer);
        const chunks = chunkMessage(html);
        for (const chunk of chunks) {
          try {
            await bot.api.sendMessage(chatId, chunk, { parse_mode: "HTML" });
          } catch (htmlErr) {
            logger.debug("telegram.html_parse.fallback", { chatId, error: htmlErr instanceof Error ? htmlErr.message : String(htmlErr) });
            const plainChunks = chunkMessage(plain);
            for (const pc of plainChunks) {
              await bot.api.sendMessage(chatId, pc);
            }
            break;
          }
        }
      }
    } catch (err) {
      stopTyping();
      const msg = err instanceof Error ? err.message : String(err);
      logger.error("telegram.bridge.process_failed", { chatId, error: msg });
      await bot.api.sendMessage(chatId, formatError(msg)).catch(() => {});
    }
  });
}

/** Handle a single AgentEvent. Returns updated text buffer (if text_delta), or undefined. */
async function handleEvent(
  event: AgentEvent,
  chatId: number,
  bot: Bot,
  config: TelegramConfig,
  textBuffer: string,
  startTyping: () => void,
): Promise<string | undefined> {
  switch (event.type) {
    case "status": {
      const statusType = event.data.type as string;
      if (statusType === "thinking") {
        startTyping();
      }
      // Handle session compaction — update mapping
      if (statusType === "session" && event.data.sessionId) {
        await telegramRepo.updateSessionId(chatId, event.data.sessionId as string);
      }
      return undefined;
    }

    case "text_delta":
      return textBuffer + String(event.data.text ?? "");

    case "tool_start": {
      // Compact tool notification: emoji + name only (no args, no output)
      const msg = formatToolStart(String(event.data.command ?? ""));
      await bot.api.sendMessage(chatId, msg);
      startTyping();
      return undefined;
    }

    case "tool_result": {
      // Don't send tool results to Telegram — the final text response covers it.
      // Just keep typing indicator active.
      startTyping();
      return undefined;
    }

    case "approval_required":
      await sendApprovalRequest(bot, chatId, event.data);
      return undefined;

    case "error":
      await bot.api.sendMessage(chatId, formatError(String(event.data.message ?? "Unknown error")));
      return undefined;

    case "subagent_spawned":
      await bot.api.sendMessage(chatId, formatSubagentSpawned(
        String(event.data.name ?? ""),
        String(event.data.task ?? ""),
      ));
      return undefined;

    case "subagent_completed":
      await bot.api.sendMessage(chatId, formatSubagentCompleted(
        String(event.data.name ?? ""),
        String(event.data.status ?? "completed"),
        typeof event.data.durationMs === "number" ? event.data.durationMs : undefined,
      ));
      return undefined;

    case "loop_phase":
      await bot.api.sendMessage(chatId, formatLoopPhase(
        String(event.data.phase ?? ""),
        Number(event.data.cycleNumber ?? 0),
      ));
      return undefined;

    case "topup_event":
      await bot.api.sendMessage(chatId, formatTopupEvent(event.data));
      return undefined;

    case "done":
      // Text flush handled by the caller after processMessage completes
      return undefined;

    default:
      return undefined;
  }
}

/** Create a fresh session for a Telegram chat (e.g. /new command). */
export async function resetSession(chatId: number): Promise<string | null> {
  const session = createSession();
  if (!session) return null;
  await sessionsRepo.createSession(session.id);
  await telegramRepo.upsertSession(chatId, session.id);
  await sessionsRepo.setScope(session.id, "telegram");
  return session.id;
}
