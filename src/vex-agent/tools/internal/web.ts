/**
 * Web internal tool handlers — search + fetch via Tavily with cache.
 *
 * Cache backed by vex-agent's own DB (search_cache, fetch_cache).
 */

import { tavily } from "@tavily/core";
import * as searchRepo from "@vex-agent/db/repos/search.js";
import type { ToolResult } from "../types.js";
import type { InternalToolContext } from "./types.js";
import { str, ok, fail } from "./types.js";
import logger from "@utils/logger.js";

const DEFAULT_SEARCH_LIMIT = 5;
const FETCH_TIMEOUT_MS = 15_000;

function getTavilyClient(): ReturnType<typeof tavily> | null {
  const key = process.env.TAVILY_API_KEY;
  if (!key) return null;
  return tavily({ apiKey: key });
}

// ── web_search ──────────────────────────────────────────────────

export async function handleWebSearch(
  params: Record<string, unknown>,
  _context: InternalToolContext,
): Promise<ToolResult> {
  const query = str(params, "query");
  if (!query) return fail("Missing required parameter: query");

  // Check cache
  const cached = await searchRepo.getCached(query);
  if (cached) {
    logger.debug("web.search.cache_hit", { query: query.slice(0, 50) });
    return ok({ count: cached.length, results: cached });
  }

  const client = getTavilyClient();
  if (!client) {
    logger.warn("web.search.no_api_key", { hint: "Set TAVILY_API_KEY for web search" });
    return fail("Web search unavailable — TAVILY_API_KEY not configured");
  }

  try {
    // SDK timeout in seconds (1-60). Tavily's own default is 60s; we cap at
    // 30s so a slow upstream cannot wedge a turn for the full window. Repo
    // pattern: every other HTTP client uses fetchWithTimeout / AbortSignal
    // (rule 10.7); this brings web_search in line.
    const response = await client.search(query, { maxResults: DEFAULT_SEARCH_LIMIT, timeout: 30 });
    const results: searchRepo.SearchResult[] = (response.results ?? []).map(r => ({
      title: r.title ?? "",
      url: r.url ?? "",
      content: r.content ?? "",
    }));

    await searchRepo.cacheResult(query, results);
    logger.debug("web.search.completed", { count: results.length, query: query.slice(0, 50) });
    return ok({ count: results.length, results });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn("web.search.failed", { error: msg });
    return fail(`Web search failed: ${msg}`);
  }
}

// ── web_fetch ───────────────────────────────────────────────────

export async function handleWebFetch(
  params: Record<string, unknown>,
  _context: InternalToolContext,
): Promise<ToolResult> {
  const url = str(params, "url");
  if (!url) return fail("Missing required parameter: url");
  if (!url.startsWith("http://") && !url.startsWith("https://")) return fail("Invalid URL — must start with http:// or https://");

  // Check cache
  const cached = await searchRepo.getCachedFetch(url);
  if (cached) {
    logger.debug("web.fetch.cache_hit", { url: url.slice(0, 60) });
    const content = `# ${cached.title ?? "Fetched page"}\n\nSource: ${url}\n\n${cached.markdown}`;
    return ok({ title: cached.title, url, content });
  }

  // Try Tavily extract first
  const client = getTavilyClient();
  if (client) {
    try {
      // Tavily's default extract timeout is 10s (basic) / 30s (advanced).
      // We pin 25s so basic depth still has runway before the SDK fires.
      const response = await client.extract([url], { timeout: 25 });
      const extracted = response.results?.[0];
      if (extracted?.rawContent) {
        const titleMatch = extracted.rawContent.match(/^#\s+(.+)$/m);
        const title = titleMatch?.[1] ?? null;
        await searchRepo.cacheFetchResult(url, extracted.rawContent, title);
        const content = `# ${title ?? "Fetched page"}\n\nSource: ${url}\n\n${extracted.rawContent}`;
        return ok({ title, url, content });
      }
    } catch (err) {
      logger.debug("web.fetch.tavily_failed", { error: err instanceof Error ? err.message : String(err) });
    }
  }

  // Fallback: simple HTTP fetch
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Vex/2.0" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return fail(`Fetch failed: HTTP ${res.status}`);

    const text = await res.text();
    const titleMatch = text.match(/<title[^>]*>([^<]+)<\/title>/i);
    const title = titleMatch?.[1]?.trim() ?? null;
    const markdown = text.slice(0, 50_000);

    await searchRepo.cacheFetchResult(url, markdown, title);
    const content = `# ${title ?? "Fetched page"}\n\nSource: ${url}\n\n${markdown}`;
    return ok({ title, url, content });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return fail(`Fetch failed: ${msg}`);
  }
}
