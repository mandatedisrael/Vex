/**
 * Subagent tools — split into parent (spawn/status/stop/reply) and child
 * (request_parent / report_complete). `excludeRoles` enforces parent-only
 * vs child-only at registration time; the dispatcher hard-blocks at call time.
 *
 * TODO(subagent-disabled): all entries below are commented out — runtime
 * exposure of the subagent surface is paused. Re-enable in lockstep with
 * `INTERNAL_TOOL_LOADERS` in `tools/dispatcher.ts` (the `// Subagents` block)
 * to keep `registry-completeness.test.ts` symmetric.
 */

import type { ToolDef } from "../types.js";

export const SUBAGENT_TOOLS: readonly ToolDef[] = [
  /* TODO(subagent-disabled): re-enable razem z dispatcher loaders w tools/dispatcher.ts.
  // Parent tools
  {
    name: "subagent_spawn", kind: "internal", mutating: false,
    excludeRoles: ["subagent"],
    description: "Spawn a background subagent. Returns immediately. Use subagent_status to check progress.",
    parameters: { type: "object", properties: {
      name: { type: "string", description: "Vex-prefixed name (e.g. VexSpark, VexNibble)" },
      task: { type: "string", description: "Full task description with context and output location" },
      allow_trades: { type: "boolean", description: "Allow mutating/trading tools (default: false)" },
      max_iterations: { type: "number", description: "Max tool iterations (default: 25)" },
      scope_strategy: {
        type: "string",
        enum: ["isolated", "shared"],
        description:
          "Memory scope for the subagent (default: isolated). 'isolated' — own memory_scope_key, subagent sees no parent episodes. 'shared' — inherit parent's memory_scope_key, subagent writes contribute to parent's episode pool. Use 'shared' only when the subagent is a true delegate and the parent wants every checkpoint in its own recall.",
      },
    }, required: ["name", "task"] },
  },
  {
    name: "subagent_status", kind: "internal", mutating: false,
    excludeRoles: ["subagent"],
    description: "Check status and results of spawned subagents. Shows pending requests for waiting subagents.",
    parameters: { type: "object", properties: {
      id: { type: "string", description: "Subagent ID (omit for all)" },
    } },
  },
  {
    name: "subagent_stop", kind: "internal", mutating: false,
    excludeRoles: ["subagent"],
    description: "Stop a running subagent. Partial results preserved.",
    parameters: { type: "object", properties: {
      id: { type: "string", description: "Subagent ID" },
    }, required: ["id"] },
  },
  {
    name: "subagent_reply", kind: "internal", mutating: false,
    excludeRoles: ["subagent"],
    description: "Reply to a waiting subagent's request. Resumes the subagent.",
    parameters: { type: "object", properties: {
      id: { type: "string", description: "Subagent ID" },
      reply: { type: "string", description: "Your reply to the subagent's question" },
      message_id: { type: "number", description: "Original request message ID (from subagent_status pendingRequest)" },
    }, required: ["id", "reply"] },
  },

  // Child tools
  {
    name: "subagent_request_parent", kind: "internal", mutating: false,
    excludeRoles: ["parent"],
    description: "Request help from parent agent. Pauses this subagent until parent replies via subagent_reply.",
    parameters: { type: "object", properties: {
      question: { type: "string", description: "What you need from the parent" },
      context: { type: "string", description: "Additional context for the parent" },
    }, required: ["question"] },
  },
  {
    name: "subagent_report_complete", kind: "internal", mutating: false,
    excludeRoles: ["parent"],
    description: "Submit final structured report and end this subagent's execution. Saves report for parent to read via subagent_status.",
    parameters: { type: "object", properties: {
      summary: { type: "string", description: "Summary of findings/results" },
      findings: { type: "object", description: "Structured findings data" },
      success: { type: "boolean", description: "Whether the task was completed successfully (default: true)" },
    }, required: ["summary"] },
  },
  */
];
