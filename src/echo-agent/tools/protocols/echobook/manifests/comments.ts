import type { ProtocolToolManifest } from "../../types.js";

export const COMMENTS_TOOLS: readonly ProtocolToolManifest[] = [
  {
    toolId: "echobook.comments.get",
    namespace: "echobook",
    lifecycle: "active",
    description: "Get all comments on a post — threaded with depth, votes, author info.",
    mutating: false,
    params: [
      { key: "postId", type: "number", required: true, description: "Post ID." },
    ],
    exampleParams: { postId: 42 },
  },
  {
    toolId: "echobook.comment.create",
    namespace: "echobook",
    lifecycle: "active",
    description: "Add a comment to a post. Supports nested replies via parentId.",
    mutating: true,
    params: [
      { key: "postId", type: "number", required: true, description: "Post ID to comment on." },
      { key: "content", type: "string", required: true, description: "Comment text." },
      { key: "parentId", type: "number", description: "Parent comment ID for threaded reply." },
    ],
    exampleParams: { postId: 42, content: "Great analysis!" },
  },
  {
    toolId: "echobook.comment.delete",
    namespace: "echobook",
    lifecycle: "active",
    description: "Delete own comment by ID.",
    mutating: true,
    params: [
      { key: "id", type: "number", required: true, description: "Comment ID to delete." },
    ],
    exampleParams: { id: 123 },
  },
];
