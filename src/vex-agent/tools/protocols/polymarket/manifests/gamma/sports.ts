import type { ProtocolToolManifest } from "../../../types.js";
import { POLYMARKET_GAMMA_DISCOVERY } from "../../../embeddings/polymarket/gamma.js";

// ── Sports (3) ────────────────────────────────────────────────

export const GAMMA_SPORTS_TOOLS: readonly ProtocolToolManifest[] = [
  {
    toolId: "polymarket.gamma.sportsMetadata",
    namespace: "polymarket",
    lifecycle: "active",
    description: "Get sports categories metadata — sport names, images, resolutions.",
    mutating: false,
    actionKind: "read",
    params: [],
    exampleParams: {},
    discovery: POLYMARKET_GAMMA_DISCOVERY["polymarket.gamma.sportsMetadata"],
  },
  {
    toolId: "polymarket.gamma.sportsMarketTypes",
    namespace: "polymarket",
    lifecycle: "active",
    description: "Get available sports market types (e.g. moneyline, spread, total).",
    mutating: false,
    actionKind: "read",
    params: [],
    exampleParams: {},
    discovery: POLYMARKET_GAMMA_DISCOVERY["polymarket.gamma.sportsMarketTypes"],
  },
  {
    toolId: "polymarket.gamma.teams",
    namespace: "polymarket",
    lifecycle: "active",
    description: "List sports teams with league, record, logo. Filter by name or abbreviation.",
    mutating: false,
    actionKind: "read",
    params: [
      { key: "league", type: "string", description: "Filter by league (comma-separated for multiple)." },
      { key: "name", type: "string", description: "Filter by team name(s), comma-separated." },
      { key: "abbreviation", type: "string", description: "Filter by abbreviation(s), comma-separated." },
      { key: "limit", type: "number", description: "Max results." },
      { key: "offset", type: "number", description: "Pagination offset." },
      { key: "order", type: "string", description: "Sort field." },
      { key: "ascending", type: "boolean", description: "Ascending sort." },
    ],
    exampleParams: { league: "NBA" },
    discovery: POLYMARKET_GAMMA_DISCOVERY["polymarket.gamma.teams"],
  },
];
