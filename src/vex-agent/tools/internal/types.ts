/**
 * Internal tool handler types.
 *
 * Each internal tool handler is an async function that takes params
 * and returns an InternalToolResult. Handlers do NOT know about
 * sessions, SSE events, or the inference loop — they are pure
 * param-in → result-out functions.
 *
 * Session context (loadedDocuments, messages) is passed explicitly
 * where needed — not as a god-object dependency.
 */

import type { ToolResult } from "../types.js";
import type { Permission, SessionKind, WalletPolicy } from "@vex-agent/engine/types.js";
import type { WalletResolution } from "@tools/wallet/multi-auth.js";

/** Result from an internal tool handler */
export type InternalToolResult = ToolResult;

/** Context passed to internal tools that need session awareness */
export interface InternalToolContext {
  /** Session ID — for DB operations */
  sessionId: string;
  /** Loaded documents — for document_read context tracking */
  loadedDocuments: Map<string, string>;
  /**
   * Session permission, hydrated once at engine entry from `sessions.permission`.
   * Immutable for the call. Approval gates (runtime + wallet_send_confirm)
   * branch on this single value.
   */
  sessionPermission: Permission;
  /** Whether this call was pre-approved */
  approved: boolean;
  /** Session role — determines tool availability (hard enforcement) */
  role: "parent" | "subagent";
  /** Active mission run ID — for mission_stop guard */
  missionRunId: string | null;
  /** Mission ID when the session is in mission setup or an active mission run. */
  missionId: string | null;
  /**
   * Session kind — propagated from EngineContext. Lets handlers defense-in-depth
   * their own preconditions without relying solely on the registry visibility
   * filter (e.g. `loop_defer` handler rejects non-mission calls even if the
   * model somehow emits the tool name).
   */
  sessionKind: SessionKind;
  /**
   * Context-usage band at dispatch time — derived from the previous prompt's
   * token count. Used by band-scoped handlers (`compact_now` at barrier+)
   * for defense-in-depth against calls outside their intended band.
   */
  contextUsageBand: "normal" | "warning" | "barrier" | "critical";
  /**
   * Origin of the call. Used for knowledge provenance (knowledge_entries.source_surface).
   * - undefined / "vex_agent": Vex Agent (mission loop, chat, scripts) — default
   * - "mcp_local": production MCP server (`src/mcp`)
   *
   * Defaulting to undefined means existing call sites stay unchanged; the knowledge
   * write path interprets undefined as "vex_agent".
   */
  sourceSurface?: "vex_agent" | "mcp_local";
  /**
   * Session id of the writer surface. For MCP this is the MCP-side session id
   * (`mcp-stdio-{nanoid}` / `mcp-http-{nanoid}`). Vex Agent typically leaves
   * this undefined and relies on `sessionId` for its own session tracking.
   */
  sourceSession?: string;
  /**
   * Per-session wallet resolution (puzzle 5 phase 5B). Engine sessions use
   * source:"session" (selected wallet, or fail-closed when unselected); MCP/CLI
   * use source:"default" (primary wallet). Consumed by the wallet resolvers.
   */
  walletResolution: WalletResolution;
  /** Mission wallet policy — enforced alongside the resolution by the resolvers. */
  walletPolicy: WalletPolicy;
}

// ── Param accessors ─────────────────────────────────────────────

/** Safe string accessor for tool params */
export function str(params: Record<string, unknown>, key: string): string {
  const v = params[key];
  return typeof v === "string" ? v : "";
}

/** Safe number accessor for tool params */
export function num(params: Record<string, unknown>, key: string): number | undefined {
  const v = params[key];
  return typeof v === "number" ? v : undefined;
}

/** Safe boolean accessor for tool params */
export function bool(params: Record<string, unknown>, key: string): boolean {
  return params[key] === true;
}

/**
 * Safe enum accessor for tool params — returns the value only if it matches
 * one of the allowed literals, otherwise undefined. Handlers resolve their
 * own default (usually server-side, because LLMs frequently omit defaults
 * even when the schema declares one).
 */
export function enumField<T extends string>(
  params: Record<string, unknown>,
  key: string,
  allowed: readonly T[],
): T | undefined {
  const v = params[key];
  if (typeof v !== "string") return undefined;
  return (allowed as readonly string[]).includes(v) ? (v as T) : undefined;
}

// ── Result helpers ──────────────────────────────────────────────

/** Success result with JSON-serialized data. */
export function ok(data: unknown): ToolResult {
  return { success: true, output: JSON.stringify(data, null, 2), data: data as Record<string, unknown> };
}

/** Failure result with message. */
export function fail(msg: string): ToolResult {
  return { success: false, output: msg };
}
