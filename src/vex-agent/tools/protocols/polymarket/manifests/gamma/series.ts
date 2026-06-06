import type { ProtocolToolManifest } from "../../../types.js";
import { POLYMARKET_GAMMA_DISCOVERY } from "../../../embeddings/polymarket/gamma.js";

// ── Series (2) ────────────────────────────────────────────────

export const GAMMA_SERIES_TOOLS: readonly ProtocolToolManifest[] = [
  {
    toolId: "polymarket.gamma.series",
    namespace: "polymarket",
    lifecycle: "active",
    description: "List event series — grouped recurring events. Filter by category, slug, recurrence.",
    mutating: false,
    actionKind: "read",
    params: [
      { key: "limit", type: "number", description: "Max results." },
      { key: "offset", type: "number", description: "Pagination offset." },
      { key: "order", type: "string", description: "Sort field." },
      { key: "ascending", type: "boolean", description: "Ascending sort." },
      { key: "slug", type: "string", description: "Filter by slug(s), comma-separated." },
      { key: "closed", type: "boolean", description: "Filter by closed status." },
      { key: "categoriesIds", type: "string", description: "Filter by category IDs, comma-separated." },
      { key: "categoriesLabels", type: "string", description: "Filter by category labels, comma-separated." },
      { key: "recurrence", type: "string", description: "Filter by recurrence pattern." },
      { key: "excludeEvents", type: "boolean", description: "Exclude nested events from response." },
      { key: "includeChat", type: "boolean", description: "Include chat data." },
    ],
    exampleParams: {},
    discovery: POLYMARKET_GAMMA_DISCOVERY["polymarket.gamma.series"],
  },
  {
    toolId: "polymarket.gamma.seriesById",
    namespace: "polymarket",
    lifecycle: "active",
    description: "Get single series by ID with nested events.",
    mutating: false,
    actionKind: "read",
    params: [
      { key: "id", type: "string", required: true, description: "Series ID." },
      { key: "includeChat", type: "boolean", description: "Include chat data." },
    ],
    exampleParams: { id: "123" },
    discovery: POLYMARKET_GAMMA_DISCOVERY["polymarket.gamma.seriesById"],
  },
];
