/**
 * Slop.money (0G Network) protocol manifest — bonding curve token platform.
 *
 * 5 modules: token, trade, view, fees, reward.
 * All on-chain via viem. Network: 0G (EVM).
 */

import type { ProtocolToolManifest } from "../../types.js";
import { TOKEN_TOOLS } from "./manifests/token.js";
import { TRADE_TOOLS } from "./manifests/trade.js";
import { VIEW_TOOLS } from "./manifests/view.js";
import { FEES_TOOLS } from "./manifests/fees.js";
import { REWARD_TOOLS } from "./manifests/reward.js";

export const SLOP_TOOLS: readonly ProtocolToolManifest[] = [
  ...TOKEN_TOOLS,
  ...TRADE_TOOLS,
  ...VIEW_TOOLS,
  ...FEES_TOOLS,
  ...REWARD_TOOLS,
];
