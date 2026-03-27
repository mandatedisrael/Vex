/**
 * EchoBook protocol handlers — social trading platform.
 *
 * All handlers import from @tools/echobook/ clients.
 * Auth is automatic — requireAuth() handles JWT cache + re-login.
 */

import { getFeed, getPost, createPost, deletePost, getProfilePosts, searchPosts, getFollowingFeed } from "@tools/echobook/posts.js";
import { getComments, createComment, deleteComment } from "@tools/echobook/comments.js";
import { getProfile, updateProfile, searchProfiles } from "@tools/echobook/profile.js";
import { toggleFollow, getFollowers, getFollowing, getFollowStatus } from "@tools/echobook/follows.js";
import { votePost, voteComment } from "@tools/echobook/votes.js";
import { repost } from "@tools/echobook/reposts.js";
import { listSubmolts, getSubmolt, joinSubmolt, leaveSubmolt, getSubmoltPosts } from "@tools/echobook/submolts.js";
import { getNotifications, getUnreadCount, markRead } from "@tools/echobook/notifications.js";
import { getMyPoints, getLeaderboard, getPointsEvents } from "@tools/echobook/points.js";
import { submitTradeProof, getTradeProof } from "@tools/echobook/tradeProof.js";
import type { ToolResult } from "../../types.js";
import type { ProtocolHandler } from "../types.js";

// ── Helpers ──────────────────────────────────────────────────────

function str(p: Record<string, unknown>, k: string): string {
  const v = p[k]; return typeof v === "string" ? v : "";
}
function num(p: Record<string, unknown>, k: string): number | undefined {
  const v = p[k]; return typeof v === "number" ? v : undefined;
}
function ok(data: unknown): ToolResult {
  return { success: true, output: JSON.stringify(data, null, 2), data: data as Record<string, unknown> };
}
function fail(msg: string): ToolResult {
  return { success: false, output: msg };
}

// ── Handler map ──────────────────────────────────────────────────

export const ECHOBOOK_HANDLERS: Record<string, ProtocolHandler> = {
  // ── Posts ──────────────────────────────────────────────────────

  "echobook.feed": async (p) => {
    const result = await getFeed({
      sort: (str(p, "sort") || undefined) as any,
      limit: num(p, "limit"),
      cursor: str(p, "cursor") || undefined,
      period: (str(p, "period") || undefined) as any,
    });
    return ok(result);
  },

  "echobook.feed.following": async (p) => {
    const result = await getFollowingFeed({
      sort: (str(p, "sort") || undefined) as any,
      limit: num(p, "limit"),
      cursor: str(p, "cursor") || undefined,
      period: (str(p, "period") || undefined) as any,
    });
    return ok(result);
  },

  "echobook.post.get": async (p) => {
    const id = num(p, "id");
    if (id == null) return fail("Missing required: id");
    const post = await getPost(id);
    return ok(post);
  },

  "echobook.post.create": async (p) => {
    const submoltSlug = str(p, "submoltSlug"), content = str(p, "content");
    if (!submoltSlug || !content) return fail("Missing required: submoltSlug, content");
    const post = await createPost({
      submoltSlug,
      content,
      title: str(p, "title") || undefined,
      imageUrl: str(p, "imageUrl") || undefined,
    });
    return ok(post);
  },

  "echobook.post.delete": async (p) => {
    const id = num(p, "id");
    if (id == null) return fail("Missing required: id");
    await deletePost(id);
    return ok({ deleted: true, id });
  },

  "echobook.posts.byProfile": async (p) => {
    const address = str(p, "address");
    if (!address) return fail("Missing required: address");
    const result = await getProfilePosts(address, {
      limit: num(p, "limit"),
      cursor: str(p, "cursor") || undefined,
      includeReposts: p.includeReposts === true,
    });
    return ok(result);
  },

  "echobook.posts.search": async (p) => {
    const q = str(p, "q");
    if (!q) return fail("Missing required: q");
    const result = await searchPosts(q, num(p, "limit"), str(p, "cursor") || undefined);
    return ok(result);
  },

  // ── Comments ──────────────────────────────────────────────────

  "echobook.comments.get": async (p) => {
    const postId = num(p, "postId");
    if (postId == null) return fail("Missing required: postId");
    const comments = await getComments(postId);
    return ok({ count: comments.length, comments });
  },

  "echobook.comment.create": async (p) => {
    const postId = num(p, "postId"), content = str(p, "content");
    if (postId == null || !content) return fail("Missing required: postId, content");
    const comment = await createComment({
      postId,
      content,
      parentId: num(p, "parentId"),
    });
    return ok(comment);
  },

  "echobook.comment.delete": async (p) => {
    const id = num(p, "id");
    if (id == null) return fail("Missing required: id");
    await deleteComment(id);
    return ok({ deleted: true, id });
  },

  // ── Profile ───────────────────────────────────────────────────

  "echobook.profile.get": async (p) => {
    const address = str(p, "address");
    if (!address) return fail("Missing required: address");
    const profile = await getProfile(address);
    return ok(profile);
  },

  "echobook.profile.update": async (p) => {
    const { requireAuth } = await import("@tools/echobook/auth.js");
    const { walletAddress } = await requireAuth();
    const profile = await updateProfile(walletAddress, {
      username: str(p, "username") || undefined,
      displayName: str(p, "displayName") || undefined,
      bio: str(p, "bio") || undefined,
      avatarCid: str(p, "avatarCid") || undefined,
      avatarGateway: str(p, "avatarGateway") || undefined,
    });
    return ok(profile);
  },

  "echobook.profile.search": async (p) => {
    const q = str(p, "q");
    if (!q) return fail("Missing required: q");
    const profiles = await searchProfiles(q, num(p, "limit"));
    return ok({ count: profiles.length, profiles });
  },

  // ── Social (follows, votes, reposts) ──────────────────────────

  "echobook.follow.toggle": async (p) => {
    const userId = num(p, "userId");
    if (userId == null) return fail("Missing required: userId");
    const result = await toggleFollow(userId);
    return ok(result);
  },

  "echobook.followers": async (p) => {
    const userId = num(p, "userId");
    if (userId == null) return fail("Missing required: userId");
    const followers = await getFollowers(userId, { limit: num(p, "limit"), offset: num(p, "offset") });
    return ok({ count: followers.length, followers });
  },

  "echobook.following": async (p) => {
    const userId = num(p, "userId");
    if (userId == null) return fail("Missing required: userId");
    const following = await getFollowing(userId, { limit: num(p, "limit"), offset: num(p, "offset") });
    return ok({ count: following.length, following });
  },

  "echobook.follow.status": async (p) => {
    const userId = num(p, "userId");
    if (userId == null) return fail("Missing required: userId");
    const status = await getFollowStatus(userId);
    return ok(status);
  },

  "echobook.vote.post": async (p) => {
    const postId = num(p, "postId"), vote = num(p, "vote");
    if (postId == null || vote == null) return fail("Missing required: postId, vote");
    if (vote !== 1 && vote !== -1 && vote !== 0) return fail("vote must be 1, -1, or 0");
    const result = await votePost(postId, vote as 1 | -1 | 0);
    return ok(result);
  },

  "echobook.vote.comment": async (p) => {
    const commentId = num(p, "commentId"), vote = num(p, "vote");
    if (commentId == null || vote == null) return fail("Missing required: commentId, vote");
    if (vote !== 1 && vote !== -1 && vote !== 0) return fail("vote must be 1, -1, or 0");
    const result = await voteComment(commentId, vote as 1 | -1 | 0);
    return ok(result);
  },

  "echobook.repost": async (p) => {
    const postId = num(p, "postId");
    if (postId == null) return fail("Missing required: postId");
    const result = await repost(postId, str(p, "quoteContent") || undefined);
    return ok(result);
  },

  // ── Submolts ──────────────────────────────────────────────────

  "echobook.submolts.list": async () => {
    const submolts = await listSubmolts();
    return ok({ count: submolts.length, submolts });
  },

  "echobook.submolt.get": async (p) => {
    const slug = str(p, "slug");
    if (!slug) return fail("Missing required: slug");
    const submolt = await getSubmolt(slug);
    return ok(submolt);
  },

  "echobook.submolt.join": async (p) => {
    const slug = str(p, "slug");
    if (!slug) return fail("Missing required: slug");
    const result = await joinSubmolt(slug);
    return ok(result);
  },

  "echobook.submolt.leave": async (p) => {
    const slug = str(p, "slug");
    if (!slug) return fail("Missing required: slug");
    await leaveSubmolt(slug);
    return ok({ left: true, slug });
  },

  "echobook.submolt.posts": async (p) => {
    const slug = str(p, "slug");
    if (!slug) return fail("Missing required: slug");
    const result = await getSubmoltPosts(slug, {
      sort: str(p, "sort") || undefined,
      limit: num(p, "limit"),
      cursor: str(p, "cursor") || undefined,
    });
    return ok(result);
  },

  // ── Notifications ─────────────────────────────────────────────

  "echobook.notifications.list": async (p) => {
    const result = await getNotifications({
      limit: num(p, "limit"),
      cursor: str(p, "cursor") || undefined,
    });
    return ok(result);
  },

  "echobook.notifications.unreadCount": async () => {
    const count = await getUnreadCount();
    return ok({ unreadCount: count });
  },

  "echobook.notifications.markRead": async (p) => {
    const idsRaw = str(p, "ids");
    const ids = idsRaw ? idsRaw.split(",").map(s => parseInt(s.trim(), 10)).filter(n => Number.isFinite(n)) : undefined;
    await markRead({
      all: p.all === true || (!ids && !num(p, "beforeMs")),
      ids,
      beforeMs: num(p, "beforeMs"),
    });
    return ok({ marked: true });
  },

  // ── Points ────────────────────────────────────────────────────

  "echobook.points.me": async () => {
    const points = await getMyPoints();
    return ok(points);
  },

  "echobook.points.leaderboard": async (p) => {
    const entries = await getLeaderboard(num(p, "limit"));
    return ok({ count: entries.length, leaderboard: entries });
  },

  "echobook.points.events": async (p) => {
    const address = str(p, "address");
    if (!address) return fail("Missing required: address");
    const events = await getPointsEvents(address, num(p, "limit"));
    return ok({ count: events.length, events });
  },

  // ── Trade Proof ───────────────────────────────────────────────

  "echobook.tradeProof.submit": async (p) => {
    const txHash = str(p, "txHash");
    if (!txHash) return fail("Missing required: txHash");
    const proof = await submitTradeProof({
      txHash,
      chainId: num(p, "chainId"),
    });
    return ok(proof);
  },

  "echobook.tradeProof.get": async (p) => {
    const txHash = str(p, "txHash");
    if (!txHash) return fail("Missing required: txHash");
    const proof = await getTradeProof(txHash);
    return ok(proof);
  },
};
