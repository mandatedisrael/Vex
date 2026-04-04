/**
 * Polymarket protocol handlers — aggregator.
 * Split into modules: bridge, clob (data, gamma, relayer in later iterations).
 */

import type { ProtocolHandler } from "../types.js";
import { BRIDGE_HANDLERS } from "./handlers-bridge.js";
import { CLOB_HANDLERS } from "./handlers-clob.js";
import { DATA_HANDLERS } from "./handlers-data.js";
import { GAMMA_HANDLERS } from "./handlers-gamma.js";
import { REWARDS_HANDLERS } from "./handlers-rewards.js";

export const POLYMARKET_HANDLERS: Record<string, ProtocolHandler> = {
  ...BRIDGE_HANDLERS,
  ...CLOB_HANDLERS,
  ...DATA_HANDLERS,
  ...GAMMA_HANDLERS,
  ...REWARDS_HANDLERS,
};
