/**
 * Twitter/X concise output projection (P0-5).
 *
 * The Rettiwt client returns verbose `ITweet` / `IUser` / `ISpace` payloads
 * (profile/banner image URLs, entities, pinned tweets, full participant lists)
 * that routinely push tool output past the 16 KiB overflow threshold while
 * carrying little signal for the agent. This module curates the output string
 * BEFORE `ok()` — the only lever, since the internal-tool `data` is dropped at
 * the batch loop and only the `output` string reaches the model (plan §6).
 *
 * `concise` is the DEFAULT; `detailed` returns the verbatim client output via a
 * `response_format` knob on the handler (see `twitter-account.ts`).
 *
 * The client output originates from an external API, so every field is treated
 * as possibly-missing: arrays/nested objects are narrowed defensively before
 * use rather than trusting the rettiwt-api static types.
 */

import type { TwitterAccountResult } from "@tools/twitter-account/types.js";

// ── Concise output shapes ────────────────────────────────────────

/** Shallow projection of a nested quoted/retweeted tweet (avoids re-inflation). */
export interface ConciseNestedTweet {
  id?: string;
  url?: string;
  author?: { userName?: string };
}

/** Lean per-tweet author (subset of IUser). */
export interface ConciseTweetAuthor {
  userName?: string;
  fullName?: string;
  followersCount?: number;
  isVerified?: boolean;
}

/** Concise tweet — drops entities/conversationId/replyTo/bookmarkCount. */
export interface ConciseTweet {
  id?: string;
  url?: string;
  createdAt?: string;
  fullText?: string;
  lang?: string;
  likeCount?: number;
  replyCount?: number;
  retweetCount?: number;
  quoteCount?: number;
  viewCount?: number;
  media: string[];
  author?: ConciseTweetAuthor;
  quoted?: ConciseNestedTweet;
  retweetedTweet?: ConciseNestedTweet;
}

/** Concise user (top-level user lists keep `description`). */
export interface ConciseUser {
  id?: string;
  userName?: string;
  fullName?: string;
  followersCount?: number;
  followingsCount?: number;
  isVerified?: boolean;
  description?: string;
}

/** Concise space — participant arrays dropped, only counts kept. */
export interface ConciseSpace {
  id?: string;
  state?: string;
  title?: string;
  createdAt?: string;
  startedAt?: string;
  endedAt?: string;
  creatorId?: string;
  participantCount?: number;
  totalLiveListeners?: number;
  adminsCount?: number;
  speakersCount?: number;
  listenersCount?: number;
}

// ── Defensive accessors (treat external data as untrusted) ───────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function optNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function optBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function optArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

// ── Field projectors ─────────────────────────────────────────────

/** Lean per-tweet author projection. */
export function projAuthor(u: unknown): ConciseTweetAuthor | undefined {
  if (!isRecord(u)) return undefined;
  return {
    userName: optString(u.userName),
    fullName: optString(u.fullName),
    followersCount: optNumber(u.followersCount),
    isVerified: optBoolean(u.isVerified),
  };
}

/** Shallow projection of a nested quoted/retweeted tweet — no recursion. */
function projNestedTweet(t: unknown): ConciseNestedTweet | undefined {
  if (!isRecord(t)) return undefined;
  const author = isRecord(t.tweetBy) ? { userName: optString(t.tweetBy.userName) } : undefined;
  return {
    id: optString(t.id),
    url: optString(t.url),
    author,
  };
}

/** Concise tweet projection; nested quoted/retweet shallow-projected. */
export function projTweet(t: unknown): ConciseTweet {
  if (!isRecord(t)) {
    return { media: [] };
  }
  const media = optArray(t.media)
    .map((m) => (isRecord(m) ? optString(m.type) : undefined))
    .filter((type): type is string => type !== undefined);

  const projected: ConciseTweet = {
    id: optString(t.id),
    url: optString(t.url),
    createdAt: optString(t.createdAt),
    fullText: optString(t.fullText),
    lang: optString(t.lang),
    likeCount: optNumber(t.likeCount),
    replyCount: optNumber(t.replyCount),
    retweetCount: optNumber(t.retweetCount),
    quoteCount: optNumber(t.quoteCount),
    viewCount: optNumber(t.viewCount),
    media,
    author: projAuthor(t.tweetBy),
  };

  const quoted = projNestedTweet(t.quoted);
  if (quoted) projected.quoted = quoted;
  const retweeted = projNestedTweet(t.retweetedTweet);
  if (retweeted) projected.retweetedTweet = retweeted;

  return projected;
}

/** Concise user projection — keeps `description` for top-level user lists. */
export function projUser(u: unknown): ConciseUser {
  if (!isRecord(u)) return {};
  const projected: ConciseUser = {
    id: optString(u.id),
    userName: optString(u.userName),
    fullName: optString(u.fullName),
    followersCount: optNumber(u.followersCount),
    followingsCount: optNumber(u.followingsCount),
    isVerified: optBoolean(u.isVerified),
  };
  const description = optString(u.description);
  if (description !== undefined) projected.description = description;
  return projected;
}

/** Concise space projection — participant arrays dropped, only counts kept. */
export function projSpace(s: unknown): ConciseSpace {
  if (!isRecord(s)) return {};
  const projected: ConciseSpace = {
    id: optString(s.id),
    state: optString(s.state),
    title: optString(s.title),
    createdAt: optString(s.createdAt),
    startedAt: optString(s.startedAt),
    endedAt: optString(s.endedAt),
    creatorId: optString(s.creatorId),
    participantCount: optNumber(s.participantCount),
    totalLiveListeners: optNumber(s.totalLiveListeners),
  };

  if (isRecord(s.participants)) {
    const p = s.participants;
    if (Array.isArray(p.admins)) projected.adminsCount = p.admins.length;
    if (Array.isArray(p.speakers)) projected.speakersCount = p.speakers.length;
    if (Array.isArray(p.listeners)) projected.listenersCount = p.listeners.length;
  }

  return projected;
}

// ── Result-level projection ──────────────────────────────────────

interface ConciseBase {
  action: string;
  rateLimit?: TwitterAccountResult["rateLimit"];
}

type ConciseTwitterResult =
  | (ConciseBase & { account: ConciseUser })
  | (ConciseBase & { user: ConciseUser })
  | (ConciseBase & { tweet: ConciseTweet })
  | (ConciseBase & { space: ConciseSpace })
  | (ConciseBase & { tweets: ConciseTweet[]; next: string })
  | (ConciseBase & { users: ConciseUser[]; next: string })
  // Fallback for an unexpected action: surface the raw data rather than drop it.
  | (ConciseBase & { data: unknown });

/** Actions whose cursored `items[]` are tweets. */
const TWEET_LIST_ACTIONS: ReadonlySet<string> = new Set([
  "tweet_search",
  "tweet_replies",
  "user_timeline",
  "user_replies",
]);

/** Actions whose cursored `items[]` are users. */
const USER_LIST_ACTIONS: ReadonlySet<string> = new Set([
  "tweet_likers",
  "tweet_retweeters",
  "user_search",
  "user_followers",
  "user_following",
]);

function nextCursor(data: Record<string, unknown>): string {
  return optString(data.next) ?? "";
}

/**
 * Project a Twitter/X client result into its concise shape. `action` drives the
 * shape; `rateLimit` and the cursor `next` are preserved. `data` is narrowed
 * defensively — the client output originates from an external API.
 *
 * When `format` is `'detailed'` callers should bypass this and return the
 * verbatim result; this function always produces the concise projection.
 */
export function projectTwitterResult(
  result: TwitterAccountResult,
  _format: "concise" | "detailed",
): ConciseTwitterResult {
  const base: ConciseBase = result.rateLimit
    ? { action: result.action, rateLimit: result.rateLimit }
    : { action: result.action };
  const data = isRecord(result.data) ? result.data : {};

  if (result.action === "account_status") {
    return { ...base, account: projUser(data.account) };
  }
  if (result.action === "user_details") {
    return { ...base, user: projUser(data.user) };
  }
  if (result.action === "tweet_details") {
    return { ...base, tweet: projTweet(data.tweet) };
  }
  if (result.action === "space_details") {
    return { ...base, space: projSpace(data.space) };
  }
  if (TWEET_LIST_ACTIONS.has(result.action)) {
    return {
      ...base,
      tweets: optArray(data.items).map(projTweet),
      next: nextCursor(data),
    };
  }
  if (USER_LIST_ACTIONS.has(result.action)) {
    return {
      ...base,
      users: optArray(data.items).map(projUser),
      next: nextCursor(data),
    };
  }

  // Unknown action — preserve the raw payload instead of silently dropping it.
  return { ...base, data: result.data };
}
