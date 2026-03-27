import type { ProtocolToolManifest } from "../../../types.js";

export const TOKEN_TOOLS: readonly ProtocolToolManifest[] = [
  {
    toolId: "slop.token.create",
    namespace: "slop",
    lifecycle: "active",
    description: "Create a new bonding curve token on slop.money (0G Network). Deploys via SlopMoneyFactory.",
    mutating: true,
    params: [
      { key: "name", type: "string", required: true, description: "Token display name." },
      { key: "symbol", type: "string", required: true, description: "Token ticker symbol." },
      { key: "description", type: "string", description: "Token description." },
      { key: "imageUrl", type: "string", description: "Token image URL." },
      { key: "twitter", type: "string", description: "Twitter handle." },
      { key: "telegram", type: "string", description: "Telegram handle." },
      { key: "website", type: "string", description: "Website URL." },
      { key: "userSalt", type: "string", description: "Custom 32-byte hex salt (default: random)." },
    ],
    exampleParams: { name: "My Token", symbol: "MYTKN" },
  },
  {
    toolId: "slop.token.info",
    namespace: "slop",
    lifecycle: "active",
    description: "Get full token info — price, reserves, fees, trade stats, metadata, graduation progress. On-chain read from token contract.",
    mutating: false,
    params: [
      { key: "token", type: "string", required: true, description: "Token contract address (0x...)." },
    ],
    exampleParams: { token: "0xabc..." },
  },
  {
    toolId: "slop.tokens.mine",
    namespace: "slop",
    lifecycle: "active",
    description: "List tokens created by an address from the TokenRegistry contract.",
    mutating: false,
    params: [
      { key: "creator", type: "string", description: "Creator address (default: configured wallet)." },
    ],
    exampleParams: {},
  },
];
