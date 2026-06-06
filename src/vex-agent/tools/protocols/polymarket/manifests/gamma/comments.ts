import type { ProtocolToolManifest } from "../../../types.js";
import { POLYMARKET_GAMMA_DISCOVERY } from "../../../embeddings/polymarket/gamma.js";

// ── Comments (3) ──────────────────────────────────────────────

export const GAMMA_COMMENT_TOOLS: readonly ProtocolToolManifest[] = [
  {
    toolId: "polymarket.gamma.comments",
    namespace: "polymarket",
    lifecycle: "active",
    description: "Browse comments on Polymarket — filter by entity type, entity ID, holders only. Pagination and sorting.",
    mutating: false,
    actionKind: "read",
    params: [
      { key: "parentEntityType", type: "string", description: "Entity type: Event, Series, market." },
      { key: "parentEntityId", type: "number", description: "Entity ID." },
      { key: "holdersOnly", type: "boolean", description: "Only comments from token holders." },
      { key: "getPositions", type: "boolean", description: "Include position data." },
      { key: "limit", type: "number", description: "Max results." },
      { key: "offset", type: "number", description: "Pagination offset." },
      { key: "order", type: "string", description: "Sort field." },
      { key: "ascending", type: "boolean", description: "Ascending sort." },
    ],
    exampleParams: { parentEntityType: "Event", parentEntityId: 12345 },
    discovery: POLYMARKET_GAMMA_DISCOVERY["polymarket.gamma.comments"],
  },
  {
    toolId: "polymarket.gamma.comment",
    namespace: "polymarket",
    lifecycle: "active",
    description: "Get single comment by ID.",
    mutating: false,
    actionKind: "read",
    params: [
      { key: "id", type: "string", required: true, description: "Comment ID." },
      { key: "getPositions", type: "boolean", description: "Include position data." },
    ],
    exampleParams: { id: "789" },
    discovery: POLYMARKET_GAMMA_DISCOVERY["polymarket.gamma.comment"],
  },
  {
    toolId: "polymarket.gamma.commentsByUser",
    namespace: "polymarket",
    lifecycle: "active",
    description: "Get comments by a specific user address with pagination and sorting.",
    mutating: false,
    actionKind: "read",
    params: [
      { key: "address", type: "string", required: true, description: "User wallet address." },
      { key: "limit", type: "number", description: "Max results." },
      { key: "offset", type: "number", description: "Pagination offset." },
      { key: "order", type: "string", description: "Sort field." },
      { key: "ascending", type: "boolean", description: "Ascending sort." },
    ],
    exampleParams: { address: "0x1234..." },
    discovery: POLYMARKET_GAMMA_DISCOVERY["polymarket.gamma.commentsByUser"],
  },
];
