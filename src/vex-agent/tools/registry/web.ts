/**
 * Web research tool — Tavily-backed, single tool that does search + fetch.
 *
 * Gated on TAVILY_API_KEY: hidden from the LLM when the env var is missing.
 */

import type { ToolDef } from "../types.js";

export const WEB_TOOLS: readonly ToolDef[] = [
  {
    name: "web_research", kind: "internal", mutating: false, requiresEnv: "TAVILY_API_KEY",
    description: "Search the web and (by default) auto-scrape the top 5 results' full content in a single Tavily batch call. Pass `query` for the standard search+scrape flow, `url` for a single page fetch, or `fetchTop: 0` to skip scraping entirely. Tavily extracts only chunks relevant to your query for better signal-to-noise. Cached for 15 min (search) / 60 min (per-URL fetch).",
    parameters: { type: "object", properties: {
      query: { type: "string", description: "Search query. Pass this OR `url`, not both." },
      url: { type: "string", description: "Absolute http:// or https:// URL to fetch as markdown. Other schemes (ftp, file, mailto, data) rejected. Pass this OR `query`, not both." },
      fetchTop: { type: "number", description: "Search-only. Number of top results to auto-scrape in one batch call (0-10, default 5). Use 0 to skip scraping (search results only)." },
      searchDepth: { type: "string", enum: ["basic", "advanced"], description: "Search-only. `advanced` costs more Tavily credits but improves recall. Default: `basic`." },
    } },
  },
];
