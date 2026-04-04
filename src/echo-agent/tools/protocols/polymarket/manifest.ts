/**
 * Polymarket protocol manifest — prediction markets on Polygon.
 *
 * Built iteratively: bridge first, then CLOB, data, gamma.
 */

import type { ProtocolToolManifest } from "../types.js";
import { BRIDGE_TOOLS } from "./manifests/bridge.js";
import { CLOB_TOOLS } from "./manifests/clob.js";
import { DATA_TOOLS } from "./manifests/data.js";
import { GAMMA_TOOLS } from "./manifests/gamma.js";
import { REWARDS_TOOLS } from "./manifests/rewards.js";

export const POLYMARKET_TOOLS: readonly ProtocolToolManifest[] = [
  ...BRIDGE_TOOLS,
  ...CLOB_TOOLS,
  ...DATA_TOOLS,
  ...GAMMA_TOOLS,
  ...REWARDS_TOOLS,
];
