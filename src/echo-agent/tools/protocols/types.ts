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

export type ToolLifecycle = "active" | "declared";

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
  /** Active = executable, declared = metadata only */
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
}

// ── Protocol handler (what executes the tool) ────────────────────

export type ProtocolHandler = (
  params: Record<string, unknown>,
  context: ProtocolExecutionContext,
) => Promise<ToolResult>;

export interface ProtocolExecutionContext {
  loopMode: "full" | "restricted" | "off";
  approved: boolean;
}

// ── Discovery request/result ─────────────────────────────────────

export interface ProtocolDiscoveryRequest {
  query?: string;
  namespace?: ProtocolNamespace;
  includeMutating?: boolean;
  includeDeclared?: boolean;
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
