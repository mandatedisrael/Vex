/**
 * Pendle protocol manifest — fixed-yield PT (Ethereum v1).
 *
 * Read: yields discovery + position valuation. Mutating: PT quote (records the
 * prequote), buy, early-exit sell, and matured redeem. Every mutating path is
 * prequote- + approval-gated with provider "pendle" and pins the canonical
 * Pendle Router. No YT/LP surfaces in this wave.
 */

import type { ProtocolToolManifest } from "../types.js";
import { PENDLE_READ_TOOLS } from "./manifests/read.js";
import { PENDLE_PT_TOOLS } from "./manifests/pt.js";

export const PENDLE_TOOLS: readonly ProtocolToolManifest[] = [...PENDLE_READ_TOOLS, ...PENDLE_PT_TOOLS];
