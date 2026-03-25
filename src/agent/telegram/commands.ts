/**
 * Telegram command handlers — extracted from poller for Team Standards compliance.
 *
 * Each command is a standalone function registered in poller.ts.
 */

import type { Bot } from "grammy";
import type { TelegramConfig } from "./types.js";
import * as telegramRepo from "../db/repos/telegram.js";
import * as loopRepo from "../db/repos/loop.js";
import { createNewSession, buildOvernightDigest } from "../session-manager.js";
import { startLoopEngine, stopLoopEngine } from "../scheduler.js";
import { getSubagentStatus } from "../subagent.js";
import { getBillingState } from "../billing.js";
import { getInferenceConfig } from "../engine.js";
import { stopEchoLoop } from "../echo-loop.js";
import {
  MIN_LOOP_INTERVAL_MS,
  MAX_LOOP_INTERVAL_MS,
  AGENT_DEFAULT_PORT,
} from "../constants.js";
import logger from "../../utils/logger.js";

function getAgentPort(): number {
  return Number(process.env.AGENT_PORT) || AGENT_DEFAULT_PORT;
}

/** Register all Telegram commands on the bot. */
export function registerCommands(bot: Bot, config: TelegramConfig, botUsername: string | null): void {
  const isAuthorized = (chatId: number) => config.authorizedChatIds.includes(chatId);

  // ── /help ──────────────────────────────────────────────────────────
  bot.command("help", async (ctx) => {
    if (!isAuthorized(ctx.chat.id)) return;
    await ctx.reply(
      "EchoClaw Agent Commands:\n\n" +
      "Session:\n" +
      "/session — New session (summarizes previous)\n" +
      "/summary — Current session report\n\n" +
      "Mode:\n" +
      "/mode — Show current mode\n" +
      "/mode manual — Manual (respond-only)\n" +
      "/mode restricted — Autonomous (trades need approval)\n" +
      "/mode full — Full autonomy\n\n" +
      "Loop:\n" +
      "/loop on [30s|1m|2m|3m|5m] — Start Echo Loop\n" +
      "/loop off — Stop Echo Loop\n" +
      "/loop status — Loop state and cycle info\n" +
      "/txs auto|manual — Toggle trade autonomy\n" +
      "/stop — Emergency stop (loop + subagents)\n\n" +
      "Info:\n" +
      "/agents — Active subagents\n" +
      "/balance — Compute balance\n" +
      "/config — Config + version + uptime\n" +
      "/status — Agent status\n\n" +
      "Settings:\n" +
      "/config context <n> — Set context limit\n" +
      "/tavily <key> — Set Tavily API key\n" +
      "/soul — View soul text\n" +
      "/soul set <text> — Update soul\n\n" +
      "Ops:\n" +
      "/backup — Create backup\n" +
      "/backups — List backups",
    );
  });

  // ── /session ───────────────────────────────────────────────────────
  bot.command("session", async (ctx) => {
    if (!isAuthorized(ctx.chat.id)) return;

    const existing = await telegramRepo.getSessionForChat(ctx.chat.id);

    // Build digest before creating new session
    if (existing?.sessionId) {
      const digest = await buildOvernightDigest(existing.sessionId);
      if (digest) {
        await ctx.reply(digest);
      }
    }

    const result = await createNewSession(existing?.sessionId ?? null, "telegram");
    if (!result) {
      await ctx.reply("Agent not ready — cannot create session.");
      return;
    }

    await telegramRepo.upsertSession(ctx.chat.id, result.session.id, ctx.from?.username, ctx.from?.first_name);
    await ctx.reply(`New session started.${result.previousSummary ? " Previous session summarized." : ""}`);
  });

  // ── /loop ──────────────────────────────────────────────────────────
  bot.command("loop", async (ctx) => {
    if (!isAuthorized(ctx.chat.id)) return;
    const args = (ctx.match ?? "").trim().split(/\s+/);
    const subcommand = args[0]?.toLowerCase();

    if (subcommand === "on") {
      const intervalStr = args[1] || "5m";
      const intervalMs = parseInterval(intervalStr);
      if (!intervalMs) {
        await ctx.reply("Invalid interval. Use: 30s, 1m, 2m, 3m, 5m");
        return;
      }
      const state = await loopRepo.getLoopState();
      const mode = state.mode || "restricted";
      await startLoopEngine(mode, intervalMs);
      await ctx.reply(`Echo Loop ON (${intervalStr}, ${mode} mode)`);
    } else if (subcommand === "off") {
      await stopLoopEngine();
      await ctx.reply("Echo Loop OFF");
    } else if (subcommand === "status") {
      const state = await loopRepo.getLoopState();
      const uptime = state.startedAt
        ? formatDuration(Date.now() - new Date(state.startedAt).getTime())
        : "-";
      await ctx.reply(
        `Loop: ${state.active ? "ON" : "OFF"}\n` +
        `Mode: ${state.mode}\n` +
        `Phase: ${state.currentPhase}\n` +
        `Interval: ${state.intervalMs / 1000}s\n` +
        `Cycles: ${state.cycleCount}\n` +
        `Uptime: ${uptime}`,
      );
    } else {
      await ctx.reply("Usage: /loop on [30s|1m|2m|3m|5m] | /loop off | /loop status");
    }
  });

  // ── /txs ───────────────────────────────────────────────────────────
  bot.command("txs", async (ctx) => {
    if (!isAuthorized(ctx.chat.id)) return;
    const mode = (ctx.match ?? "").trim().toLowerCase();

    if (mode === "auto") {
      await loopRepo.startLoop("full", (await loopRepo.getLoopState()).intervalMs);
      await ctx.reply("Txs: AUTO — agent trades autonomously");
    } else if (mode === "manual") {
      await loopRepo.startLoop("restricted", (await loopRepo.getLoopState()).intervalMs);
      await ctx.reply("Txs: MANUAL — trades need approval");
    } else {
      const state = await loopRepo.getLoopState();
      await ctx.reply(`Current: ${state.mode === "full" ? "AUTO" : "MANUAL"}\nUsage: /txs auto | /txs manual`);
    }
  });

  // ── /mode ────────────────────────────────────────────────────────────
  bot.command("mode", async (ctx) => {
    if (!isAuthorized(ctx.chat.id)) return;
    const arg = (ctx.match ?? "").trim().toLowerCase();

    const modeDescriptions: Record<string, { label: string; description: string }> = {
      off: { label: "MANUAL", description: "Agent responds only when you message. No proactive actions." },
      restricted: { label: "RESTRICTED", description: "Agent acts proactively. Trades and transfers need your approval." },
      full: { label: "FULL AUTO", description: "Full autonomy. All actions auto-approved." },
    };

    if (arg === "manual" || arg === "off") {
      await telegramRepo.updateLoopMode("off");
      await ctx.reply("Mode changed: MANUAL\nAgent responds only when you message. No proactive actions.\nMutations require your approval.");
    } else if (arg === "restricted") {
      await telegramRepo.updateLoopMode("restricted");
      await ctx.reply("Mode changed: RESTRICTED\nAgent acts proactively. Trades and transfers need your approval.");
    } else if (arg === "full") {
      await telegramRepo.updateLoopMode("full");
      await ctx.reply("Mode changed: FULL AUTO\nFull autonomy. All actions auto-approved.");
    } else {
      const current = config.loopMode ?? "off";
      const desc = modeDescriptions[current] ?? modeDescriptions.off;
      await ctx.reply(
        `Current mode: ${desc.label}\n${desc.description}\n\nUse /mode <manual|restricted|full> to change.`,
      );
    }
  });

  // ── /stop (emergency) ──────────────────────────────────────────────
  bot.command("stop", async (ctx) => {
    if (!isAuthorized(ctx.chat.id)) return;

    await stopEchoLoop();

    // Stop all active subagents
    const active = await getSubagentStatus();
    const running = active.filter((a) => a.status === "running");
    for (const agent of running) {
      const { stopSubagent } = await import("../subagent.js");
      await stopSubagent(agent.id);
    }

    await ctx.reply(`STOPPED. Loop paused. ${running.length} subagent(s) cancelled.`);
    logger.warn("telegram.emergency_stop", { chatId: ctx.chat.id, subagentsStopped: running.length });
  });

  // ── /agents ────────────────────────────────────────────────────────
  bot.command("agents", async (ctx) => {
    if (!isAuthorized(ctx.chat.id)) return;
    const agents = await getSubagentStatus();

    if (agents.length === 0) {
      await ctx.reply("No active or recent subagents.");
      return;
    }

    const lines = agents.map((a) => {
      const dur = a.endedAt
        ? formatDuration(new Date(a.endedAt).getTime() - new Date(a.startedAt).getTime())
        : formatDuration(Date.now() - new Date(a.startedAt).getTime());
      return `[${a.name}] ${a.status} (${dur}) — ${a.task.slice(0, 60)}`;
    });
    await ctx.reply(lines.join("\n"));
  });

  // ── /balance ───────────────────────────────────────────────────────
  bot.command("balance", async (ctx) => {
    if (!isAuthorized(ctx.chat.id)) return;
    const inferenceConfig = getInferenceConfig();
    if (!inferenceConfig) {
      await ctx.reply("Agent not ready — no inference config.");
      return;
    }
    const billing = await getBillingState(inferenceConfig);
    await ctx.reply(
      `Compute Balance:\n` +
      `Provider balance: ${billing.providerBalance.toFixed(4)} ${billing.providerCurrency}\n` +
      `Low balance: ${billing.isLowBalance ? "YES" : "no"}\n` +
      `Est. requests remaining: ${billing.estimatedRequestsRemaining}\n` +
      `Session burn: ${billing.sessionBurn.toFixed(4)} ${billing.providerCurrency}`,
    );
  });

  // ── /summary ───────────────────────────────────────────────────────
  bot.command("summary", async (ctx) => {
    if (!isAuthorized(ctx.chat.id)) return;
    const existing = await telegramRepo.getSessionForChat(ctx.chat.id);
    if (!existing?.sessionId) {
      await ctx.reply("No active session.");
      return;
    }
    const digest = await buildOvernightDigest(existing.sessionId);
    await ctx.reply(digest ?? "No data for current session.");
  });

  // ── /tavily ────────────────────────────────────────────────────────
  bot.command("tavily", async (ctx) => {
    if (!isAuthorized(ctx.chat.id)) return;
    const key = (ctx.match ?? "").trim();
    if (!key) {
      await ctx.reply("Usage: /tavily YOUR_API_KEY\n\nNote: API key will be visible in this chat history. For secure setup, use the Agent GUI Settings tab instead.");
      return;
    }
    if (!key.startsWith("tvly-") || key.length < 20) {
      await ctx.reply("Invalid key format. Must start with tvly- and be at least 20 characters.");
      return;
    }
    try {
      await fetch(`http://127.0.0.1:${getAgentPort()}/api/agent/config`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tavilyApiKey: key }),
      });
      await ctx.reply("Tavily API key configured. Consider deleting your message containing the key for security.");
    } catch { await ctx.reply("Error setting Tavily key"); }
    logger.info("telegram.tavily_key_set", { chatId: ctx.chat.id });
  });

  // ── /config ────────────────────────────────────────────────────────
  bot.command("config", async (ctx) => {
    if (!isAuthorized(ctx.chat.id)) return;
    const args = (ctx.match ?? "").trim().split(/\s+/);

    if (args[0] === "context" && args[1]) {
      const limit = Number(args[1]);
      if (Number.isNaN(limit) || limit < 10_000 || limit > 200_000) {
        await ctx.reply("Invalid. Range: 10000-200000");
        return;
      }
      try {
        const res = await fetch(`http://127.0.0.1:${getAgentPort()}/api/agent/config`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contextLimit: limit }),
        });
        if (res.ok) await ctx.reply(`Context limit set to ${limit.toLocaleString()} tokens`);
        else await ctx.reply("Failed to update context limit");
      } catch { await ctx.reply("Error updating config"); }
      return;
    }

    // Show current config
    try {
      const res = await fetch(`http://127.0.0.1:${getAgentPort()}/api/agent/config`);
      const cfg = await res.json() as Record<string, unknown>;
      await ctx.reply(
        `Config:\n` +
        `Context limit: ${Number(cfg.contextLimit ?? 0).toLocaleString()} tokens\n` +
        `Compaction at: ${Math.floor(Number(cfg.contextLimit ?? 0) * Number(cfg.compactionThreshold ?? 0.75)).toLocaleString()}\n` +
        `Tavily: ${cfg.tavilyConfigured ? "configured" : "not set"}\n` +
        `Version: ${cfg.version}\n` +
        `Uptime: ${formatDuration(Number(cfg.uptime ?? 0) * 1000)}`,
      );
    } catch { await ctx.reply("Error reading config"); }
  });

  // ── /soul ──────────────────────────────────────────────────────────
  bot.command("soul", async (ctx) => {
    if (!isAuthorized(ctx.chat.id)) return;
    const args = (ctx.match ?? "").trim();

    if (args.startsWith("set ")) {
      const content = args.slice(4).trim();
      if (!content) { await ctx.reply("Usage: /soul set <text>"); return; }
      try {
        await fetch(`http://127.0.0.1:${getAgentPort()}/api/agent/memory/soul`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content }),
        });
        await ctx.reply("Soul updated.");
      } catch { await ctx.reply("Error updating soul"); }
      return;
    }

    // Show current soul
    try {
      const res = await fetch(`http://127.0.0.1:${getAgentPort()}/api/agent/memory/soul`);
      const data = await res.json() as Record<string, unknown>;
      const content = String(data.content ?? "(no soul set)");
      const preview = content.length > 500 ? content.slice(0, 497) + "..." : content;
      await ctx.reply(preview);
    } catch { await ctx.reply("Error reading soul"); }
  });

  // ── /backup ────────────────────────────────────────────────────────
  bot.command("backup", async (ctx) => {
    if (!isAuthorized(ctx.chat.id)) return;
    await ctx.reply("Creating backup...");
    try {
      const res = await fetch(`http://127.0.0.1:${getAgentPort()}/api/agent/backup`, { method: "POST" });
      const data = await res.json() as Record<string, unknown>;
      if (data.rootHash) {
        await ctx.reply(`Backup created: ${data.rootHash}`);
      } else {
        await ctx.reply(`Backup result: ${JSON.stringify(data)}`);
      }
    } catch (err) { await ctx.reply(`Backup failed: ${err instanceof Error ? err.message : String(err)}`); }
  });

  // ── /backups ───────────────────────────────────────────────────────
  bot.command("backups", async (ctx) => {
    if (!isAuthorized(ctx.chat.id)) return;
    try {
      const res = await fetch(`http://127.0.0.1:${getAgentPort()}/api/agent/backups`);
      const data = await res.json() as { backups?: Array<Record<string, unknown>>; count?: number };
      if (!data.backups?.length) { await ctx.reply("No backups found."); return; }
      const lines = data.backups.slice(0, 5).map((b, i) =>
        `${i + 1}. ${String(b.root_hash ?? "").slice(0, 16)}... (${b.file_count} files, ${b.trigger})`,
      );
      await ctx.reply(`Recent backups:\n${lines.join("\n")}`);
    } catch { await ctx.reply("Error listing backups"); }
  });
}

// ── Helpers ──────────────────────────────────────────────────────────

function parseInterval(str: string): number | null {
  const map: Record<string, number> = {
    "30s": 30_000, "1m": 60_000, "2m": 120_000, "3m": 180_000, "5m": 300_000,
  };
  const ms = map[str.toLowerCase()];
  if (!ms) return null;
  if (ms < MIN_LOOP_INTERVAL_MS || ms > MAX_LOOP_INTERVAL_MS) return null;
  return ms;
}

function formatDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (min < 60) return `${min}m ${sec}s`;
  const hours = Math.floor(min / 60);
  const remainMin = min % 60;
  return `${hours}h ${remainMin}m`;
}
