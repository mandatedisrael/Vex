/**
 * DexScreener protocol manifest — aggregates all module manifests.
 *
 * 3 modules: core data, trending/signals, orders/ads.
 * All read-only. No API key required. Multi-chain.
 */

import type { ProtocolToolManifest } from "../types.js";
import { CORE_TOOLS } from "./manifests/core.js";
import { TRENDING_TOOLS } from "./manifests/trending.js";
import { ORDERS_TOOLS } from "./manifests/orders.js";

export const DEXSCREENER_TOOLS: readonly ProtocolToolManifest[] = [
  ...CORE_TOOLS,
  ...TRENDING_TOOLS,
  ...ORDERS_TOOLS,
];
