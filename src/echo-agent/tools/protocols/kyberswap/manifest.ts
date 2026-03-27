/**
 * KyberSwap protocol manifest — aggregates all module manifests.
 *
 * 5 modules: chains, tokens, swap, limit orders, zap.
 * All EVM-only — 20 chains, 400+ DEXs.
 */

import type { ProtocolToolManifest } from "../types.js";
import { CHAINS_TOOLS } from "./manifests/chains.js";
import { TOKENS_TOOLS } from "./manifests/tokens.js";
import { SWAP_TOOLS } from "./manifests/swap.js";
import { LIMIT_ORDER_TOOLS } from "./manifests/limit-order.js";
import { ZAP_TOOLS } from "./manifests/zap.js";

export const KYBERSWAP_TOOLS: readonly ProtocolToolManifest[] = [
  ...CHAINS_TOOLS,
  ...TOKENS_TOOLS,
  ...SWAP_TOOLS,
  ...LIMIT_ORDER_TOOLS,
  ...ZAP_TOOLS,
];
