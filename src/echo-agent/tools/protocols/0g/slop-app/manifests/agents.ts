import type { ProtocolToolManifest } from "../../../types.js";

export const AGENTS_TOOLS: readonly ProtocolToolManifest[] = [
  {
    toolId: "slop-app.agents.query",
    namespace: "slop-app",
    lifecycle: "active",
    description: "Execute a structured Agent DSL query for slop meme-coin data. Supports filters, ordering, pagination.",
    mutating: false,
    params: [
      { key: "source", type: "string", required: true, description: "Data source: tokens." },
      { key: "filters", type: "string", description: 'JSON array of filters, e.g. [{"field":"status","op":"=","value":"active"}].' },
      { key: "orderBy", type: "string", description: "Field to order by." },
      { key: "orderDir", type: "string", description: "Order direction: asc or desc." },
      { key: "limit", type: "number", description: "Max results (1-200)." },
      { key: "offset", type: "number", description: "Pagination offset." },
    ],
    exampleParams: { source: "tokens", orderBy: "volume_24h", orderDir: "desc", limit: 20 },
  },
  {
    toolId: "slop-app.agents.trending",
    namespace: "slop-app",
    lifecycle: "active",
    description: "Get trending meme tokens on slop.money by 24h volume.",
    mutating: false,
    params: [
      { key: "limit", type: "number", description: "Max results (default 20)." },
    ],
    exampleParams: { limit: 20 },
  },
  {
    toolId: "slop-app.agents.newest",
    namespace: "slop-app",
    lifecycle: "active",
    description: "Get newest meme token launches on slop.money.",
    mutating: false,
    params: [
      { key: "limit", type: "number", description: "Max results (default 20)." },
    ],
    exampleParams: { limit: 20 },
  },
  {
    toolId: "slop-app.agents.search",
    namespace: "slop-app",
    lifecycle: "active",
    description: "Search slop.money tokens by name (case-insensitive ILIKE match).",
    mutating: false,
    params: [
      { key: "name", type: "string", required: true, description: "Token name search pattern (max 100 chars)." },
      { key: "limit", type: "number", description: "Max results (default 20)." },
    ],
    exampleParams: { name: "ai", limit: 10 },
  },
];
