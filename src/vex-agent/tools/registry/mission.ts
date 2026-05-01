/**
 * Mission tools — vex-agent only. MCP has no mission concept
 * (`missionRunId` is always null in MCP context); hide via `surface: "agent"`.
 */

import type { ToolDef } from "../types.js";

export const MISSION_TOOLS: readonly ToolDef[] = [
  {
    name: "mission_stop", kind: "internal", mutating: false,
    excludeRoles: ["subagent"],
    surface: "agent",
    visibility: { hiddenInChat: true },
    description: "Stop the current mission run. Only valid during active mission execution. Use when a stop condition is met (goal reached, capital depleted, etc.).",
    parameters: { type: "object", properties: {
      reason: { type: "string", enum: ["goal_reached", "deadline_reached", "capital_depleted", "max_loss_hit", "no_viable_opportunity"], description: "Stop reason" },
      summary: { type: "string", description: "Concise explanation of why the mission should stop" },
      evidence: { type: "object", description: "Optional structured evidence / metrics" },
    }, required: ["reason", "summary"] },
  },
];
