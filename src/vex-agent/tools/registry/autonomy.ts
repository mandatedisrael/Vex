/**
 * Autonomy tools — primitives for mission active runs. Post-M12 only the
 * mission runtime loops; `loop_defer` lives here because it's the only
 * tool that encodes "sleep until" semantics for the mission turn-loop.
 *
 * Visibility contract (enforced by `getOpenAITools` via `ToolVisibility`):
 *   - `requiresMissionActiveRun: true` requires `missionRunActive === true`.
 *     Agent mode (one-shot conversation) never loops and never sees
 *     `loop_defer`. Mission setup (no active run yet) also doesn't.
 *   - `excludeRoles: ["subagent"]` is defense in depth — a child subagent
 *     that somehow ended up with the tool name should still be rejected at
 *     dispatch.
 *   - `surface: "agent"` — MCP has no runtime / autonomy concept.
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
    name: "tool_output_read",
    kind: "internal",
    mutating: false,
    pressureSafety: "read_only",
    actionKind: "read",
    surface: "agent",
    visibility: { hiddenInMissionSetup: true },
    description:
      "Retrieve a bounded byte slice of a previously-overflowed tool output. " +
      "When a tool returns more than ~16 KiB, the engine stores the full output off-prompt and leaves a short stub with `blob_key=<key>` in the transcript. " +
      "Pass that `blob_key` here to read the payload in slices within the current session before the TTL expires. " +
      "Use `offset` / `max_bytes` to page through large JSON without re-reading the same blob.",
    parameters: {
      type: "object",
      properties: {
        blob_key: {
          type: "string",
          description:
            "The exact blob key shown in the overflow stub (format: `tob-<yyyymmdd>-<16hex>`).",
        },
        offset: {
          type: "integer",
          description:
            "Optional byte offset to start reading from. Defaults to 0. Use `next_offset` from the previous response to continue.",
        },
        max_bytes: {
          type: "integer",
          description:
            "Optional maximum bytes to return. The runtime caps this below the overflow threshold so reads stay inline.",
        },
      },
      required: ["blob_key"],
    },
  },
  {
    name: "loop_defer",
    kind: "internal",
    mutating: false,
    pressureSafety: "mutating",
    actionKind: "schedule",
    excludeRoles: ["subagent"],
    surface: "agent",
    visibility: { requiresMissionActiveRun: true },
    description:
      "Pause the current mission run until a wake time. " +
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
