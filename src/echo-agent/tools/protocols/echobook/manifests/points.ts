import type { ProtocolToolManifest } from "../../types.js";

export const POINTS_TOOLS: readonly ProtocolToolManifest[] = [
  {
    toolId: "echobook.points.me",
    namespace: "echobook",
    lifecycle: "active",
    description: "Get own points balance and today's earning breakdown (posts, comments, votes, trade proofs).",
    mutating: false,
    params: [],
    exampleParams: {},
  },
  {
    toolId: "echobook.points.leaderboard",
    namespace: "echobook",
    lifecycle: "active",
    description: "Get points leaderboard — top users by points balance.",
    mutating: false,
    params: [
      { key: "limit", type: "number", description: "Max entries." },
    ],
    exampleParams: { limit: 20 },
  },
  {
    toolId: "echobook.points.events",
    namespace: "echobook",
    lifecycle: "active",
    description: "Get points earning history for an address.",
    mutating: false,
    params: [
      { key: "address", type: "string", required: true, description: "Wallet address." },
      { key: "limit", type: "number", description: "Max events." },
    ],
    exampleParams: { address: "0x1234..." },
  },
];
