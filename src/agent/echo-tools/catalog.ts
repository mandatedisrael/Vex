/**
 * echoTools protocol catalog scaffold.
 *
 * Intent:
 * - Keep protocol capabilities separate from agent internal tools.
 * - Provide explicit allowlist scope (not inferred only from src/tools).
 * - Avoid namespace drift vs CLI roots (0g-compute/0g-storage, solana).
 *
 * NOTE:
 * - This is a template-only file for now.
 * - Full discovery/validation/execution mapping will be added in follow-up.
 */

import type { ProtocolNamespace, ProtocolToolManifest } from "./types.js";

/**
 * Declared protocol scope for echoTools (phase 1 catalog scope).
 * Internal tools are intentionally excluded from this list.
 */
export const PROTOCOL_NAMESPACE_ALLOWLIST: readonly ProtocolNamespace[] = [
  "0g-compute",
  "0g-storage",
  "solana",
  "chainscan",
  "dexscreener",
  "echobook",
  "jaine",
  "khalani",
  "kyberswap",
  "polymarket",
  "slop",
  "wallet",
] as const;

/**
 * Phase 1 active minimum (execute enabled).
 * Everything else in allowlist should stay declared/template-only.
 */
export const PROTOCOL_ACTIVE_MINIMUM: readonly ProtocolNamespace[] = [
  "solana",
  "khalani",
  "kyberswap",
] as const;

/**
 * wallet is declared for groundwork but should not execute in phase 1.
 * marketmaker is intentionally out of this phase.
 */
export const PHASE1_POLICY = {
  walletExecuteEnabled: false,
  marketmakerIncluded: false,
} as const;

/**
 * Template protocol tools.
 * TODO:
 * - Replace placeholders with canonical toolId manifests.
 * - Add CLI command path mapping and schema metadata.
 * - Add lifecycle enforcement and allowlist-vs-cli-runtime validation.
 */
export const PROTOCOL_TOOLS: readonly ProtocolToolManifest[] = [];

