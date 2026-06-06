/**
 * Polymarket Gamma manifest FAÇADE (A-037 structural split).
 *
 * The original single `GAMMA_TOOLS` array was split into per-resource chunk
 * modules under `./gamma/` (events / markets / search / tags / series /
 * comments / profile / sports). Every manifest object was moved VERBATIM — no
 * field edits. This façade re-assembles the SAME `GAMMA_TOOLS` export,
 * preserving the EXACT original toolId order (array order is observable: the
 * catalog registers tools by iteration order). The chunk spread order below
 * reproduces the original sequence byte-for-byte; the surface test pins it.
 *
 * Importer (unchanged): `./manifest.ts` → `import { GAMMA_TOOLS } from "./manifests/gamma.js"`.
 */

import type { ProtocolToolManifest } from "../../types.js";
import { GAMMA_EVENT_TOOLS } from "./gamma/events.js";
import { GAMMA_MARKET_TOOLS } from "./gamma/markets.js";
import { GAMMA_SEARCH_TOOLS } from "./gamma/search.js";
import { GAMMA_TAG_TOOLS } from "./gamma/tags.js";
import { GAMMA_SERIES_TOOLS } from "./gamma/series.js";
import { GAMMA_COMMENT_TOOLS } from "./gamma/comments.js";
import { GAMMA_PROFILE_TOOLS } from "./gamma/profile.js";
import { GAMMA_SPORTS_TOOLS } from "./gamma/sports.js";

export const GAMMA_TOOLS: readonly ProtocolToolManifest[] = [
  ...GAMMA_EVENT_TOOLS,
  ...GAMMA_MARKET_TOOLS,
  ...GAMMA_SEARCH_TOOLS,
  ...GAMMA_TAG_TOOLS,
  ...GAMMA_SERIES_TOOLS,
  ...GAMMA_COMMENT_TOOLS,
  ...GAMMA_PROFILE_TOOLS,
  ...GAMMA_SPORTS_TOOLS,
];
