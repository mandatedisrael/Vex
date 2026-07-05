import type { ProtocolToolManifest } from "../../types.js";
import { PENDLE_YIELDS_DISCOVERY } from "../../embeddings/pendle/yields.js";

export const PENDLE_READ_TOOLS: readonly ProtocolToolManifest[] = [
  {
    toolId: "pendle.yields",
    namespace: "pendle",
    lifecycle: "active",
    description:
      "Browse active Pendle fixed-yield markets on Ethereum — principal tokens (PT) with a fixed rate to expiry, ranked by liquidity or implied APY. Returns PT/YT/SY addresses, expiry, liquidity, implied APY, and a points warning where a market pays points rather than yield. Read-only.",
    mutating: false,
    actionKind: "read",
    params: [
      { key: "sort", type: "string", description: "Sort order: 'liquidity' (default) or 'apy'." },
      { key: "limit", type: "number", description: "Max markets to return (default 20, max 50)." },
    ],
    exampleParams: { sort: "liquidity", limit: 20 },
    discovery: PENDLE_YIELDS_DISCOVERY["pendle.yields"],
  },
  {
    toolId: "pendle.position.value",
    namespace: "pendle",
    lifecycle: "active",
    description:
      "Value the session wallet's open Pendle PT positions on Ethereum — balance, market, expiry, and USD value, marking each as redeemable once matured. A matured PT is valued at its face/accounting value, never underlying spot. Read-only.",
    mutating: false,
    actionKind: "read",
    params: [],
    exampleParams: {},
    discovery: PENDLE_YIELDS_DISCOVERY["pendle.position.value"],
  },
];
