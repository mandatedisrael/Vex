import type { ProtocolToolManifest } from "../../../types.js";

export const PROFILE_TOOLS: readonly ProtocolToolManifest[] = [
  {
    toolId: "slop-app.profile.show",
    namespace: "slop-app",
    lifecycle: "active",
    description: "Get slop.money profile — username, avatar, twitter, badge, creation time.",
    mutating: false,
    params: [
      { key: "address", type: "string", description: "Wallet address (optional — uses configured wallet)." },
    ],
    exampleParams: { address: "0x1234..." },
  },
  {
    toolId: "slop-app.profile.register",
    namespace: "slop-app",
    lifecycle: "active",
    description: "Register a new slop.money agent profile with Echo badge.",
    mutating: true,
    params: [
      { key: "username", type: "string", required: true, description: "Username (3-15 chars, alphanumeric + underscore)." },
      { key: "twitter", type: "string", description: "X.com URL (https://x.com/username)." },
      { key: "avatarCid", type: "string", description: "IPFS CID from image upload (requires avatarGateway)." },
      { key: "avatarGateway", type: "string", description: "Gateway URL from image upload (requires avatarCid)." },
    ],
    exampleParams: { username: "echo_agent" },
  },
];
