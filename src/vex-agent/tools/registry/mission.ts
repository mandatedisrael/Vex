/** Mission tools — only visible in mission setup/run contexts. */

import type { ToolDef } from "../types.js";

export const MISSION_TOOLS: readonly ToolDef[] = [
  {
    name: "mission_draft_update", kind: "internal", mutating: false, pressureSafety: "mutating", actionKind: "local_write",
    excludeRoles: ["subagent"],
    visibility: { requiresMissionSetup: true },
    description: "Save or update the mission draft during mission setup/edit. Call this before telling the user the mission draft is ready. response_format: 'concise' (default) returns missionId/status/ready/missingFields/nextAction; 'detailed' also echoes the full currentDraft.",
    parameters: { type: "object", properties: {
      response_format: { type: "string", enum: ["concise", "detailed"], description: "concise (default) → status + missingFields + nextAction; detailed → also echoes the full currentDraft." },
      title: { type: "string", description: "Short mission title" },
      goal: { type: "string", description: "Mission goal or objective" },
      capitalSource: { type: "string", description: "Where starting capital comes from" },
      startingCapital: { type: "string", description: "Starting capital amount and asset" },
      allowedWallets: { type: "array", items: { type: "string" }, description: "Wallet addresses or wallet identifiers allowed for the mission" },
      allowedChains: { type: "array", items: { type: "string" }, description: "Allowed chains" },
      allowedProtocols: { type: "array", items: { type: "string" }, description: "Allowed protocols or venues" },
      riskProfile: { type: "string", description: "Risk profile such as conservative, moderate, or aggressive" },
      successCriteria: { type: "array", items: { type: "string" }, description: "Concrete success criteria" },
      stopConditions: { type: "array", items: { type: "string" }, description: "Proposed non-success stop conditions for the contract. The user owns this list — propose, refine with the user, and save updates here. Final acceptance happens via the host Accept contract step, not in chat" },
      deadline: { type: "string", description: "Optional deadline, preferably ISO8601 or an absolute date/time with timezone" },
      durationMinutes: { type: "number", description: "The mission's time-box in whole minutes (e.g. 5, 60). The run auto-finalizes at started_at + this many minutes, regardless of progress. Set this from the goal's stated duration; if omitted, a 60-minute default applies." },
    }, additionalProperties: false },
  },
  {
    name: "mission_stop", kind: "internal", mutating: false, pressureSafety: "safe_at_barrier", actionKind: "local_write",
    excludeRoles: ["subagent"],
    visibility: { requiresMissionRun: true },
    description: "Stop the current mission run. Only valid during active mission execution. goal_reached is success; other non-emergency reasons must match the user-approved mission stopConditions.",
    parameters: { type: "object", properties: {
      reason: { type: "string", enum: ["goal_reached", "deadline_reached", "capital_depleted", "max_loss_hit", "no_viable_opportunity", "emergency_stop"], description: "Stop reason" },
      summary: { type: "string", description: "Concise explanation of why the mission should stop" },
      evidence: { type: "object", description: "Optional structured evidence / metrics" },
    }, required: ["reason", "summary"] },
  },
];
