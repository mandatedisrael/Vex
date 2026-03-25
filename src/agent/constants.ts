/**
 * Constants for the Echo Agent module.
 *
 * File-based storage removed — all data lives in Postgres.
 * Only daemon PID/log paths and config constants remain.
 */

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { CONFIG_DIR } from "../config/paths.js";

// ── Daemon directory (PID + log only) ────────────────────────────────

export const AGENT_DIR = join(CONFIG_DIR, "agent");
export const AGENT_PID_FILE = join(AGENT_DIR, "agent.pid");
export const AGENT_LOG_FILE = join(AGENT_DIR, "agent.log");
export const AGENT_STOPPED_FILE = join(AGENT_DIR, "agent.stopped");

// ── Server ───────────────────────────────────────────────────────────

export const AGENT_DEFAULT_PORT = 4201;

// ── Context limits ───────────────────────────────────────────────────

export const COMPACTION_THRESHOLD = 0.75;
export const DEFAULT_CONTEXT_LIMIT = Number(process.env.AGENT_CONTEXT_LIMIT) || 65_000;
export const SUBAGENT_CONTEXT_LIMIT = 40_000;
export const SUBAGENT_RESULT_MAX_TOKENS = 1500;

// ── Echo Loop ───────────────────────────────────────────────────────

export const DEFAULT_LOOP_INTERVAL_MS = 5 * 60 * 1000;
export const MIN_LOOP_INTERVAL_MS = 30_000;
export const MAX_LOOP_INTERVAL_MS = 5 * 60 * 1000;
export const LOOP_PHASE_TIMEOUT_MS = 2 * 60 * 1000;
export const LOOP_CIRCUIT_BREAKER_THRESHOLD = 5;

// ── Subagents ───────────────────────────────────────────────────────

export const MAX_CONCURRENT_SUBAGENTS = 3;
export const SUBAGENT_MAX_ITERATIONS = 25;
export const SUBAGENT_TIMEOUT_MS = 5 * 60 * 1000;

// ── Top-up monitor ──────────────────────────────────────────────────

export const TOPUP_MONITOR_INTERVAL_MS = 60_000;
export const TOPUP_COOLDOWN_MS = 5 * 60 * 1000;
export const TOPUP_BASELINE_MULTIPLIER = 0.15;
export const TOPUP_MAX_CONSECUTIVE_ALERTS = 3;

// ── Tool execution ───────────────────────────────────────────────────

export const DEFAULT_TOOL_TIMEOUT_MS = 60_000;
export const ONCHAIN_TOOL_TIMEOUT_MS = 90_000;

/** Max chars for tool output in SSE events (UI display). Full output goes to DB. */
export const SSE_TOOL_OUTPUT_LIMIT = 4000;

// ── Backup ───────────────────────────────────────────────────────────

export const AUTO_BACKUP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

// ── Package root (resolved from this file, not process.cwd()) ────────

export const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

// ── Skills reference path (removed — discover+execute routing) ───────

// ── Database ─────────────────────────────────────────────────────────

export const AGENT_DB_URL = process.env.AGENT_DB_URL ?? "postgresql://echo_agent:echo_agent@localhost:5432/echo_agent";

// ── Web search (Tavily API) ──────────────────────────────────────────
// API key loaded from process.env.TAVILY_API_KEY in search.ts
// Free tier: 1,000 credits/month at https://tavily.com
