import type { ProtocolToolManifest } from "../../types.js";
import { DEXSCREENER_TRENDING_DISCOVERY } from "../../embeddings/dexscreener/trending.js";

export const TRENDING_TOOLS: readonly ProtocolToolManifest[] = [
  {
    toolId: "dexscreener.profiles",
    namespace: "dexscreener",
    lifecycle: "active",
    description: "Get latest trending token profiles — icons, descriptions, social links. Shows what projects are gaining attention.",
    mutating: false,
    params: [],
    exampleParams: {},
    discovery: DEXSCREENER_TRENDING_DISCOVERY["dexscreener.profiles"],
  },
  {
    toolId: "dexscreener.boosts",
    namespace: "dexscreener",
    lifecycle: "active",
    description: "Get latest boosted/promoted tokens with boost amounts. Paid visibility signal — shows where money is being spent on promotion.",
    mutating: false,
    params: [],
    exampleParams: {},
    discovery: DEXSCREENER_TRENDING_DISCOVERY["dexscreener.boosts"],
  },
  {
    toolId: "dexscreener.boosts.top",
    namespace: "dexscreener",
    lifecycle: "active",
    description: "Get tokens with most active boosts (top promoted). Ranked by total boost amount.",
    mutating: false,
    params: [],
    exampleParams: {},
    discovery: DEXSCREENER_TRENDING_DISCOVERY["dexscreener.boosts.top"],
  },
  {
    toolId: "dexscreener.communityTakeovers",
    namespace: "dexscreener",
    lifecycle: "active",
    description: "Get latest community takeover (CTO) events — tokens where community reclaimed control. Strong trading signal, often precedes price action.",
    mutating: false,
    params: [],
    exampleParams: {},
    discovery: DEXSCREENER_TRENDING_DISCOVERY["dexscreener.communityTakeovers"],
  },
  {
    toolId: "dexscreener.trending",
    namespace: "dexscreener",
    lifecycle: "active",
    description: "Unified trending view — merges token profiles and boosts into a single ranked list. Deduplicated, sorted by boost amount then profile presence.",
    mutating: false,
    params: [
      { key: "limit", type: "number", description: "Max results to return." },
    ],
    exampleParams: { limit: 20 },
    discovery: DEXSCREENER_TRENDING_DISCOVERY["dexscreener.trending"],
  },
];
