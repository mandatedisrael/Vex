/**
 * Retrieval metadata for Polymarket gamma tools.
 *
 * Source-of-truth for both the lexical scorer (`discovery.ts`) and the
 * future dense-retrieval pipeline (EmbeddingGemma 300M → pgvector). Manifest
 * at `polymarket/manifests/gamma.ts` references entries by `toolId`.
 */

import type { ToolDiscoveryMetadata } from "../../types.js";
import { embeddingText } from "../../_embedding-text.js";
import { POLYMARKET_CHAINS } from "../../polymarket/discovery-text.js";

export const POLYMARKET_GAMMA_DISCOVERY = {
  // ── Events (4) ────────────────────────────────────────────────

  "polymarket.gamma.events": {
    canonicalSummary:
      "Browse events on a Polymarket prediction market on Polygon — paginated, filterable by tag, status, liquidity, volume, date range.",
    embeddingText: embeddingText(
      `Browse events on Polymarket — a prediction market on Polygon — paginated and filterable by tag, status, liquidity, volume, start/end date, featured / archived / create-your-own-market flags, and recurrence. Each event carries its nested markets with current YES/NO prices, volume, and liquidity. ` +
      `Use this when the user wants to discover trending prediction markets, scan polymarket events by category, find what's hot this week, list elections / sports / crypto markets, or screen events by liquidity or volume thresholds. ` +
      `Example queries: browse trending polymarket events, what prediction markets are hot, list election markets on polymarket, top crypto prediction events, polymarket events with at least 100k liquidity, sports events ending this week. ` +
      `Read-only.`,
    ),
    aliases: [
      "prediction market", "polymarket",
      "polymarket events", "browse events",
      "trending markets", "featured events",
      "carousel tag", "tag id", "tag slug",
      "event listing",
    ],
    exampleIntents: [
      "browse trending polymarket events",
      "list election prediction markets",
      "polymarket events with at least 100k liquidity",
      "what crypto prediction markets are hot",
    ],
    preferredFor: ["browse events", "trending events", "filter events by tag"],
    chains: POLYMARKET_CHAINS,
  },

  "polymarket.gamma.event": {
    embeddingText: embeddingText(
      `Get a single event by numeric ID on Polymarket — a prediction market on Polygon — returning title, description, volume, liquidity, nested markets, and tags. ` +
      `Use this when the user already has the polymarket event ID and wants the full event payload, or when an upstream tool surfaced an event ID and you need to expand it. Pick the by-id variant over the by-slug sibling when the input is a numeric event ID. ` +
      `Example queries: get polymarket event 12345, fetch this prediction event by id, expand event id, look up event details by id. ` +
      `Read-only.`,
    ),
    aliases: [
      "prediction market", "polymarket",
      "polymarket event", "get event",
      "event by id", "event details",
    ],
    exampleIntents: [
      "get polymarket event by id",
      "fetch this prediction event by id",
      "expand event id 12345",
    ],
    chains: POLYMARKET_CHAINS,
  },

  "polymarket.gamma.eventBySlug": {
    embeddingText: embeddingText(
      `Get a single event by URL slug on Polymarket — a prediction market on Polygon — returning title, description, volume, liquidity, nested markets, and tags. ` +
      `Use this when the user pastes or references a polymarket event URL slug like "will-bitcoin-hit-100k" rather than a numeric ID — slug-shaped inputs route here over the by-id sibling. ` +
      `Example queries: get polymarket event by slug, look up will-bitcoin-hit-100k, fetch this event url, resolve event slug to details. ` +
      `Read-only.`,
    ),
    aliases: [
      "prediction market", "polymarket",
      "polymarket event", "event by slug",
      "by slug", "url slug", "event url",
    ],
    exampleIntents: [
      "get polymarket event by slug",
      "look up event will-bitcoin-hit-100k",
      "resolve event slug to details",
    ],
    chains: POLYMARKET_CHAINS,
  },

  "polymarket.gamma.eventTags": {
    embeddingText: embeddingText(
      `Get the tags attached to a single event on Polymarket — a prediction market on Polygon — by event ID. Tags categorize the event (crypto, sports, politics, carousel, etc.). ` +
      `Use this when the user wants to know what categories an event belongs to, find similar events by category, or build a tag-based filter from a known event. ` +
      `Example queries: tags for this polymarket event, what categories does this event belong to, list event tags, get event tag ids. ` +
      `Read-only.`,
    ),
    aliases: [
      "prediction market", "polymarket",
      "event tags", "event categories",
      "tag id", "carousel tag",
    ],
    exampleIntents: [
      "tags for this polymarket event",
      "what categories does this event belong to",
      "list polymarket event tags",
    ],
    chains: POLYMARKET_CHAINS,
  },

  // ── Markets (4) ───────────────────────────────────────────────

  "polymarket.gamma.markets": {
    canonicalSummary:
      "Browse markets within a Polymarket prediction market on Polygon — paginated, filterable by status, liquidity, volume, date range, sports, tag, with prices and CLOB token IDs.",
    embeddingText: embeddingText(
      `Browse markets on Polymarket — a prediction market on Polygon — paginated and filterable by status, liquidity, volume, date range, sports game / market type, condition ID, CLOB token ID, question ID, and tag. Each row carries the YES/NO prices, clobTokenIds, condition ID, and tag metadata needed before placing a CLOB order. ` +
      `Use this when the user wants to screen prediction markets, find liquid markets to bet on, list markets by sport / category, look up markets by condition id, or pull clobTokenIds for downstream order placement. ` +
      `Example queries: browse polymarket markets, screen markets with at least 50k liquidity, list NBA moneyline markets, find markets by condition id, pull clobTokenIds for these markets, sports markets ending today. ` +
      `Read-only — does not place a bet.`,
    ),
    aliases: [
      "prediction market", "polymarket",
      "browse markets", "polymarket markets",
      "market listing", "by condition id",
      "clob token id", "tag id",
      "screen markets", "parlay", "parlays",
    ],
    exampleIntents: [
      "browse polymarket markets",
      "screen prediction markets with high liquidity",
      "find markets by condition id",
      "list NBA moneyline markets on polymarket",
    ],
    preferredFor: ["browse markets", "screen markets", "list markets by tag"],
    avoidFor: ["my positions", "open positions"],
    chains: POLYMARKET_CHAINS,
  },

  "polymarket.gamma.market": {
    embeddingText: embeddingText(
      `Get a single market by condition ID (or numeric ID) on Polymarket — a prediction market on Polygon — returning question, outcomes, current YES/NO prices, clobTokenIds, neg risk flag, and tags. ` +
      `Use this when the user already has a condition id, hex market id, or numeric id and wants the full market payload, or when expanding a market reference returned by another tool. Pick the by-id variant over the by-slug sibling when the input looks like a hex condition id or numeric id. ` +
      `Example queries: get polymarket market by condition id, expand this 0xabc... market, fetch market details by id, look up clobTokenIds for this condition. ` +
      `Read-only.`,
    ),
    aliases: [
      "prediction market", "polymarket",
      "polymarket market", "get market",
      "by condition id", "condition id",
      "market details", "clob token id",
    ],
    exampleIntents: [
      "get polymarket market by condition id",
      "expand this 0xabc market",
      "fetch market details by id",
    ],
    chains: POLYMARKET_CHAINS,
  },

  "polymarket.gamma.marketBySlug": {
    embeddingText: embeddingText(
      `Get a single market by URL slug on Polymarket — a prediction market on Polygon — returning question, outcomes, current YES/NO prices, clobTokenIds, neg risk flag, and tags. ` +
      `Use this when the user pastes or references a polymarket market URL slug like "will-eth-hit-5000" rather than a hex condition id or numeric id — slug-shaped inputs route here over the by-id sibling. ` +
      `Example queries: get polymarket market by slug, look up will-eth-hit-5000, fetch this market url, resolve market slug to clobTokenIds. ` +
      `Read-only.`,
    ),
    aliases: [
      "prediction market", "polymarket",
      "polymarket market", "market by slug",
      "by slug", "url slug", "market url",
    ],
    exampleIntents: [
      "get polymarket market by slug",
      "look up market will-eth-hit-5000",
      "resolve market slug to clobTokenIds",
    ],
    chains: POLYMARKET_CHAINS,
  },

  "polymarket.gamma.marketTags": {
    embeddingText: embeddingText(
      `Get the tags attached to a single market on Polymarket — a prediction market on Polygon — by condition ID. Tags categorize the market (crypto, sports, politics, carousel, etc.). ` +
      `Use this when the user wants to know what categories a market belongs to, find similar markets by category, or build a tag-based filter from a known condition id. ` +
      `Example queries: tags for this polymarket market, what categories does this market belong to, list market tags, get market tag ids. ` +
      `Read-only.`,
    ),
    aliases: [
      "prediction market", "polymarket",
      "market tags", "market categories",
      "tag id", "by condition id",
    ],
    exampleIntents: [
      "tags for this polymarket market",
      "what categories does this market belong to",
      "list market tags",
    ],
    chains: POLYMARKET_CHAINS,
  },

  // ── Search (1) ────────────────────────────────────────────────

  "polymarket.gamma.search": {
    canonicalSummary:
      "Search events, tags, and profiles on a Polymarket prediction market on Polygon by free-text query — cross-entity, with status, tag, recurrence filters.",
    embeddingText: embeddingText(
      `Cross-entity full-text search on Polymarket — a prediction market on Polygon — across events, tags, and user profiles in one call. ` +
      `Use this when the user types a free-text query like "bitcoin" or "trump" or someone's pseudonym and wants matching events, tags, and profiles back without knowing which entity to look in. Best for natural-language lookups before drilling into a specific event or market. ` +
      `Example queries: search bitcoin market on polymarket, find trump prediction events, look up this user on polymarket, search election markets, find polymarket events about ethereum. ` +
      `Read-only.`,
    ),
    aliases: [
      "prediction market", "polymarket",
      "polymarket search", "search events",
      "find market", "search profiles",
      "free text search", "lookup",
    ],
    exampleIntents: [
      "search bitcoin market on polymarket",
      "find trump prediction events",
      "look up this user on polymarket",
      "search polymarket for election markets",
    ],
    preferredFor: ["search polymarket", "find market by name", "free-text lookup"],
    chains: POLYMARKET_CHAINS,
  },

  // ── Tags (7) ──────────────────────────────────────────────────

  "polymarket.gamma.tags": {
    embeddingText: embeddingText(
      `List the full taxonomy of tags (categories) on Polymarket — a prediction market on Polygon — with pagination, sorting, and an optional carousel-only filter. ` +
      `Use this when the user wants to discover what categories exist on polymarket, find a tag id to filter events or markets by, list carousel (front-page) tags, or build a category browser. ` +
      `Example queries: list polymarket categories, what tags exist on polymarket, show carousel tags, browse polymarket tag taxonomy, find tag id for crypto. ` +
      `Read-only.`,
    ),
    aliases: [
      "prediction market", "polymarket",
      "polymarket tags", "categories",
      "tag id", "carousel tag",
      "tag taxonomy",
    ],
    exampleIntents: [
      "list polymarket categories",
      "show carousel tags",
      "browse polymarket tag taxonomy",
    ],
    chains: POLYMARKET_CHAINS,
  },

  "polymarket.gamma.tag": {
    embeddingText: embeddingText(
      `Get a single tag (category) by numeric ID on Polymarket — a prediction market on Polygon — returning label, slug, carousel flag, and template data. ` +
      `Use this when the user already has a tag id and wants its full record, or when expanding a tag id surfaced by another tool. Pick the by-id variant over the by-slug sibling when the input is a numeric tag id. ` +
      `Example queries: get polymarket tag 42, fetch this tag by id, expand tag id, look up tag details by id. ` +
      `Read-only.`,
    ),
    aliases: [
      "prediction market", "polymarket",
      "polymarket tag", "get tag",
      "tag by id", "tag id",
      "carousel tag",
    ],
    exampleIntents: [
      "get polymarket tag by id",
      "fetch this tag by id 42",
      "expand tag id",
    ],
    chains: POLYMARKET_CHAINS,
  },

  "polymarket.gamma.tagBySlug": {
    embeddingText: embeddingText(
      `Get a single tag (category) by slug on Polymarket — a prediction market on Polygon — returning numeric ID, label, carousel flag, and template data. ` +
      `Use this when the user references a tag by its human-readable slug like "crypto" or "sports" rather than a numeric id — slug-shaped inputs route here over the by-id sibling, and this is the natural way to resolve a category name to its tag id. ` +
      `Example queries: get polymarket tag by slug, look up crypto tag, resolve sports slug to tag id, fetch this category by name. ` +
      `Read-only.`,
    ),
    aliases: [
      "prediction market", "polymarket",
      "polymarket tag", "tag by slug",
      "by slug", "tag slug", "category slug",
    ],
    exampleIntents: [
      "get polymarket tag by slug",
      "look up crypto tag",
      "resolve sports slug to tag id",
    ],
    chains: POLYMARKET_CHAINS,
  },

  "polymarket.gamma.relatedTags": {
    embeddingText: embeddingText(
      `Get the IDs of tags related to a given tag on Polymarket — a prediction market on Polygon — by numeric tag id, with active/closed/all status filtering. Returns just the related tag IDs, not the full tag objects. ` +
      `Use this when the user has a tag id and wants the lightweight list of nearby category ids for navigation, breadcrumbs, or a related-categories rail. Pick the by-id variant over the by-slug sibling when the input is a numeric tag id; pick this over tagsRelatedToTag when only the IDs are needed. ` +
      `Example queries: related tag ids for tag 42, nearby tags for this category by id, lightweight related tags. ` +
      `Read-only.`,
    ),
    aliases: [
      "prediction market", "polymarket",
      "related tags", "nearby tags",
      "tag id", "by id",
    ],
    exampleIntents: [
      "related tag ids for tag 42",
      "nearby tags for this category by id",
    ],
    chains: POLYMARKET_CHAINS,
  },

  "polymarket.gamma.relatedTagsBySlug": {
    embeddingText: embeddingText(
      `Get the IDs of tags related to a given tag on Polymarket — a prediction market on Polygon — by tag slug, with active/closed/all status filtering. Returns just the related tag IDs, not the full tag objects. ` +
      `Use this when the user references a category by slug like "crypto" or "sports" — slug-shaped inputs route here over the by-id sibling — and only needs the lightweight list of nearby tag ids for navigation or related-categories rails. ` +
      `Example queries: related tag ids for crypto slug, nearby tags by slug, lightweight related categories by slug. ` +
      `Read-only.`,
    ),
    aliases: [
      "prediction market", "polymarket",
      "related tags", "nearby tags",
      "by slug", "tag slug",
    ],
    exampleIntents: [
      "related tag ids for crypto slug",
      "nearby tags by slug",
    ],
    chains: POLYMARKET_CHAINS,
  },

  "polymarket.gamma.tagsRelatedToTag": {
    embeddingText: embeddingText(
      `Get the full tag objects (label, slug, carousel flag, template) for tags related to a given tag on Polymarket — a prediction market on Polygon — by numeric tag id, with active/closed/all status filtering. ` +
      `Use this when the user wants a fully-rendered list of related categories rather than just IDs. Pick the by-id variant over the by-slug sibling when the input is a numeric tag id; pick this over relatedTags when the consumer needs the full tag payload. ` +
      `Example queries: full related tags for tag 42, expand related categories by id, related tag objects. ` +
      `Read-only.`,
    ),
    aliases: [
      "prediction market", "polymarket",
      "related tags", "tag objects",
      "tag id", "by id",
    ],
    exampleIntents: [
      "full related tags for tag 42",
      "expand related categories by id",
    ],
    chains: POLYMARKET_CHAINS,
  },

  "polymarket.gamma.tagsRelatedToTagBySlug": {
    embeddingText: embeddingText(
      `Get the full tag objects (label, slug, carousel flag, template) for tags related to a given tag on Polymarket — a prediction market on Polygon — by tag slug, with active/closed/all status filtering. ` +
      `Use this when the user references a category by slug like "crypto" or "sports" — slug-shaped inputs route here over the by-id sibling — and wants a fully-rendered list of related categories rather than just IDs. ` +
      `Example queries: full related tags for crypto slug, expand related categories by slug, related tag objects by slug. ` +
      `Read-only.`,
    ),
    aliases: [
      "prediction market", "polymarket",
      "related tags", "tag objects",
      "by slug", "tag slug",
    ],
    exampleIntents: [
      "full related tags for crypto slug",
      "expand related categories by slug",
    ],
    chains: POLYMARKET_CHAINS,
  },

  // ── Series (2) ────────────────────────────────────────────────

  "polymarket.gamma.series": {
    embeddingText: embeddingText(
      `List event series on Polymarket — a prediction market on Polygon — where a series is a group of recurring events (weekly NFL games, monthly inflation prints, etc.). Filter by category, slug, recurrence, and open/closed status. ` +
      `Use this when the user wants to browse recurring polymarket events grouped together, find weekly or monthly cohorts of markets, or list series under a category. ` +
      `Example queries: list polymarket event series, browse weekly recurring markets, find monthly inflation series, polymarket sports series. ` +
      `Read-only.`,
    ),
    aliases: [
      "prediction market", "polymarket",
      "event series", "polymarket series",
      "recurring events", "weekly markets",
    ],
    exampleIntents: [
      "list polymarket event series",
      "browse weekly recurring markets",
      "find monthly inflation series",
    ],
    chains: POLYMARKET_CHAINS,
  },

  "polymarket.gamma.seriesById": {
    embeddingText: embeddingText(
      `Get a single event series by ID on Polymarket — a prediction market on Polygon — with all nested events expanded. ` +
      `Use this when the user already has a series id and wants the full series payload with its grouped recurring events. Pick the by-id variant when the input is a numeric series id. ` +
      `Example queries: get polymarket series by id, expand series 123, fetch this series with nested events. ` +
      `Read-only.`,
    ),
    aliases: [
      "prediction market", "polymarket",
      "event series", "series by id",
      "by id", "series id",
    ],
    exampleIntents: [
      "get polymarket series by id",
      "expand series 123",
      "fetch this series with nested events",
    ],
    chains: POLYMARKET_CHAINS,
  },

  // ── Comments (3) ──────────────────────────────────────────────

  "polymarket.gamma.comments": {
    embeddingText: embeddingText(
      `Browse comments on Polymarket — a prediction market on Polygon — filtered by parent entity type (Event / Series / market) and entity ID, with an optional holders-only filter and position-data join. ` +
      `Use this when the user wants to read what people are saying about a market or event, gauge sentiment from token holders, or pull comments on this market for analysis. ` +
      `Example queries: comments on this market, polymarket discussion for event 12345, holder-only comments, sentiment on this prediction market. ` +
      `Read-only.`,
    ),
    aliases: [
      "prediction market", "polymarket",
      "polymarket comments", "comments on this market",
      "discussion", "holder comments",
      "sentiment",
    ],
    exampleIntents: [
      "comments on this polymarket market",
      "polymarket discussion for event 12345",
      "holder-only comments on this market",
    ],
    chains: POLYMARKET_CHAINS,
  },

  "polymarket.gamma.comment": {
    embeddingText: embeddingText(
      `Get a single comment by ID on Polymarket — a prediction market on Polygon — with optional position-data join for the author. ` +
      `Use this when the user references a specific polymarket comment id and wants its full record, e.g. to expand a deep-link or show one quoted comment. ` +
      `Example queries: get polymarket comment 789, expand this comment by id, fetch comment details. ` +
      `Read-only.`,
    ),
    aliases: [
      "prediction market", "polymarket",
      "polymarket comment", "get comment",
      "comment by id", "by id",
    ],
    exampleIntents: [
      "get polymarket comment by id",
      "expand this comment by id",
    ],
    chains: POLYMARKET_CHAINS,
  },

  "polymarket.gamma.commentsByUser": {
    embeddingText: embeddingText(
      `Get all comments authored by one wallet address on Polymarket — a prediction market on Polygon — with pagination and sorting. ` +
      `Use this when the user wants to see everything a polymarket user has said, audit a trader's commentary across markets, or pull a profile-style comment feed for one address. ` +
      `Example queries: comments by this polymarket user, what has 0x1234 said on polymarket, polymarket comment history for this address. ` +
      `Read-only.`,
    ),
    aliases: [
      "prediction market", "polymarket",
      "user comments", "comments by user",
      "comment history", "polymarket profile",
    ],
    exampleIntents: [
      "comments by this polymarket user",
      "what has this address said on polymarket",
      "polymarket comment history for 0x1234",
    ],
    chains: POLYMARKET_CHAINS,
  },

  // ── Profiles (1) ──────────────────────────────────────────────

  "polymarket.gamma.profile": {
    embeddingText: embeddingText(
      `Get a public profile on Polymarket — a prediction market on Polygon — by wallet address. Returns display name, pseudonym, bio, X (Twitter) username, and verified-badge flag. ` +
      `Use this when the user wants to look up who an address is on polymarket, resolve a trader's display name, or pull profile metadata before showing positions or comments. ` +
      `Example queries: polymarket profile for 0x1234, who is this address on polymarket, get user display name, lookup polymarket pseudonym. ` +
      `Read-only.`,
    ),
    aliases: [
      "prediction market", "polymarket",
      "polymarket profile", "user profile",
      "display name", "pseudonym",
      "verified badge",
    ],
    exampleIntents: [
      "polymarket profile for 0x1234",
      "who is this address on polymarket",
      "get user display name on polymarket",
    ],
    chains: POLYMARKET_CHAINS,
  },

  // ── Sports (3) ────────────────────────────────────────────────

  "polymarket.gamma.sportsMetadata": {
    embeddingText: embeddingText(
      `Get sports category metadata on Polymarket — a prediction market on Polygon — listing each sport with its display name, image / logo, and image resolution variants. ` +
      `Use this when the user wants to render a sports category picker, list which sports polymarket covers, or pull sport logos for a UI. ` +
      `Example queries: sports categories on polymarket, list sport leagues, get sport logos, what sports does polymarket cover. ` +
      `Read-only.`,
    ),
    aliases: [
      "prediction market", "polymarket",
      "sports metadata", "sport league",
      "sport categories", "sport logos",
    ],
    exampleIntents: [
      "sports categories on polymarket",
      "list sport leagues on polymarket",
      "what sports does polymarket cover",
    ],
    chains: POLYMARKET_CHAINS,
  },

  "polymarket.gamma.sportsMarketTypes": {
    embeddingText: embeddingText(
      `Get the list of sports market types available on Polymarket — a prediction market on Polygon — covering moneyline, spread, total / over-under, and other game-line shapes. ` +
      `Use this when the user wants to know which bet types polymarket supports for sports, build a market-type filter, or map a user's sportsbook vocabulary onto the polymarket schema. ` +
      `Example queries: sports market types on polymarket, list moneyline spread total, what sports bet types are supported, polymarket sportsbook market shapes. ` +
      `Read-only.`,
    ),
    aliases: [
      "prediction market", "polymarket",
      "sports market types", "moneyline",
      "spread", "total", "over under",
      "sport league",
    ],
    exampleIntents: [
      "sports market types on polymarket",
      "what sports bet types are supported",
      "list moneyline spread total",
    ],
    chains: POLYMARKET_CHAINS,
  },

  "polymarket.gamma.teams": {
    embeddingText: embeddingText(
      `List sports teams on Polymarket — a prediction market on Polygon — with league, win/loss record, and team logo. Filter by league, full name, or abbreviation. ` +
      `Use this when the user wants to find a specific team to filter sports markets by, render a team logo, or build a team picker by league (NBA, NFL, MLB, etc.). ` +
      `Example queries: list NBA teams on polymarket, get team logo for lakers, find team by abbreviation lal, polymarket NFL teams, sport league teams. ` +
      `Read-only.`,
    ),
    aliases: [
      "prediction market", "polymarket",
      "sports teams", "team logo",
      "sport league", "team abbreviation",
      "team record",
    ],
    exampleIntents: [
      "list NBA teams on polymarket",
      "get team logo for lakers",
      "find team by abbreviation lal",
    ],
    chains: POLYMARKET_CHAINS,
  },
} satisfies Record<string, ToolDiscoveryMetadata>;

const EXPECTED_COUNT = 25;
if (Object.keys(POLYMARKET_GAMMA_DISCOVERY).length !== EXPECTED_COUNT) {
  throw new Error(
    `POLYMARKET_GAMMA_DISCOVERY has ${Object.keys(POLYMARKET_GAMMA_DISCOVERY).length} entries, expected ${EXPECTED_COUNT}.`,
  );
}
