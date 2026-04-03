/**
 * ZaaS DEX catalog — structured per-chain DEX configs for kyberswap.zap.list.
 *
 * Curated from KyberSwap ZaaS docs (supported-chains-dexes + dex-ids pages).
 * Not a live API — periodically verified against docs.
 */

import type { ChainZapDexConfig } from "./types.js";
import { POLYGON_ZAP_DEXES } from "./chains/polygon.js";
import { ETHEREUM_ZAP_DEXES } from "./chains/ethereum.js";
import { BASE_ZAP_DEXES } from "./chains/base.js";
import { ARBITRUM_ZAP_DEXES } from "./chains/arbitrum.js";
import { BSC_ZAP_DEXES } from "./chains/bsc.js";
import { OPTIMISM_ZAP_DEXES } from "./chains/optimism.js";
import { AVALANCHE_ZAP_DEXES } from "./chains/avalanche.js";
import { LINEA_ZAP_DEXES } from "./chains/linea.js";
import { SONIC_ZAP_DEXES } from "./chains/sonic.js";
import { BERACHAIN_ZAP_DEXES } from "./chains/berachain.js";
import { RONIN_ZAP_DEXES } from "./chains/ronin.js";
import { SCROLL_ZAP_DEXES } from "./chains/scroll.js";
import { ZKSYNC_ZAP_DEXES } from "./chains/zksync.js";

const CATALOG = new Map<string, ChainZapDexConfig>([
  ["polygon", POLYGON_ZAP_DEXES],
  ["ethereum", ETHEREUM_ZAP_DEXES],
  ["base", BASE_ZAP_DEXES],
  ["arbitrum", ARBITRUM_ZAP_DEXES],
  ["bsc", BSC_ZAP_DEXES],
  ["optimism", OPTIMISM_ZAP_DEXES],
  ["avalanche", AVALANCHE_ZAP_DEXES],
  ["linea", LINEA_ZAP_DEXES],
  ["sonic", SONIC_ZAP_DEXES],
  ["berachain", BERACHAIN_ZAP_DEXES],
  ["ronin", RONIN_ZAP_DEXES],
  ["scroll", SCROLL_ZAP_DEXES],
  ["zksync", ZKSYNC_ZAP_DEXES],
]);

export function getZapDexConfig(chain: string): ChainZapDexConfig | undefined {
  return CATALOG.get(chain);
}

export function getSupportedZapChains(): string[] {
  return [...CATALOG.keys()];
}

export { type ChainZapDexConfig, type ZapDexEntry, type ZapDexCapability } from "./types.js";
