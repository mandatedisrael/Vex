/**
 * Uniswap discovery text — chain list for low-weight lexical recall.
 * Mirrors kyberswap/discovery-text.ts. Derived from the verified deployment
 * registry so it never advertises a chain the tool cannot reach.
 */

import { listUniswapDeployments } from "@tools/uniswap/deployments.js";

export const UNISWAP_CHAINS: readonly string[] = listUniswapDeployments().map((d) => d.key);
