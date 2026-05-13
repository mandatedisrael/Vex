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
import type { Permission } from "@vex-agent/engine/types.js";

// ── Protocol namespaces ──────────────────────────────────────────

export type ProtocolNamespace =
  | "khalani"
  | "kyberswap"
  | "solana"
  | "polymarket"
  | "dexscreener";

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
  /** Retrieval-only semantic text embedded for dense tool discovery. */
  embeddingText?: string;
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
  /**
   * Chains where this tool operates — used as a low-weight lexical search
   * field so queries like "swap on plasma" or "bridge to monad" recall the
   * right tool even when the chain is not enumerated in the description or
   * embedding text.
   */
  chains?: readonly string[];
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
  /**
   * Session permission, hydrated once at engine entry from `sessions.permission`.
   * Approval gate in `tools/protocols/runtime.ts` reads this to decide whether
   * a mutating tool needs enqueue or auto-executes.
   */
  sessionPermission: Permission;
  approved: boolean;
  /** Session ID — passed to execution capture for audit trail */
  sessionId?: string;
}

// ── Discovery request/result ─────────────────────────────────────

export interface ProtocolDiscoveryRequest {
  query?: string;
  namespace?: string;
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

/**
 * Retrieval metadata attached to a discovery result. Surfaces whether the
 * response was an unranked catalog listing, dense-ranked, or lexical fallback,
 * plus audit columns of the embedding used. Surfaced to the LLM via
 * dispatcher JSON serialization — model uses `method` and `denseFailed` to
 * interpret weak matches (lexical fallback often signals embedding-sidecar
 * issues, not query problems). Also consumed by telemetry.
 */
export interface ProtocolDiscoveryRetrievalMeta {
  method: "catalog" | "dense" | "lexical";
  /** True when dense retrieval was attempted but lexical fallback produced the result. */
  denseFailed: boolean;
  /** Provider-reported embedding model (only set when dense retrieval ran). */
  embeddingModel?: string;
  /** Provider-reported embedding dim (only set when dense retrieval ran). */
  embeddingDim?: number;
  /** Number of candidates before scoring (post env/advertised/lifecycle filters). */
  candidateCount: number;
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
  /** Optional retrieval metadata for telemetry. */
  retrieval?: ProtocolDiscoveryRetrievalMeta;
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
