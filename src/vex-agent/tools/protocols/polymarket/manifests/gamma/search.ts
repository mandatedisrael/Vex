import type { ProtocolToolManifest } from "../../../types.js";
import { POLYMARKET_GAMMA_DISCOVERY } from "../../../embeddings/polymarket/gamma.js";

// ── Search (1) ────────────────────────────────────────────────

export const GAMMA_SEARCH_TOOLS: readonly ProtocolToolManifest[] = [
  {
    toolId: "polymarket.gamma.search",
    namespace: "polymarket",
    lifecycle: "active",
    description: "Cross-entity search across events, tags, and profiles on Polymarket. Rich filtering and sorting.",
    mutating: false,
    actionKind: "read",
    params: [
      { key: "query", type: "string", required: true, description: "Search query." },
      { key: "limitPerType", type: "number", description: "Max results per entity type." },
      { key: "page", type: "number", description: "Page number." },
      { key: "eventsStatus", type: "string", description: "Filter events by status." },
      { key: "eventsTag", type: "string", description: "Filter by event tag(s), comma-separated." },
      { key: "excludeTagId", type: "string", description: "Exclude tag IDs, comma-separated." },
      { key: "sort", type: "string", description: "Sort results by field." },
      { key: "ascending", type: "boolean", description: "Ascending sort." },
      { key: "keepClosedMarkets", type: "number", description: "Include closed markets (1=yes)." },
      { key: "searchTags", type: "boolean", description: "Include tags in results." },
      { key: "searchProfiles", type: "boolean", description: "Include profiles in results." },
      { key: "recurrence", type: "string", description: "Filter by recurrence pattern." },
      { key: "cache", type: "boolean", description: "Enable/disable caching." },
      { key: "optimized", type: "boolean", description: "Use optimized response format." },
    ],
    exampleParams: { query: "bitcoin", limitPerType: 5 },
    discovery: POLYMARKET_GAMMA_DISCOVERY["polymarket.gamma.search"],
  },
];
