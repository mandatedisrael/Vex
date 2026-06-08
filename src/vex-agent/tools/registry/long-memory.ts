/**
 * Long-term memory tools (memory v2) — the agent-facing write-door into
 * cross-session candidate memory.
 *
 * `long_memory_suggest` is the ONLY agent-facing write tool in the v2 memory
 * system (S2). It STAGES a candidate — it does NOT write memory directly — and
 * an async manager (S4) reviews, dedupes, and decides promotion. Namespaced
 * `long_memory_*` to stay distinct from per-session `memory_*` and the legacy
 * `knowledge_*` surface (which stays live until the S9 cutover).
 *
 * Classification rationale (memory-system/s2-plan.md §3):
 * - `mutating: false` — a LOCAL candidate write, NOT an approval-gated external
 *   mutation. `mutating: true` would wrongly trigger approval in restricted
 *   sessions (the dispatcher's internal mutating-approval gate); knowledge
 *   local-writes use `mutating: false` for the same reason.
 * - `pressureSafety: "mutating"` — still blocked at barrier/critical so the
 *   agent does not suggest while compaction is urgent (mirrors knowledge.ts).
 * - `actionKind: "local_write"` — mirrors knowledge_write.
 * - `visibility: {}` — always visible to parent AND subagent
 *   (`memory_candidates.proposed_by` supports both roles).
 */

import type { ToolDef } from "../types.js";

export const LONG_MEMORY_TOOLS: readonly ToolDef[] = [
  {
    name: "long_memory_suggest",
    kind: "internal",
    mutating: false,
    pressureSafety: "mutating",
    actionKind: "local_write",
    visibility: {},
    description: [
      // WHAT
      "Propose a durable, cross-session LESSON for long-term memory — a trading insight, a strategy/risk lesson, a stable user preference, or a project fact or constraint. Write title and summary in English (embedding retrieval is significantly stronger on English).",
      // HOW IT WORKS
      "This does NOT write memory directly. It STAGES a candidate; an async manager later reviews it, dedupes it, and decides whether to promote it into long-term memory. You get back a candidateId and status, not a stored memory.",
      // DO NOT (steering — reject policy advertised so you rarely trip it)
      "Never include secrets (keys, seeds, API tokens) — a candidate carrying one is REJECTED and nothing is stored. Do NOT record live values (current balances, prices, gas, amounts, open quotes) — memory is for the durable LESSON, not the snapshot, and a candidate that reads as live state is REJECTED. Wallet and transaction addresses are auto-masked, so the lesson survives without the raw value.",
      // EVIDENCE
      "Attach evidence_refs (protocol execution / capture ids, with optional instrumentKey / positionKey) when the lesson came from a real trade — it makes the lesson far stronger downstream. source_refs is pointer-only (messageIds / toolCallIds) provenance from this session.",
      // response_format
      "response_format: 'concise' (default) returns the candidate id + status; 'detailed' adds redaction counts, the derived source tier, and the dual-trace retrieval window.",
    ].join(" "),
    parameters: {
      type: "object",
      properties: {
        kind: {
          type: "string",
          description:
            "Free-form snake_case kind, English (e.g. trade_lesson, risk_rule, user_preference, protocol_fact). Reuse an existing kind before inventing a new one.",
        },
        title: {
          type: "string",
          description: "Single thesis or lesson, in English. Embedding input together with summary.",
        },
        summary: {
          type: "string",
          description:
            "1-3 sentences in English stating the durable lesson. This is the embedding input together with title — write for retrieval, not as a snapshot of live state.",
        },
        content_md: {
          type: "string",
          description: "Optional fuller markdown body in English (defaults to empty). Stored verbatim (after redaction).",
        },
        entities: {
          type: "array",
          items: { type: "string" },
          description: "Optional entity tokens this lesson is about (e.g. ['SOL', 'kyberswap']).",
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Optional string tags (e.g. ['risk', 'memecoin']).",
        },
        source_refs: {
          type: "object",
          description:
            "Pointer-only provenance from THIS session: { messageIds:[int], toolCallIds:[string] }. No free text.",
          properties: {
            messageIds: { type: "array", items: { type: "number" } },
            toolCallIds: { type: "array", items: { type: "string" } },
          },
          additionalProperties: false,
        },
        evidence_refs: {
          type: "array",
          description:
            "Immutable evidence anchors when the lesson came from a real trade. Each: { executionId:int (required), captureItemId:int?, instrumentKey:string?, positionKey:string? }.",
          items: {
            type: "object",
            properties: {
              executionId: { type: "number" },
              captureItemId: { type: "number" },
              instrumentKey: { type: "string" },
              positionKey: { type: "string" },
            },
            required: ["executionId"],
            additionalProperties: false,
          },
        },
        confidence: { type: "number", description: "Your confidence in the lesson, 0..1." },
        importance: { type: "number", description: "Importance 1..10 (default 5)." },
        event_time: {
          type: "string",
          description: "Optional ISO 8601 timestamp of when the underlying event happened.",
        },
        observed_at: {
          type: "string",
          description: "Optional ISO 8601 timestamp of when you observed the lesson.",
        },
        response_format: {
          type: "string",
          enum: ["concise", "detailed"],
          description: "concise (default) → id + status; detailed → adds redaction counts, source tier, dual-trace window.",
        },
      },
      required: ["kind", "title", "summary"],
      additionalProperties: false,
    },
  },
];
