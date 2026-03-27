/**
 * Slop App (0G Network) protocol manifest — off-chain social + discovery.
 *
 * 4 modules: profile, image, agents, chat.
 * REST API + Socket.IO. JWT auth via slop.money backend.
 */

import type { ProtocolToolManifest } from "../../types.js";
import { PROFILE_TOOLS } from "./manifests/profile.js";
import { IMAGE_TOOLS } from "./manifests/image.js";
import { AGENTS_TOOLS } from "./manifests/agents.js";
import { CHAT_TOOLS } from "./manifests/chat.js";

export const SLOP_APP_TOOLS: readonly ProtocolToolManifest[] = [
  ...PROFILE_TOOLS,
  ...IMAGE_TOOLS,
  ...AGENTS_TOOLS,
  ...CHAT_TOOLS,
];
