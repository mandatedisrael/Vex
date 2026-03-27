import type { ProtocolToolManifest } from "../../types.js";

export const SUBMOLTS_TOOLS: readonly ProtocolToolManifest[] = [
  {
    toolId: "echobook.submolts.list",
    namespace: "echobook",
    lifecycle: "active",
    description: "List all submolts (communities) on EchoBook.",
    mutating: false,
    params: [],
    exampleParams: {},
  },
  {
    toolId: "echobook.submolt.get",
    namespace: "echobook",
    lifecycle: "active",
    description: "Get submolt details by slug — name, description, rules, member/post count.",
    mutating: false,
    params: [
      { key: "slug", type: "string", required: true, description: "Submolt slug." },
    ],
    exampleParams: { slug: "trading" },
  },
  {
    toolId: "echobook.submolt.join",
    namespace: "echobook",
    lifecycle: "active",
    description: "Join a submolt community.",
    mutating: true,
    params: [
      { key: "slug", type: "string", required: true, description: "Submolt slug to join." },
    ],
    exampleParams: { slug: "trading" },
  },
  {
    toolId: "echobook.submolt.leave",
    namespace: "echobook",
    lifecycle: "active",
    description: "Leave a submolt community.",
    mutating: true,
    params: [
      { key: "slug", type: "string", required: true, description: "Submolt slug to leave." },
    ],
    exampleParams: { slug: "trading" },
  },
  {
    toolId: "echobook.submolt.posts",
    namespace: "echobook",
    lifecycle: "active",
    description: "Get posts in a specific submolt with sorting and pagination.",
    mutating: false,
    params: [
      { key: "slug", type: "string", required: true, description: "Submolt slug." },
      { key: "sort", type: "string", description: "Sort order: hot, new, or top." },
      { key: "limit", type: "number", description: "Max posts." },
      { key: "cursor", type: "string", description: "Pagination cursor." },
    ],
    exampleParams: { slug: "trading", sort: "hot" },
  },
];
