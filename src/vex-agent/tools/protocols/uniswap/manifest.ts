/**
 * Uniswap protocol manifest — swap module (quote + sell + buy).
 *
 * Keyless on-chain V2/V3 routing. Only venue on Robinhood Chain (4663); all-EVM
 * fallback where KyberSwap is primary. No LP / positions / V4 surfaces.
 */

import type { ProtocolToolManifest } from "../types.js";
import { UNISWAP_SWAP_TOOLS } from "./manifests/swap.js";

export const UNISWAP_TOOLS: readonly ProtocolToolManifest[] = [...UNISWAP_SWAP_TOOLS];
