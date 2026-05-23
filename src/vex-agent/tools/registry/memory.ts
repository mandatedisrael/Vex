/**
 * Memory tools — per-session narrative memory layer (PR2).
 *
 * Two tools:
 *   - `memory_recall`: semantic search over THIS session's narrative chunks
 *     produced by Track 2 of the compact pipeline. Always visible; the
 *     handler short-circuits when the session has no active chunks (the
 *     memory-state banner is the primary signal). pressureSafety read_only.
 *
 *   - `mark_outstanding_resolved`: close one outstanding item on a chunk.
 *     Updates the JSONB element, re-renders body_md, re-embeds. Always
 *     visible. pressureSafety read_only (the operation is small and
 *     bounded, and resolving outstanding items at pressure is a sensible
 *     pre-compact wrap-up).
 *
 * Both tools route through `tools/internal/memory/{recall,mark-resolved}.ts`.
 */

import type { ToolDef } from "../types.js";

export const MEMORY_TOOLS: readonly ToolDef[] = [
  {
    name: "memory_recall",
    kind: "internal",
    mutating: false,
    pressureSafety: "read_only",
    actionKind: "read",
    surface: "agent",
    description: [
      "Semantic recall over THIS SESSION's narrative memory chunks. Each chunk is a 4-section markdown body (what happened / what I did / what I tried / outstanding items) produced when the conversation was compacted by `compact_now`.",
      "Per-session only — does NOT reach earlier sessions. For durable cross-session lessons use `knowledge_recall`. For freeform scratchpad lookups use `document_read`.",
      "Use when you forgot what you tried earlier in this mission, want to avoid repeating a failed approach, or need to check past tool outcomes that no longer fit in the live transcript.",
      "Write SEMANTIC INTENT, not keywords.",
      "✓ \"previous attempts to debug Kyber quote timeout and what we learned\"",
      "✗ \"kyber\"",
      "✓ \"wallet balance checks earlier in the mission and their outcomes\"",
      "✗ \"balance\"",
      "Skip when the [Session memories: 0 chunks ...] banner appears — there is nothing to find before the first compact.",
      "Returns top-K chunks above the similarity threshold. Multilingual via EmbeddingGemma, but translating intent to English first usually improves retrieval.",
    ].join(" "),
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Semantic intent phrase (NOT keywords). Write the way you would ask another expert who knows the mission.",
        },
        k: {
          type: "number",
          description: "Max chunks to return (default 5, hard max 5).",
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "mark_outstanding_resolved",
    kind: "internal",
    mutating: false,
    pressureSafety: "read_only",
    actionKind: "local_write",
    surface: "agent",
    description: [
      "Close a single outstanding item on a session memory chunk. Use when a previously-open follow-up (pending tx, awaiting decision, lookup needed) is now done — keeps the resume packet's Outstanding section honest across compacts.",
      "memory_id is the chunk id from memory_recall output. outstanding_item_id is the UUID of the specific item to resolve (shown in the chunk's Outstanding section). resolution_note is a short (≤500-char) explanation persisted for audit and future recall.",
      "Bounded: resolving one item never affects siblings — chunks with multiple outstanding items remain partially open. The chunk's body_md is re-rendered and re-embedded so future memory_recall reflects the resolved state. Concurrent-resolution-safe (transactional row lock).",
      "Pressure-band rule: still callable at barrier/critical (read_only classification) because closing outstanding work is a sensible pre-compact wrap-up — it actually reduces resume-packet noise.",
    ].join(" "),
    parameters: {
      type: "object",
      properties: {
        memory_id: {
          type: "number",
          description: "Session memory chunk id (from memory_recall output).",
        },
        outstanding_item_id: {
          type: "string",
          description: "UUID v4 of the specific outstanding item to resolve.",
        },
        resolution_note: {
          type: "string",
          description: "Short note (≤500 chars) explaining how the item was resolved.",
        },
      },
      required: ["memory_id", "outstanding_item_id", "resolution_note"],
      additionalProperties: false,
    },
  },
];
