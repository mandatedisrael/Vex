/**
 * Agent copilot dock (design spec §4.5, zone `dock`, full height). Chat never
 * disappears in the mode — it docks here as the right-side copilot. This REUSES
 * the existing chat surface (`SessionPanel` + its transcript, tool cards, risk
 * cards, approvals, and composer) rather than forking it, so the docked session
 * is the SAME session the normal shell shows; entering/leaving the mode never
 * drops chat context.
 *
 * Glass chrome comes from the HvZone wrapper (design spec §13.1); this
 * component owns content only. The composer inside keeps its own sanctioned
 * glass.
 */

import type { JSX } from "react";

import { useUiStore } from "../../../stores/uiStore.js";
import { MissionRail } from "../MissionRail.js";
import { SessionPanel } from "../SessionPanel.js";

export function HypervexingCopilotDock(): JSX.Element {
  // Same activeSessionId the rest of the workspace reads. MissionRail self-gates
  // to null for non-mission / plan-off sessions, so passing it always is safe.
  const activeSessionId = useUiStore((s) => s.activeSessionId);
  return (
    <aside className="flex min-h-0 flex-1 flex-col" aria-label="Vex copilot">
      {/* No status header row: the whole dock belongs to the conversation.
          The engine tape state stays visible in the normal shell only.

          The mission contract/plan badges — and the Accept & Start surface they
          open — live in the normal shell's DESK RULE header, which this
          workspace replaces. Without them a mission drafted inside the room
          strands on the "contract not accepted" notice with no way to accept.
          We surface the SAME `MissionRail` on the docked chat's title row via
          SessionContext's content-agnostic `trailing` slot (no mode awareness
          added to the shared panel/header). */}
      <div className="min-h-0 flex-1">
        <SessionPanel
          headerTrailing={<MissionRail activeSessionId={activeSessionId} />}
        />
      </div>
    </aside>
  );
}
