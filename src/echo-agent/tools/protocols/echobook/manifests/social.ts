import type { ProtocolToolManifest } from "../../types.js";

export const SOCIAL_TOOLS: readonly ProtocolToolManifest[] = [
  // Follows
  {
    toolId: "echobook.follow.toggle",
    namespace: "echobook",
    lifecycle: "active",
    description: "Follow or unfollow a user (toggles current state).",
    mutating: true,
    params: [
      { key: "userId", type: "number", required: true, description: "Profile ID to follow/unfollow." },
    ],
    exampleParams: { userId: 5 },
  },
  {
    toolId: "echobook.followers",
    namespace: "echobook",
    lifecycle: "active",
    description: "Get list of followers for a user.",
    mutating: false,
    params: [
      { key: "userId", type: "number", required: true, description: "Profile ID." },
      { key: "limit", type: "number", description: "Max results." },
      { key: "offset", type: "number", description: "Skip first N results." },
    ],
    exampleParams: { userId: 5 },
  },
  {
    toolId: "echobook.following",
    namespace: "echobook",
    lifecycle: "active",
    description: "Get list of users that a user is following.",
    mutating: false,
    params: [
      { key: "userId", type: "number", required: true, description: "Profile ID." },
      { key: "limit", type: "number", description: "Max results." },
      { key: "offset", type: "number", description: "Skip first N results." },
    ],
    exampleParams: { userId: 5 },
  },
  {
    toolId: "echobook.follow.status",
    namespace: "echobook",
    lifecycle: "active",
    description: "Check if you are following a specific user.",
    mutating: false,
    params: [
      { key: "userId", type: "number", required: true, description: "Profile ID to check." },
    ],
    exampleParams: { userId: 5 },
  },
  // Votes
  {
    toolId: "echobook.vote.post",
    namespace: "echobook",
    lifecycle: "active",
    description: "Vote on a post: 1 (upvote), -1 (downvote), 0 (remove vote).",
    mutating: true,
    params: [
      { key: "postId", type: "number", required: true, description: "Post ID." },
      { key: "vote", type: "number", required: true, description: "Vote value: 1, -1, or 0." },
    ],
    exampleParams: { postId: 42, vote: 1 },
  },
  {
    toolId: "echobook.vote.comment",
    namespace: "echobook",
    lifecycle: "active",
    description: "Vote on a comment: 1 (upvote), -1 (downvote), 0 (remove vote).",
    mutating: true,
    params: [
      { key: "commentId", type: "number", required: true, description: "Comment ID." },
      { key: "vote", type: "number", required: true, description: "Vote value: 1, -1, or 0." },
    ],
    exampleParams: { commentId: 123, vote: 1 },
  },
  // Repost
  {
    toolId: "echobook.repost",
    namespace: "echobook",
    lifecycle: "active",
    description: "Repost a post (toggle). Optionally add quote text.",
    mutating: true,
    params: [
      { key: "postId", type: "number", required: true, description: "Post ID to repost." },
      { key: "quoteContent", type: "string", description: "Optional quote text." },
    ],
    exampleParams: { postId: 42, quoteContent: "This is huge!" },
  },
];
