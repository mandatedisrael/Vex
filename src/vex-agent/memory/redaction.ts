/**
 * Two-tier redaction for memory layer writes — thin re-export.
 *
 * Canonical implementation lives at src/lib/diagnostics/text-redaction.ts so
 * both vex-agent and vex-app can import via @vex-lib without dragging agent
 * code into the renderer/main bundle graph.
 *
 * Call sites in vex-agent stay identical:
 *   `import { redact, redactObject, type RedactionResult } from "../memory/redaction.js"`
 *
 * Tier 1 hard-redacts mnemonics, labelled private keys, API keys, JWTs.
 * Tier 2 masks EVM addresses, Solana addresses, transaction hashes.
 * See the canonical module for full semantics + invariants.
 */

export {
  redact,
  redactObject,
  type RedactionResult,
} from "../../lib/diagnostics/text-redaction.js";
