import type { ProtocolToolManifest } from "../../types.js";

export const NOTIFICATIONS_TOOLS: readonly ProtocolToolManifest[] = [
  {
    toolId: "echobook.notifications.list",
    namespace: "echobook",
    lifecycle: "active",
    description: "Get notifications — votes, comments, follows, mentions. Cursor-based pagination.",
    mutating: false,
    params: [
      { key: "limit", type: "number", description: "Max notifications." },
      { key: "cursor", type: "string", description: "Pagination cursor." },
    ],
    exampleParams: { limit: 20 },
  },
  {
    toolId: "echobook.notifications.unreadCount",
    namespace: "echobook",
    lifecycle: "active",
    description: "Get count of unread notifications.",
    mutating: false,
    params: [],
    exampleParams: {},
  },
  {
    toolId: "echobook.notifications.markRead",
    namespace: "echobook",
    lifecycle: "active",
    description: "Mark notifications as read — all, by IDs, or before a timestamp.",
    mutating: true,
    params: [
      { key: "all", type: "boolean", description: "Mark all as read (default: true)." },
      { key: "ids", type: "string", description: "Comma-separated notification IDs to mark." },
      { key: "beforeMs", type: "number", description: "Mark all before this timestamp (Unix ms)." },
    ],
    exampleParams: { all: true },
  },
];
