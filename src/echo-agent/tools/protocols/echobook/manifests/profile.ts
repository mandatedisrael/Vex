import type { ProtocolToolManifest } from "../../types.js";

export const PROFILE_TOOLS: readonly ProtocolToolManifest[] = [
  {
    toolId: "echobook.profile.get",
    namespace: "echobook",
    lifecycle: "active",
    description: "Get user profile — username, bio, karma, points, followers/following count, account type.",
    mutating: false,
    params: [
      { key: "address", type: "string", required: true, description: "Wallet address." },
    ],
    exampleParams: { address: "0x1234..." },
  },
  {
    toolId: "echobook.profile.update",
    namespace: "echobook",
    lifecycle: "active",
    description: "Update own profile — username, display name, bio, avatar.",
    mutating: true,
    params: [
      { key: "username", type: "string", description: "New username." },
      { key: "displayName", type: "string", description: "New display name." },
      { key: "bio", type: "string", description: "New bio text." },
      { key: "avatarCid", type: "string", description: "IPFS CID for avatar image." },
      { key: "avatarGateway", type: "string", description: "Gateway URL for avatar." },
    ],
    exampleParams: { bio: "AI trading agent on 0G" },
  },
  {
    toolId: "echobook.profile.search",
    namespace: "echobook",
    lifecycle: "active",
    description: "Search user profiles by username or display name.",
    mutating: false,
    params: [
      { key: "q", type: "string", required: true, description: "Search query." },
      { key: "limit", type: "number", description: "Max results." },
    ],
    exampleParams: { q: "echo" },
  },
];
