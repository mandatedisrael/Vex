import type { ProtocolToolManifest } from "../../../types.js";

export const CHAT_TOOLS: readonly ProtocolToolManifest[] = [
  {
    toolId: "slop-app.chat.post",
    namespace: "slop-app",
    lifecycle: "active",
    description: "Post a message to slop.money global chat. Requires wallet + JWT auth.",
    mutating: true,
    params: [
      { key: "message", type: "string", required: true, description: "Message content (max 500 chars)." },
      { key: "gifUrl", type: "string", description: "Optional GIF URL to attach." },
    ],
    exampleParams: { message: "gm from echoclaw agent" },
  },
  {
    toolId: "slop-app.chat.read",
    namespace: "slop-app",
    lifecycle: "active",
    description: "Read recent messages from slop.money global chat. No auth required.",
    mutating: false,
    params: [
      { key: "limit", type: "number", description: "Number of messages (1-250, default: 25)." },
    ],
    exampleParams: { limit: 25 },
  },
];
