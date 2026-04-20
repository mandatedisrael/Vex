/**
 * Autonomy tools — cross-cutting primitives for mission active runs and
 * standalone full-autonomous sessions. Neither "mission" nor "subagent"
 * fits: `loop_defer` lives here because it's the only tool that encodes
 * "sleep until" semantics for both runtime kinds.
 *
 * Visibility contract (enforced by `getOpenAITools` via `ToolVisibility`):
 *   - `requiresMissionActiveRun: true` is satisfied by EITHER an active
 *     mission run (`missionRunActive === true`) OR a standalone
 *     full-autonomous session (`sessionKind === "full_autonomous"`).
 *     That keeps the tool out of chat, mission setup, and subagent surfaces
 *     without needing a second flag.
 *   - `excludeRoles: ["subagent"]` is defense in depth — a child subagent
 *     that somehow ended up with the tool name should still be rejected at
 *     dispatch.
 *   - `excludeFromMcp: true` — MCP has no runtime / autonomy concept.
 *
 * Contract reminders for the model (PR-5 plan §7):
 *   - `reason` is an INTERNAL resume hint, not a user-facing message. It
 *     surfaces later as the wake banner + `effectiveRecallSeed` input
 *     (PR-10). Do NOT put the user-visible explanation here.
 *   - The user-facing explanation of why the agent is deferring MUST go in
 *     the normal `assistant.content`. A plain text reply WITHOUT a
 *     `loop_defer` call does NOT park the mission — engine continues the
 *     next iteration.
 *   - Exactly one of `after_ms` or `wake_at` — handler rejects both / neither.
 */

import type { ToolDef } from "../types.js";

export const AUTONOMY_TOOLS: readonly ToolDef[] = [
  {
    name: "checkpoint_handoff_prepare",
    kind: "internal",
    mutating: true,
    excludeRoles: ["subagent"],
    excludeFromMcp: true,
    visibility: { band: "warning" },
    description:
      "Prepare a handoff note that will seed recall AFTER the next checkpoint compacts the prompt. " +
      "Call this the moment you see the context-pressure warning (≥ 80%) so the post-compact turn can recover the right memories, entities, and open loops instead of starting blind. " +
      "Bounded Zod schema enforces: preserve_md ≤ 2000 chars, preferred_recall_query ≤ 500 chars, up to 20 important_entities / open_loops each. " +
      "Latest call supersedes any earlier handoff for the same pending checkpoint — a fresh call is always safe.",
    parameters: {
      type: "object",
      properties: {
        preserve_md: {
          type: "string",
          description:
            "Free-form note (≤ 2000 chars) about what MUST survive compaction — the model's own view of which facts / decisions / plan steps would be lost if the rolling summary drops them. Merged into the summary prompt.",
        },
        preferred_recall_query: {
          type: "string",
          description:
            "Seed query (≤ 500 chars) used by recall after compaction. Should describe what the next turn will need to know, not what just happened.",
        },
        important_entities: {
          type: "string",
          description:
            "JSON array of entity identifiers (≤ 20 items, each ≤ 100 chars) to prioritise in recall: wallet addresses, symbols, mission ids, protocol names.",
        },
        open_loops: {
          type: "string",
          description:
            "JSON array of unresolved follow-ups (≤ 20 items, each ≤ 200 chars) — steps, questions, or watchpoints the next turn should not lose.",
        },
      },
      required: ["preserve_md", "preferred_recall_query", "important_entities", "open_loops"],
    },
  },
  {
    name: "loop_defer",
    kind: "internal",
    mutating: false,
    excludeRoles: ["subagent"],
    excludeFromMcp: true,
    visibility: { requiresMissionActiveRun: true },
    description:
      "Pause the current mission run or full-autonomous session until a wake time. " +
      "Use this when you have nothing productive to do right now but should resume later (waiting for a blockchain finality window, a price feed update, a scheduled check). " +
      "The user-facing explanation goes in the normal assistant message content; `reason` here is an internal resume hint for the wake banner. " +
      "Specify exactly one of `after_ms` (relative) or `wake_at` (absolute ISO8601). Only one pending wake per session — calling again before the first fires is a no-op.",
    parameters: {
      type: "object",
      properties: {
        after_ms: {
          type: "number",
          description:
            "Relative wake delay in milliseconds. Must be between 1000 (1s) and 86_400_000 (24h). Exactly one of after_ms / wake_at is required.",
        },
        wake_at: {
          type: "string",
          description:
            "Absolute wake time as an ISO8601 timestamp (e.g. 2026-04-20T10:00:00Z). Must be in the future. Exactly one of after_ms / wake_at is required.",
        },
        reason: {
          type: "string",
          description:
            "Internal resume hint (≤ 500 chars). NOT shown to the user. Surfaces later as the wake banner and feeds the recall seed.",
        },
      },
      required: ["reason"],
    },
  },
];
