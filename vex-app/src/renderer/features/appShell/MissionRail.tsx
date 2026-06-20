/**
 * MISSION RAIL — the fixed contextual column between the chat section and the
 * BOOK panel. It carries the mission/plan status KEYS (clickable
 * `PremiumBadge`s) that open the contract / plan review dialogs. The tall
 * contract + plan cards used to live inline in `SessionPanel`, which pushed
 * `MissionControls` + the Accept footer below the fold (the bug this rail
 * resolves); the rail keeps only the compact badges in the layout and moves the
 * full review surfaces into top-layer `<dialog>`s where the Accept action is
 * pinned and can never be scrolled away.
 *
 * Render gate (decided in the redesign plan): the rail renders only in the
 * active session view, and only when the session is mission-mode OR plan-mode
 * is enabled. A plain agent session with plan-mode off gets NO rail (render
 * nothing — never a broken empty frame). The gate is computed from the same
 * TanStack Query hooks the modals use, so the rail and modals always agree.
 *
 * Badge state derivation (§4 of the plan):
 *   - Mission badge mirrors the contract diff state machine
 *     (preparing / ready / accepted / stale), but "ready" additionally requires
 *     the plan to be ready when plan-mode is on — a `plan_missing` plan keeps
 *     the mission at "preparing" with a plan-needed hint (matches the engine
 *     `plan_missing` block in the modal footer).
 *   - Plan badge mirrors the plan state (preparing while authoring / ready while
 *     pending acceptance / accepted), and surfaces an "awaiting resume" stale
 *     marker when an accepted plan's run is parked.
 *
 * Modal open-state is local `useState` with MUTUAL EXCLUSION — opening one
 * closes the other so two dialogs never stack. The state is UI-ephemeral (never
 * persisted, never crosses IPC).
 *
 * Trust boundary: 100% renderer presentation over existing hooks. No new IPC,
 * no `src/vex-agent`/DB/wallet imports, and no plan CONTENT is read here — the
 * rail only derives badge states; the modals own the content render.
 */

import { useMemo, useState } from "react";
import type { JSX } from "react";
import type { Result } from "@shared/ipc/result.js";
import type {
  MissionDraftDto,
  MissionGetDiffResult,
} from "@shared/schemas/mission.js";
import type { PlanGetResult } from "@shared/schemas/session-plan.js";
import type { SessionListItem } from "@shared/schemas/sessions.js";
import { Target02Icon, Route01Icon } from "@hugeicons/core-free-icons";
import {
  useMissionDiff,
  useMissionDraft,
  useRenewableMissionSource,
} from "../../lib/api/mission.js";
import { useRuntimeState } from "../../lib/api/runtime.js";
import { useSession, useSessionPlan } from "../../lib/api/sessions.js";
import { MissionContractModal } from "./MissionContractModal.js";
import { PlanDisplayModal } from "./PlanDisplayModal.js";
import { PremiumBadge, type PremiumBadgeState } from "./PremiumBadge.js";

/** Which review dialog (if any) is open. Mutually exclusive. */
type OpenModal = "none" | "mission" | "plan";

export interface MissionRailProps {
  readonly activeSessionId: string | null;
}

export function MissionRail({
  activeSessionId,
}: MissionRailProps): JSX.Element | null {
  const sessionId = activeSessionId ?? "";
  const detailQuery = useSession(activeSessionId);
  const session = readSession(detailQuery.data);

  const draftQuery = useMissionDraft(activeSessionId);
  const draft = readDraft(draftQuery.data);
  const diffQuery = useMissionDiff(activeSessionId, draft?.missionId ?? null);
  const diff = readDiff(diffQuery.data);
  const planQuery = useSessionPlan(activeSessionId);
  const plan = readPlan(planQuery.data);

  const isMission = session?.mode === "mission";
  const planEnabled = plan?.enabled === true;
  // Gate: active session AND (mission-mode OR plan-enabled). A plain agent
  // session with plan-mode off earns no rail.
  const shouldRender =
    activeSessionId !== null && session !== null && (isMission || planEnabled);

  // Runtime + renewable-source reads, fired ONLY for mission sessions. Both
  // hooks coerce a null sessionId to "" and gate on length, so a non-mission
  // session passes null and fires no IPC. Placed unconditionally above the
  // early return to honour the rules of hooks.
  const runtimeQuery = useRuntimeState(isMission ? activeSessionId : null);
  const renewableQuery = useRenewableMissionSource(
    isMission ? activeSessionId : null,
  );
  // hasActiveRun: a running/paused run (mirrors MissionControls' runtime unwrap).
  const hasActiveRun =
    runtimeQuery.data?.ok === true && runtimeQuery.data.data.hasActiveRun === true;
  // hasRenewable: a non-null renewable source means a terminal accepted mission
  // exists (completed/failed/stopped/cancelled), proving the contract was accepted.
  const hasRenewable =
    renewableQuery.data?.ok === true && renewableQuery.data.data !== null;

  const [open, setOpen] = useState<OpenModal>("none");

  const mission = useMemo(
    () => deriveMissionBadge(isMission, draft, diff, plan, hasActiveRun, hasRenewable),
    [isMission, draft, diff, plan, hasActiveRun, hasRenewable],
  );
  const planBadge = useMemo(
    () => derivePlanBadge(plan, session?.missionStatus ?? null),
    [plan, session?.missionStatus],
  );

  if (!shouldRender) return null;

  // Mission setup (mission-mode, no run started yet) accepts the plan TOGETHER
  // with the contract via the unified `mission.acceptContract` step — withhold
  // the plan modal's standalone "Accept plan" to avoid two competing accepts.
  const suppressPlanAccept =
    isMission && (session?.missionStatus ?? null) === null;

  return (
    <aside
      data-vex-area="mission-rail"
      aria-label="Mission and plan status"
      className="flex w-[200px] shrink-0 flex-col gap-3 border-l border-[var(--vex-line)] p-3"
    >
      {mission !== null ? (
        <PremiumBadge
          label="Mission"
          icon={Target02Icon}
          state={mission.state}
          shimmer={mission.shimmer}
          expanded={open === "mission"}
          onClick={() => setOpen((cur) => (cur === "mission" ? "none" : "mission"))}
        />
      ) : null}

      {planBadge !== null ? (
        <PremiumBadge
          label="Plan"
          icon={Route01Icon}
          state={planBadge.state}
          shimmer={planBadge.shimmer}
          expanded={open === "plan"}
          onClick={() => setOpen((cur) => (cur === "plan" ? "none" : "plan"))}
        />
      ) : null}

      {/* Modals are always mounted (cheap) so open/close is pure state; the
       * native <dialog> only enters the top layer when `open`. The render gate
       * guarantees a session exists here. */}
      {isMission && session !== null ? (
        <MissionContractModal
          sessionId={sessionId}
          permission={session.permission}
          open={open === "mission"}
          onOpenChange={(next) => setOpen(next ? "mission" : "none")}
        />
      ) : null}
      {planEnabled ? (
        <PlanDisplayModal
          sessionId={sessionId}
          missionStatus={session?.missionStatus ?? null}
          suppressAccept={suppressPlanAccept}
          open={open === "plan"}
          onOpenChange={(next) => setOpen(next ? "plan" : "none")}
        />
      ) : null}
    </aside>
  );
}

interface BadgeDerivation {
  readonly state: PremiumBadgeState;
  readonly shimmer: boolean;
}

/**
 * Mirror the modal's contract state machine, then apply the cross-cut rule:
 * "Mission Ready" requires the contract awaiting acceptance AND (plan-mode off
 * OR the plan is ready). A `plan_missing` plan keeps the mission at "preparing"
 * so the badge never invites an accept the engine would refuse.
 *
 * Returns null when there is no mission to surface (non-mission session) so the
 * rail simply omits the Mission badge.
 */
function deriveMissionBadge(
  isMission: boolean,
  draft: MissionDraftDto | null,
  diff: ReadyDiff | null,
  plan: PlanGetResult | null,
  hasActiveRun: boolean,
  hasRenewable: boolean,
): BadgeDerivation | null {
  if (!isMission) return null;
  // A mission past contract-acceptance is "accepted" — never "preparing".
  // hasActiveRun covers running/paused; hasRenewable (a non-null renewable
  // source) covers terminal accepted missions (completed/failed/stopped/
  // cancelled). Once accepted the draft drops out of `getDraftForSession`
  // (draft === null), which would otherwise fall through to "preparing".
  //
  // The `draft === null` guard on the renewable branch is load-bearing:
  // `getRenewableSourceForSession` returns the OLD terminal accepted mission
  // for the session whenever one exists and does NOT exclude sessions that
  // also have a fresh draft. After `mission.renew` a new status='draft'
  // mission is inserted under the same root_session_id, and after
  // `mission.edit` the parent mission returns to draft while its accepted-
  // contract columns stay set — in both cases hasRenewable stays true while a
  // current draft exists. Gating on `draft === null` lets that fresh draft
  // fall THROUGH to the normal draft/ready/stale derivation instead of being
  // masked as "accepted" by a stale renewable source. hasActiveRun stays
  // unconditional: a live run is authoritative regardless of any draft.
  //
  // Pass-1 trade-off: a failed/stopped/cancelled mission reuses the `accepted`
  // badge whose caption reads "Accepted" — here it means "contract accepted /
  // no accept action pending", not "mission succeeded". A dedicated
  // RUNNING/DONE state is a deferred Stage-2 follow-up.
  if (hasActiveRun || (draft === null && hasRenewable)) {
    return { state: "accepted", shimmer: false };
  }
  if (draft === null || draft.status === "draft" || diff === null) {
    return { state: "preparing", shimmer: false };
  }
  if (diff.isAccepted && !diff.isDirty) {
    return { state: "accepted", shimmer: false };
  }
  if (diff.isAccepted && diff.isDirty) {
    return { state: "stale", shimmer: false };
  }
  // awaiting-acceptance. Gate "ready" on the plan when plan-mode is on:
  // plan_missing → keep preparing; otherwise ready (shimmer).
  if (planMissing(plan)) {
    return { state: "preparing", shimmer: false };
  }
  return { state: "ready", shimmer: true };
}

/**
 * Plan badge mirrors the plan state. Hidden (null) when plan-mode is off.
 *   - enabled, no markdown        → preparing (authoring)
 *   - enabled, markdown, !accepted → ready (shimmer — awaiting your acceptance)
 *   - accepted + run parked        → stale (awaiting resume)
 *   - accepted                     → accepted
 */
function derivePlanBadge(
  plan: PlanGetResult | null,
  missionStatus: string | null,
): BadgeDerivation | null {
  if (plan === null || !plan.enabled) return null;
  const hasPlan = plan.planMd.length > 0;
  if (!hasPlan) return { state: "preparing", shimmer: false };
  if (!plan.accepted) return { state: "ready", shimmer: true };
  if (missionStatus === "paused_plan_acceptance") {
    return { state: "stale", shimmer: false };
  }
  return { state: "accepted", shimmer: false };
}

/** Plan-mode on with an empty body → the engine's `plan_missing` block. */
function planMissing(plan: PlanGetResult | null): boolean {
  return plan !== null && plan.enabled && !plan.accepted && plan.planMd.length === 0;
}

type ReadyDiff = Extract<MissionGetDiffResult, { outcome: "ready" }>;

function readSession(
  data: Result<SessionListItem> | undefined,
): SessionListItem | null {
  if (!data || !data.ok) return null;
  return data.data;
}

function readDraft(
  data: Result<MissionDraftDto | null> | undefined,
): MissionDraftDto | null {
  if (!data || !data.ok) return null;
  return data.data;
}

function readDiff(
  data: Result<MissionGetDiffResult> | undefined,
): ReadyDiff | null {
  if (!data || !data.ok) return null;
  if (data.data.outcome !== "ready") return null;
  return data.data;
}

function readPlan(
  data: Result<PlanGetResult> | undefined,
): PlanGetResult | null {
  if (!data || !data.ok) return null;
  return data.data;
}
