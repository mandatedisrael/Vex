import type { ProtocolToolManifest } from "../../types.js";

export const GAMMA_TOOLS: readonly ProtocolToolManifest[] = [
  // ── Events (4) ────────────────────────────────────────────────

  {
    toolId: "polymarket.gamma.events",
    namespace: "polymarket",
    lifecycle: "active",
    description: "Browse prediction market events — filter by tag, status, liquidity/volume bounds, date range. Includes nested markets with prices.",
    mutating: false,
    params: [
      { key: "limit", type: "number", description: "Max results." },
      { key: "offset", type: "number", description: "Pagination offset." },
      { key: "order", type: "string", description: "Sort field (e.g. volume24hr, liquidity, startDate)." },
      { key: "ascending", type: "boolean", description: "Ascending sort." },
      { key: "slug", type: "string", description: "Filter by event slug(s), comma-separated." },
      { key: "tagSlug", type: "string", description: "Filter by tag slug." },
      { key: "tagId", type: "number", description: "Filter by tag ID." },
      { key: "excludeTagId", type: "string", description: "Exclude tag IDs, comma-separated." },
      { key: "relatedTags", type: "boolean", description: "Include related tags in response." },
      { key: "active", type: "boolean", description: "Filter active only." },
      { key: "closed", type: "boolean", description: "Filter closed only." },
      { key: "featured", type: "boolean", description: "Filter featured only." },
      { key: "archived", type: "boolean", description: "Filter archived events." },
      { key: "cyom", type: "boolean", description: "Filter create-your-own-market events." },
      { key: "liquidityMin", type: "number", description: "Minimum liquidity in USD." },
      { key: "liquidityMax", type: "number", description: "Maximum liquidity in USD." },
      { key: "volumeMin", type: "number", description: "Minimum volume in USD." },
      { key: "volumeMax", type: "number", description: "Maximum volume in USD." },
      { key: "startDateMin", type: "string", description: "Start date lower bound (ISO 8601)." },
      { key: "startDateMax", type: "string", description: "Start date upper bound (ISO 8601)." },
      { key: "endDateMin", type: "string", description: "End date lower bound (ISO 8601)." },
      { key: "endDateMax", type: "string", description: "End date upper bound (ISO 8601)." },
      { key: "recurrence", type: "string", description: "Filter by recurrence pattern." },
      { key: "includeChat", type: "boolean", description: "Include chat data." },
      { key: "includeTemplate", type: "boolean", description: "Include template data." },
    ],
    exampleParams: { active: true, closed: false, liquidityMin: 1000, order: "volume24hr", ascending: false, limit: 10 },
  },
  {
    toolId: "polymarket.gamma.event",
    namespace: "polymarket",
    lifecycle: "active",
    description: "Get single event by ID — title, description, volume, liquidity, markets, tags.",
    mutating: false,
    params: [
      { key: "id", type: "string", required: true, description: "Event ID." },
      { key: "includeChat", type: "boolean", description: "Include chat data." },
      { key: "includeTemplate", type: "boolean", description: "Include template data." },
    ],
    exampleParams: { id: "12345" },
  },
  {
    toolId: "polymarket.gamma.eventBySlug",
    namespace: "polymarket",
    lifecycle: "active",
    description: "Get single event by URL slug.",
    mutating: false,
    params: [
      { key: "slug", type: "string", required: true, description: "Event slug." },
      { key: "includeChat", type: "boolean", description: "Include chat data." },
      { key: "includeTemplate", type: "boolean", description: "Include template data." },
    ],
    exampleParams: { slug: "will-bitcoin-hit-100k" },
  },
  {
    toolId: "polymarket.gamma.eventTags",
    namespace: "polymarket",
    lifecycle: "active",
    description: "Get tags associated with an event.",
    mutating: false,
    params: [
      { key: "id", type: "string", required: true, description: "Event ID." },
    ],
    exampleParams: { id: "12345" },
  },

  // ── Markets (4) ───────────────────────────────────────────────

  {
    toolId: "polymarket.gamma.markets",
    namespace: "polymarket",
    lifecycle: "active",
    description: "Browse prediction markets — filter by status, liquidity/volume bounds, date range, sports, tags. Includes prices, clobTokenIds.",
    mutating: false,
    params: [
      { key: "limit", type: "number", description: "Max results." },
      { key: "offset", type: "number", description: "Pagination offset." },
      { key: "order", type: "string", description: "Sort field (e.g. volume24hr, liquidityNum, endDate)." },
      { key: "ascending", type: "boolean", description: "Ascending sort." },
      { key: "slug", type: "string", description: "Filter by slug(s), comma-separated." },
      { key: "clobTokenIds", type: "string", description: "Filter by CLOB token IDs, comma-separated." },
      { key: "conditionIds", type: "string", description: "Filter by condition IDs, comma-separated." },
      { key: "questionIds", type: "string", description: "Filter by question IDs, comma-separated." },
      { key: "closed", type: "boolean", description: "Filter by closed status." },
      { key: "tagId", type: "number", description: "Filter by tag ID." },
      { key: "relatedTags", type: "boolean", description: "Include related tags." },
      { key: "cyom", type: "boolean", description: "Create-your-own-market filter." },
      { key: "includeTag", type: "boolean", description: "Include tag data in response." },
      { key: "umaResolutionStatus", type: "string", description: "UMA resolution status filter." },
      { key: "liquidityMin", type: "number", description: "Min liquidity (USD)." },
      { key: "liquidityMax", type: "number", description: "Max liquidity (USD)." },
      { key: "volumeMin", type: "number", description: "Min volume (USD)." },
      { key: "volumeMax", type: "number", description: "Max volume (USD)." },
      { key: "startDateMin", type: "string", description: "Start date lower bound (ISO 8601)." },
      { key: "startDateMax", type: "string", description: "Start date upper bound (ISO 8601)." },
      { key: "endDateMin", type: "string", description: "End date lower bound (ISO 8601)." },
      { key: "endDateMax", type: "string", description: "End date upper bound (ISO 8601)." },
      { key: "gameId", type: "string", description: "Sports game ID filter." },
      { key: "sportsMarketTypes", type: "string", description: "Sports market types, comma-separated." },
      { key: "rewardsMinSize", type: "number", description: "Min rewards size." },
    ],
    exampleParams: { closed: false, liquidityMin: 1000, order: "volume24hr", ascending: false, limit: 10 },
  },
  {
    toolId: "polymarket.gamma.market",
    namespace: "polymarket",
    lifecycle: "active",
    description: "Get single market by condition ID — question, outcomes, prices, clobTokenIds, negRisk.",
    mutating: false,
    params: [
      { key: "id", type: "string", required: true, description: "Market condition ID or numeric ID." },
      { key: "includeTag", type: "boolean", description: "Include tag data." },
    ],
    exampleParams: { id: "0xabc..." },
  },
  {
    toolId: "polymarket.gamma.marketBySlug",
    namespace: "polymarket",
    lifecycle: "active",
    description: "Get single market by URL slug.",
    mutating: false,
    params: [
      { key: "slug", type: "string", required: true, description: "Market slug." },
      { key: "includeTag", type: "boolean", description: "Include tag data." },
    ],
    exampleParams: { slug: "will-eth-hit-5000" },
  },
  {
    toolId: "polymarket.gamma.marketTags",
    namespace: "polymarket",
    lifecycle: "active",
    description: "Get tags associated with a market.",
    mutating: false,
    params: [
      { key: "id", type: "string", required: true, description: "Market condition ID." },
    ],
    exampleParams: { id: "0xabc..." },
  },

  // ── Search (1) ────────────────────────────────────────────────

  {
    toolId: "polymarket.gamma.search",
    namespace: "polymarket",
    lifecycle: "active",
    description: "Cross-entity search across events, tags, and profiles on Polymarket.",
    mutating: false,
    params: [
      { key: "query", type: "string", required: true, description: "Search query." },
      { key: "limitPerType", type: "number", description: "Max results per entity type." },
      { key: "page", type: "number", description: "Page number." },
      { key: "eventsStatus", type: "string", description: "Filter events by status." },
    ],
    exampleParams: { query: "bitcoin" },
  },

  // ── Tags (7) ──────────────────────────────────────────────────

  {
    toolId: "polymarket.gamma.tags",
    namespace: "polymarket",
    lifecycle: "active",
    description: "List all tags (categories) on Polymarket.",
    mutating: false,
    params: [
      { key: "isCarousel", type: "boolean", description: "Filter carousel tags only." },
    ],
    exampleParams: {},
  },
  {
    toolId: "polymarket.gamma.tag",
    namespace: "polymarket",
    lifecycle: "active",
    description: "Get single tag by ID.",
    mutating: false,
    params: [
      { key: "id", type: "string", required: true, description: "Tag ID." },
    ],
    exampleParams: { id: "42" },
  },
  {
    toolId: "polymarket.gamma.tagBySlug",
    namespace: "polymarket",
    lifecycle: "active",
    description: "Get single tag by slug.",
    mutating: false,
    params: [
      { key: "slug", type: "string", required: true, description: "Tag slug." },
    ],
    exampleParams: { slug: "crypto" },
  },
  {
    toolId: "polymarket.gamma.relatedTags",
    namespace: "polymarket",
    lifecycle: "active",
    description: "Get related tag IDs for a tag by ID.",
    mutating: false,
    params: [
      { key: "id", type: "string", required: true, description: "Tag ID." },
      { key: "status", type: "string", description: "Filter by status." },
    ],
    exampleParams: { id: "42" },
  },
  {
    toolId: "polymarket.gamma.relatedTagsBySlug",
    namespace: "polymarket",
    lifecycle: "active",
    description: "Get related tag IDs for a tag by slug.",
    mutating: false,
    params: [
      { key: "slug", type: "string", required: true, description: "Tag slug." },
      { key: "status", type: "string", description: "Filter by status." },
    ],
    exampleParams: { slug: "crypto" },
  },
  {
    toolId: "polymarket.gamma.tagsRelatedToTag",
    namespace: "polymarket",
    lifecycle: "active",
    description: "Get full tag objects related to a tag by ID.",
    mutating: false,
    params: [
      { key: "id", type: "string", required: true, description: "Tag ID." },
      { key: "status", type: "string", description: "Filter by status." },
    ],
    exampleParams: { id: "42" },
  },
  {
    toolId: "polymarket.gamma.tagsRelatedToTagBySlug",
    namespace: "polymarket",
    lifecycle: "active",
    description: "Get full tag objects related to a tag by slug.",
    mutating: false,
    params: [
      { key: "slug", type: "string", required: true, description: "Tag slug." },
      { key: "status", type: "string", description: "Filter by status." },
    ],
    exampleParams: { slug: "crypto" },
  },

  // ── Series (2) ────────────────────────────────────────────────

  {
    toolId: "polymarket.gamma.series",
    namespace: "polymarket",
    lifecycle: "active",
    description: "List event series — grouped recurring events.",
    mutating: false,
    params: [
      { key: "closed", type: "boolean", description: "Include closed series." },
    ],
    exampleParams: {},
  },
  {
    toolId: "polymarket.gamma.seriesById",
    namespace: "polymarket",
    lifecycle: "active",
    description: "Get single series by ID with nested events.",
    mutating: false,
    params: [
      { key: "id", type: "string", required: true, description: "Series ID." },
    ],
    exampleParams: { id: "123" },
  },

  // ── Comments (3) ──────────────────────────────────────────────

  {
    toolId: "polymarket.gamma.comments",
    namespace: "polymarket",
    lifecycle: "active",
    description: "Browse comments on Polymarket — filter by entity type, entity ID, holders only.",
    mutating: false,
    params: [
      { key: "parentEntityType", type: "string", description: "Entity type: event, market." },
      { key: "parentEntityId", type: "number", description: "Entity ID." },
      { key: "holdersOnly", type: "boolean", description: "Only comments from token holders." },
      { key: "limit", type: "number", description: "Max results." },
    ],
    exampleParams: { parentEntityType: "event", parentEntityId: 12345 },
  },
  {
    toolId: "polymarket.gamma.comment",
    namespace: "polymarket",
    lifecycle: "active",
    description: "Get single comment by ID.",
    mutating: false,
    params: [
      { key: "id", type: "string", required: true, description: "Comment ID." },
    ],
    exampleParams: { id: "789" },
  },
  {
    toolId: "polymarket.gamma.commentsByUser",
    namespace: "polymarket",
    lifecycle: "active",
    description: "Get comments by a specific user address.",
    mutating: false,
    params: [
      { key: "address", type: "string", required: true, description: "User wallet address." },
      { key: "limit", type: "number", description: "Max results." },
      { key: "offset", type: "number", description: "Pagination offset." },
    ],
    exampleParams: { address: "0x1234..." },
  },

  // ── Profiles (1) ──────────────────────────────────────────────

  {
    toolId: "polymarket.gamma.profile",
    namespace: "polymarket",
    lifecycle: "active",
    description: "Get public profile — name, pseudonym, bio, X username, verified badge.",
    mutating: false,
    params: [
      { key: "address", type: "string", required: true, description: "User wallet address." },
    ],
    exampleParams: { address: "0x1234..." },
  },

  // ── Sports (3) ────────────────────────────────────────────────

  {
    toolId: "polymarket.gamma.sportsMetadata",
    namespace: "polymarket",
    lifecycle: "active",
    description: "Get sports categories metadata — sport names, images, resolutions.",
    mutating: false,
    params: [],
    exampleParams: {},
  },
  {
    toolId: "polymarket.gamma.sportsMarketTypes",
    namespace: "polymarket",
    lifecycle: "active",
    description: "Get available sports market types (e.g. moneyline, spread, total).",
    mutating: false,
    params: [],
    exampleParams: {},
  },
  {
    toolId: "polymarket.gamma.teams",
    namespace: "polymarket",
    lifecycle: "active",
    description: "List sports teams with league, record, logo.",
    mutating: false,
    params: [
      { key: "league", type: "string", description: "Filter by league (comma-separated for multiple)." },
      { key: "limit", type: "number", description: "Max results." },
    ],
    exampleParams: { league: "NBA" },
  },
];
