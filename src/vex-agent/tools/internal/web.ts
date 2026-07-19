/**
 * Web research handler — search + fetch in one tool, Tavily-backed, with cache.
 *
 * Branches by params:
 *   - `query` only             → search + auto-scrape top 5 (DEFAULT)
 *   - `query` + `fetchTop: 0`  → search-only (explicit opt-out)
 *   - `query` + `fetchTop: N`  → search + auto-scrape top N (1-10)
 *   - `url` only               → single-page fetch (http/https only)
 *
 * The auto-scrape path uses Tavily's batch extract: one API call for all
 * uncached URLs (server-side parallelization) with the original query
 * passed through for targeted chunk extraction.
 *
 * Validation lives in {@link WebResearchParams} so the boundary contract is
 * explicit (rule 20: validate at boundaries; rule 00.8: fail clearly).
 */

import { z } from "zod";
import { tavily } from "@tavily/core";
import * as searchRepo from "@vex-agent/db/repos/search.js";
import type { ToolResult } from "../types.js";
import type { InternalToolContext } from "./types.js";
import { ok, fail } from "./types.js";
import logger from "@utils/logger.js";

const DEFAULT_SEARCH_LIMIT = 10;   // search returns up to N results
const DEFAULT_FETCH_TOP = 5;       // auto-scrape top N when fetchTop is omitted
const MAX_FETCH_TOP = 10;          // hard cap per call (Tavily allows up to 20)
const SEARCH_TIMEOUT_S = 30;
const EXTRACT_TIMEOUT_S = 25;

// Zod's `z.string().url()` accepts every RFC-3986 scheme (ftp, file, mailto,
// data, …). Tavily and our HTTP fallback only handle http(s); guard explicitly.
function isHttpUrl(value: string): boolean {
  try {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

const WebResearchParams = z
  .object({
    query: z.string().trim().min(1).optional(),
    url: z
      .string()
      .trim()
      .url()
      .refine(isHttpUrl, { message: "URL must use http:// or https://" })
      .optional(),
    fetchTop: z.number().int().min(0).max(MAX_FETCH_TOP).optional(),
    searchDepth: z.enum(["basic", "advanced"]).optional(),
  })
  // Exactly-one-of (rejects both-set AND neither-set).
  .refine((p) => (p.query !== undefined) !== (p.url !== undefined), {
    message: "Provide exactly one of `query` or `url`",
  })
  // `fetchTop` and `searchDepth` are search-only knobs.
  .refine(
    (p) => !(p.url !== undefined && (p.fetchTop !== undefined || p.searchDepth !== undefined)),
    { message: "`fetchTop` and `searchDepth` apply only to `query` searches, not `url` fetches" },
  );

function getTavilyClient(): ReturnType<typeof tavily> | null {
  const key = process.env.TAVILY_API_KEY;
  if (!key) return null;
  return tavily({ apiKey: key });
}

// ── handler ──────────────────────────────────────────────────────

export async function handleWebResearch(
  params: Record<string, unknown>,
  _context: InternalToolContext,
): Promise<ToolResult> {
  const parsed = WebResearchParams.safeParse(params);
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    return fail(`web_research: ${firstIssue?.message ?? "invalid arguments"}`);
  }
  const { query, url, fetchTop, searchDepth } = parsed.data;

  // URL-only branch.
  if (url !== undefined) {
    return fetchUrl(url);
  }

  // Search branch (default: auto-scrape top DEFAULT_FETCH_TOP).
  // The XOR refine above guarantees `query` is defined here, but TypeScript
  // does not narrow through `.refine()` — make the precondition explicit.
  if (query === undefined) {
    return fail("web_research: provide exactly one of `query` or `url`");
  }
  const effectiveFetchTop = fetchTop !== undefined ? fetchTop : DEFAULT_FETCH_TOP;
  return searchAndOptionallyFetch(query, effectiveFetchTop, searchDepth);
}

// ── Single-page fetch (Tavily extract → raw HTTP fallback) ─────

/**
 * Cache writes are BEST-EFFORT: a failed local write must never discard a
 * usable provider result or masquerade as a Tavily failure — the content is
 * already in hand; only future cache hits are lost.
 */
async function cacheFetchBestEffort(url: string, markdown: string, title: string | null): Promise<void> {
  try {
    await searchRepo.cacheFetchResult(url, markdown, title);
  } catch (err) {
    logger.warn("web.fetch.cache_write_failed", {
      url: url.slice(0, 60),
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

type FetchedPage = {
  url: string;
  title: string | null;
  content: string;
  ok: boolean;
  error?: string;
};

async function fetchUrl(url: string): Promise<ToolResult> {
  const cached = await searchRepo.getCachedFetch(url);
  if (cached) {
    logger.debug("web.fetch.cache_hit", { url: url.slice(0, 60) });
    const content = `# ${cached.title ?? "Fetched page"}\n\nSource: ${url}\n\n${cached.markdown}`;
    return ok({ title: cached.title, url, content });
  }

  const client = getTavilyClient();
  if (!client) {
    // Defense-in-depth: the registry hides web_research without the key
    // (requiresEnv), so this branch is unreachable via visible tools.
    logger.warn("web.fetch.no_api_key", { hint: "Set TAVILY_API_KEY for web fetch" });
    return fail(
      "Web fetch unavailable — TAVILY_API_KEY not configured. The key is free (tavily.com); add it in Settings to enable web research.",
    );
  }
  {
    try {
      // Tavily's default extract timeout is 10s (basic) / 30s (advanced).
      // We pin 25s so basic depth still has runway before the SDK fires.
      const response = await client.extract([url], { timeout: EXTRACT_TIMEOUT_S });
      // Provider data is untrusted: accept ONLY a result for the URL we
      // requested — a planted result for a different URL must never be
      // served (nor cached under the requested key). Tavily's server-side
      // URL echo is undocumented (SDK verified as byte-verbatim passthrough,
      // 2026-07-19), so a mismatch here is at least as likely benign
      // normalization as an attack — the fail-safe response is an honest
      // fetch failure, never acceptance.
      const extracted = (response.results ?? []).find((r) => r.url === url);
      const mismatched = !extracted && (response.results?.length ?? 0) > 0;
      if (mismatched) {
        logger.warn("web.fetch.unrequested_result", { url: String(response.results?.[0]?.url ?? "").slice(0, 60) });
      }
      if (extracted?.rawContent) {
        const titleMatch = extracted.rawContent.match(/^#\s+(.+)$/m);
        const title = titleMatch?.[1] ?? null;
        await cacheFetchBestEffort(url, extracted.rawContent, title);
        const content = `# ${title ?? "Fetched page"}\n\nSource: ${url}\n\n${extracted.rawContent}`;
        return ok({ title, url, content });
      }
      // Tavily returned no usable content. Surface the explicit failure
      // reason when present. There is deliberately NO raw-HTTP fallback:
      // owner decision (2026-07-19) removed direct fetching from the
      // privileged process entirely — Tavily's infrastructure does the
      // fetching, which also removes the local SSRF surface (the concern
      // that briefly lived here as a destination policy).
      const failedResult = response.failedResults?.find((f) => f.url === url);
      const reason = failedResult ? failedResult.error : "no usable content returned";
      if (failedResult) {
        logger.warn("web.fetch.tavily_failed_explicit", {
          url: url.slice(0, 60),
          error: failedResult.error,
        });
      }
      return fail(`Fetch failed: ${reason}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.debug("web.fetch.tavily_failed", { error: msg });
      return fail(`Fetch failed: ${msg}`);
    }
  }
}

// ── Search (+ optional batch extract top N) ─────────────────────

// Exported as the regime worker's Tavily seam (S6b FIX-3 analog: an internal
// function, NOT a ToolDef/registry surface). The worker calls it with
// fetchTop=0 — snippets only: fewer credits, smaller injection surface.
export async function searchAndOptionallyFetch(
  query: string,
  fetchTop: number,
  searchDepth: "basic" | "advanced" | undefined,
): Promise<ToolResult> {
  // Search side — cache then API.
  const cached = await searchRepo.getCached(query);
  let results: searchRepo.SearchResult[];

  if (cached) {
    logger.debug("web.search.cache_hit", { query: query.slice(0, 50) });
    results = cached;
  } else {
    const client = getTavilyClient();
    if (!client) {
      logger.warn("web.search.no_api_key", { hint: "Set TAVILY_API_KEY for web search" });
      return fail("Web search unavailable — TAVILY_API_KEY not configured");
    }
    try {
      const response = await client.search(query, {
        maxResults: DEFAULT_SEARCH_LIMIT,
        timeout: SEARCH_TIMEOUT_S,
        ...(searchDepth ? { searchDepth } : {}),
      });
      results = (response.results ?? []).map((r) => ({
        title: r.title ?? "",
        url: r.url ?? "",
        content: r.content ?? "",
      }));
      try {
        await searchRepo.cacheResult(query, results);
      } catch (cacheErr) {
        // Best-effort: a failed cache write must not turn a successful
        // search into web.search.failed — the results are already in hand.
        logger.warn("web.search.cache_write_failed", {
          error: cacheErr instanceof Error ? cacheErr.message : String(cacheErr),
        });
      }
      logger.debug("web.search.completed", { count: results.length, query: query.slice(0, 50) });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn("web.search.failed", { error: msg });
      return fail(`Web search failed: ${msg}`);
    }
  }

  // Explicit opt-out: fetchTop=0 → return search-only payload (no scraping).
  if (fetchTop <= 0) {
    return ok({ count: results.length, results });
  }

  // Auto-fetch top N URLs via Tavily batch extract: one API call for all
  // uncached, http/https URLs (server-side parallel). Per-URL cache keeps
  // credit burn bounded on repeated/related queries.
  const targets = results.slice(0, Math.min(fetchTop, MAX_FETCH_TOP, results.length));
  const fetchedPages: FetchedPage[] = [];
  const uncachedUrls: string[] = [];
  // Dedup up front: search results can repeat an URL, and every consumer
  // below (extract call, batch-failure loop, no-key loop, outcome emission)
  // must see each URL exactly once.
  const seenTargets = new Set<string>();

  for (const target of targets) {
    if (!target.url) continue;
    if (seenTargets.has(target.url)) continue;
    seenTargets.add(target.url);
    if (!isHttpUrl(target.url)) {
      fetchedPages.push({
        url: target.url,
        title: null,
        content: "",
        ok: false,
        error: "Invalid URL — must use http:// or https://",
      });
      continue;
    }
    const cachedFetch = await searchRepo.getCachedFetch(target.url);
    if (cachedFetch) {
      const content = `# ${cachedFetch.title ?? "Fetched page"}\n\nSource: ${target.url}\n\n${cachedFetch.markdown}`;
      fetchedPages.push({
        url: target.url,
        title: cachedFetch.title,
        content,
        ok: true,
      });
    } else {
      uncachedUrls.push(target.url);
    }
  }

  if (uncachedUrls.length > 0) {
    const client = getTavilyClient();
    if (client) {
      try {
        // Targeted extract: pass `query` so Tavily filters chunks by relevance.
        const response = await client.extract(uncachedUrls, {
          timeout: EXTRACT_TIMEOUT_S,
          query,
        });

        // EXACTLY-ONCE accounting, keyed by what WE requested. The response
        // is provider data (untrusted until validated): duplicate entries,
        // an URL listed in both results and failedResults, or an URL we
        // never asked for must not multiply/poison outcomes or the cache.
        // Precedence is deterministic: a usable success beats any failure
        // report for the same URL; among duplicate successes the first wins.
        const requested = new Set(uncachedUrls); // already unique (deduped at collection)
        const outcomes = new Map<string, FetchedPage>();
        for (const r of response.results ?? []) {
          if (!requested.has(r.url)) {
            logger.warn("web.fetch.unrequested_result", { url: r.url.slice(0, 60) });
            continue; // never accept — and never cache — what we did not ask for
          }
          if (outcomes.get(r.url)?.ok) continue; // first success wins
          if (!r.rawContent) {
            // Still "accounted for" by Tavily — must not vanish: ok:false,
            // unless a duplicate already produced a real outcome.
            if (!outcomes.has(r.url)) {
              outcomes.set(r.url, { url: r.url, title: null, content: "", ok: false, error: "empty content from Tavily extract" });
            }
            continue;
          }
          const titleMatch = r.rawContent.match(/^#\s+(.+)$/m);
          const title = r.title ?? titleMatch?.[1] ?? null;
          await cacheFetchBestEffort(r.url, r.rawContent, title);
          const content = `# ${title ?? "Fetched page"}\n\nSource: ${r.url}\n\n${r.rawContent}`;
          outcomes.set(r.url, { url: r.url, title, content, ok: true }); // success overrides an earlier failure entry
        }
        for (const f of response.failedResults ?? []) {
          if (!requested.has(f.url)) {
            logger.warn("web.fetch.unrequested_failure", { url: f.url.slice(0, 60) });
            continue;
          }
          logger.warn("web.fetch.tavily_failed_explicit", {
            url: f.url.slice(0, 60),
            error: f.error,
          });
          if (outcomes.has(f.url)) continue; // success (or first report) wins
          outcomes.set(f.url, { url: f.url, title: null, content: "", ok: false, error: f.error });
        }
        // One outcome per requested URL, in request order; anything Tavily
        // left unmentioned is an honest failure (no raw-HTTP fallback exists
        // — owner decision: fetching happens only through Tavily).
        for (const url of [...requested]) {
          fetchedPages.push(
            outcomes.get(url) ?? { url, title: null, content: "", ok: false, error: "not returned by Tavily extract" },
          );
        }
      } catch (err) {
        // Whole batch failed (timeout, auth) — every URL reported as failed.
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn("web.fetch.tavily_batch_failed", { error: msg, count: uncachedUrls.length });
        for (const url of uncachedUrls) {
          fetchedPages.push({ url, title: null, content: "", ok: false, error: msg });
        }
      }
    } else {
      // No API key — fetching is unavailable (free key: tavily.com).
      for (const url of uncachedUrls) {
        fetchedPages.push({ url, title: null, content: "", ok: false, error: "TAVILY_API_KEY not configured" });
      }
    }
  }

  return ok({
    count: results.length,
    results,
    fetchedPages,
  });
}
