/**
 * ChainScan (0G Network) protocol manifest — aggregates all module manifests.
 *
 * 6 modules: account, transaction, contract, decode, token, stats.
 * All read-only. Requires CHAINSCAN_API_KEY. Network: 0G (EVM).
 */

import type { ProtocolToolManifest } from "../../types.js";
import { ACCOUNT_TOOLS } from "./manifests/account.js";
import { TRANSACTION_TOOLS } from "./manifests/transaction.js";
import { CONTRACT_TOOLS } from "./manifests/contract.js";
import { DECODE_TOOLS } from "./manifests/decode.js";
import { TOKEN_TOOLS } from "./manifests/token.js";
import { STATS_TOOLS } from "./manifests/stats.js";

export const CHAINSCAN_TOOLS: readonly ProtocolToolManifest[] = [
  ...ACCOUNT_TOOLS,
  ...TRANSACTION_TOOLS,
  ...CONTRACT_TOOLS,
  ...DECODE_TOOLS,
  ...TOKEN_TOOLS,
  ...STATS_TOOLS,
];
