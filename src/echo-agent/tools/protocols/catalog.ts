/**
 * Protocol tool catalog — all protocol manifests in one place.
 *
 * New protocols register their manifests here.
 * Discovery searches this catalog. Execution looks up handlers.
 */

import type { ProtocolNamespace, ProtocolToolManifest, ProtocolHandler } from "./types.js";
import { KHALANI_TOOLS } from "./khalani/manifest.js";
import { KHALANI_HANDLERS } from "./khalani/handlers.js";
import { SOLANA_JUPITER_TOOLS } from "./solana-jupiter/manifest.js";
import { SOLANA_JUPITER_HANDLERS } from "./solana-jupiter/handlers.js";
import { KYBERSWAP_TOOLS } from "./kyberswap/manifest.js";
import { KYBERSWAP_HANDLERS } from "./kyberswap/handlers.js";
import { DEXSCREENER_TOOLS } from "./dexscreener/manifest.js";
import { DEXSCREENER_HANDLERS } from "./dexscreener/handlers.js";
import { CHAINSCAN_TOOLS } from "./0g/chainscan/manifest.js";
import { CHAINSCAN_HANDLERS } from "./0g/chainscan/handlers.js";
import { JAINE_TOOLS } from "./0g/jaine/manifest.js";
import { JAINE_HANDLERS } from "./0g/jaine/handlers.js";
import { SLOP_TOOLS } from "./0g/slop/manifest.js";
import { SLOP_HANDLERS } from "./0g/slop/handlers.js";
import { ECHOBOOK_TOOLS } from "./echobook/manifest.js";
import { ECHOBOOK_HANDLERS } from "./echobook/handlers.js";
import { POLYMARKET_TOOLS } from "./polymarket/manifest.js";
import { POLYMARKET_HANDLERS } from "./polymarket/handlers.js";
import { SLOP_APP_TOOLS } from "./0g/slop-app/manifest.js";
import { SLOP_APP_HANDLERS } from "./0g/slop-app/handlers.js";

// ── Namespace allowlist ──────────────────────────────────────────

export const PROTOCOL_NAMESPACE_ALLOWLIST: readonly ProtocolNamespace[] = [
  "khalani",
  "kyberswap",
  "solana",
  "polymarket",
  "0g-compute",
  "0g-storage",
  "jaine",
  "slop",
  "dexscreener",
  "echobook",
  "chainscan",
  "slop-app",
] as const;

// ── All protocol manifests ───────────────────────────────────────

export const PROTOCOL_TOOLS: readonly ProtocolToolManifest[] = [
  ...KHALANI_TOOLS,
  ...SOLANA_JUPITER_TOOLS,
  ...KYBERSWAP_TOOLS,
  ...DEXSCREENER_TOOLS,
  ...CHAINSCAN_TOOLS,
  ...JAINE_TOOLS,
  ...SLOP_TOOLS,
  ...ECHOBOOK_TOOLS,
  ...POLYMARKET_TOOLS,
  ...SLOP_APP_TOOLS,
];

// ── Handler registry ─────────────────────────────────────────────

const HANDLER_MAP: Record<string, ProtocolHandler> = {
  ...KHALANI_HANDLERS,
  ...SOLANA_JUPITER_HANDLERS,
  ...KYBERSWAP_HANDLERS,
  ...DEXSCREENER_HANDLERS,
  ...CHAINSCAN_HANDLERS,
  ...JAINE_HANDLERS,
  ...SLOP_HANDLERS,
  ...ECHOBOOK_HANDLERS,
  ...POLYMARKET_HANDLERS,
  ...SLOP_APP_HANDLERS,
};

/** Get the handler function for a protocol tool by toolId */
export function getProtocolHandler(toolId: string): ProtocolHandler | undefined {
  return HANDLER_MAP[toolId];
}

/** Get a manifest by toolId */
export function getProtocolManifest(toolId: string): ProtocolToolManifest | undefined {
  return PROTOCOL_TOOLS.find(t => t.toolId === toolId);
}
