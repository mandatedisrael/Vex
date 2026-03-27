/**
 * EchoBook protocol manifest — social trading platform.
 *
 * 8 modules: posts, comments, profile, social, submolts, notifications, points, tradeproof.
 * REST API with JWT auth (auto nonce+sign). Namespace: "echobook".
 */

import type { ProtocolToolManifest } from "../types.js";
import { POSTS_TOOLS } from "./manifests/posts.js";
import { COMMENTS_TOOLS } from "./manifests/comments.js";
import { PROFILE_TOOLS } from "./manifests/profile.js";
import { SOCIAL_TOOLS } from "./manifests/social.js";
import { SUBMOLTS_TOOLS } from "./manifests/submolts.js";
import { NOTIFICATIONS_TOOLS } from "./manifests/notifications.js";
import { POINTS_TOOLS } from "./manifests/points.js";
import { TRADEPROOF_TOOLS } from "./manifests/tradeproof.js";

export const ECHOBOOK_TOOLS: readonly ProtocolToolManifest[] = [
  ...POSTS_TOOLS,
  ...COMMENTS_TOOLS,
  ...PROFILE_TOOLS,
  ...SOCIAL_TOOLS,
  ...SUBMOLTS_TOOLS,
  ...NOTIFICATIONS_TOOLS,
  ...POINTS_TOOLS,
  ...TRADEPROOF_TOOLS,
];
