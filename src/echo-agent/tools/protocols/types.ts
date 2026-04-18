/**
 * Protocol tool types — manifest-driven discover+execute system.
 *
 * Each protocol (khalani, kyberswap, solana, polymarket) provides:
 * 1. Manifests — declarative tool metadata (params, mutating, description)
 * 2. Handlers — async functions that call TS clients directly
 *
 * The LLM interacts via two meta-tools:
 * - discover_tools → search manifests by query/namespace
 * - execute_tool → call handler by toolId with params
 */

import type { ToolResult } from "../types.js";

// ── Protocol namespaces ──────────────────────────────────────────

export type ProtocolNamespace =
  | "khalani"
  | "kyberswap"
  | "solana"
  | "polymarket"
  | "0g-compute"
  | "0g-storage"
  | "jaine"
  | "slop"
  | "dexscreener"
  | "echobook"
  | "chainscan"
  | "slop-app";

/**
 * Lifecycle state of a protocol manifest.
 *
 * Post-PR1 only `"active"` is inhabited. The previous `"declared"` variant
 * was zero-ref in the repo (no manifest used it) and has been removed from
 * the union — follow-up manifests that need a "declared but not yet
 * executable" state should add a new variant here *and* provide at least
 * one real manifest plus matching discovery / runtime behaviour.
 */
export type ToolLifecycle = "active";

// ── Discovery metadata (optional per-tool enrichment) ───────────

export interface ToolDiscoveryMetadata {
  canonicalSummary?: string;
  aliases?: string[];
  exampleIntents?: string[];
  paramKeywords?: string[];
  operation?: ("research" | "verify" | "quote" | "execute" | "monitor")[];
  resourceTypes?: string[];
  ecosystems?: string[];
  sourceClass?: "specialized_market" | "general_web" | "social" | "protocol_native" | "onchain_verification";
  sideEffectLevel?: "none" | "low" | "high";
  preferredFor?: string[];
  avoidFor?: string[];
}

// ── Manifest (declarative tool definition) ───────────────────────

export interface ProtocolParamDef {
  key: string;
  type: "string" | "number" | "boolean";
  required?: boolean;
  description: string;
}

export interface ProtocolToolManifest {
  /** Canonical tool ID, e.g. "khalani.bridge" */
  toolId: string;
  /** Protocol namespace */
  namespace: ProtocolNamespace;
  /** Lifecycle state — see {@link ToolLifecycle}. */
  lifecycle: ToolLifecycle;
  /** Human-readable description for LLM */
  description: string;
  /** Whether this tool modifies state */
  mutating: boolean;
  /** Parameter definitions */
  params: ProtocolParamDef[];
  /** Example params for LLM guidance */
  exampleParams: Record<string, unknown>;
  /** ENV var required for this tool. If set and ENV is empty, tool is hidden from discovery and blocked in execute. */
  requiresEnv?: string;
  /** Optional discovery metadata for improved retrieval — filled incrementally per tool. */
  discovery?: ToolDiscoveryMetadata;
}

// ── Protocol handler (what executes the tool) ────────────────────

export type ProtocolHandler = (
  params: Record<string, unknown>,
  context: ProtocolExecutionContext,
) => Promise<ToolResult>;

export interface ProtocolExecutionContext {
  loopMode: "full" | "restricted" | "off";
  approved: boolean;
  /** Session ID — passed to execution capture for audit trail */
  sessionId?: string;
}

// ── Discovery request/result ─────────────────────────────────────

export interface ProtocolDiscoveryRequest {
  query?: string;
  namespace?: string;
  includeMutating?: boolean;
  limit?: number;
}

export interface ProtocolDiscoveryItem {
  toolId: string;
  namespace: ProtocolNamespace;
  lifecycle: ToolLifecycle;
  description: string;
  mutating: boolean;
  params: ProtocolParamDef[];
  exampleParams: Record<string, unknown>;
  /** Retrieval score for this match (0 when no query, >0 for ranked matches). */
  score: number;
  /**
   * Field tags that contributed to the score, e.g. ["description", "params", "navigation"].
   * Useful for the LLM to disambiguate between similarly-scored shortlists.
   */
  whyMatched: string[];
}

export interface ProtocolDiscoveryResult {
  success: boolean;
  /** Number of tools returned in this response (after limit is applied). */
  count: number;
  /** Total number of matching tools before pagination/limit is applied. */
  totalCount: number;
  /** True when additional matching tools exist beyond this response. */
  hasMore: boolean;
  tools: ProtocolDiscoveryItem[];
  warnings: string[];
}

// ── Execute request ──────────────────────────────────────────────

export interface ProtocolExecuteRequest {
  toolId: string;
  params: Record<string, unknown>;
}

// ── Coverage matrix types ───────────────────────────────────────

/** Business semantics of a mutation — how downstream treats the capture. */
export type PortfolioRole =
  | "pnl_spot"       // lot matching, realized PnL
  | "pnl_perps"      // perps position lifecycle + PnL
  | "pnl_prediction" // prediction position lifecycle + PnL
  | "projection"     // orders, LP — lifecycle, no realized PnL
  | "audit"          // balance/state impact — audit trail only
  | "utility";       // no portfolio impact

/** Whether handler produces _tradeCapture today. */
export type CaptureSupport = "full" | "none";
