/**
 * Mission contract card (puzzle 04 phase 7).
 *
 * Renders the read-only mission contract + a single Accept button
 * when the host hasn't accepted yet, OR a "Contract changed since
 * acceptance" prompt when the draft drifted from the accepted hash.
 *
 * Render gate (caller-enforced):
 *   - `activeSession.mode === "mission"`
 *   - `useMissionDraft(sessionId).data?.ok` with non-null draft DTO
 *
 * Acceptance source of truth is `mission.getDiff` (Phase 6 channel),
 * which returns `currentHash` + `isAccepted` + `isDirty`. The Accept
 * button posts the SAME `currentHash` it rendered — `acceptContract`
 * is rejected by the engine if the hash drifts between read and post.
 *
 * Presentational primitives + formatters live in
 * `MissionContractCardSections.tsx` so this module stays small.
 */

import { useMemo } from "react";
import type { JSX } from "react";
import type { Result } from "@shared/ipc/result.js";
import type {
  MissionDraftDto,
  MissionGetDiffResult,
} from "@shared/schemas/mission.js";
import {
  useAcceptMissionContract,
  useMissionDiff,
  useMissionDraft,
  useSetAutoRetry,
} from "../../lib/api/mission.js";
import {
  AutoRetrySection,
  CardBody,
  CardFooter,
  CardHeader,
  type CardStateKind,
} from "./MissionContractCardSections.js";

interface CardState {
  readonly kind: CardStateKind;
  readonly draft: MissionDraftDto;
  /** Non-null only for the two acceptance-action kinds. */
  readonly currentHash: string | null;
}

export interface MissionContractCardProps {
  readonly sessionId: string;
  /** Owning session permission — auto-retry toggle shows only for "full". */
  readonly permission: "full" | "restricted";
}

export function MissionContractCard({
  sessionId,
  permission,
}: MissionContractCardProps): JSX.Element | null {
  const draftQuery = useMissionDraft(sessionId);
  const draft = readDraft(draftQuery.data);
  const diffQuery = useMissionDiff(sessionId, draft?.missionId ?? null);
  const diff = readDiff(diffQuery.data);
  const accept = useAcceptMissionContract();
  const autoRetry = useSetAutoRetry();

  const state = useMemo<CardState | null>(() => {
    if (draft === null) return null;
    if (draft.status === "draft") {
      return { kind: "setup-needed", draft, currentHash: null };
    }
    // status === "ready" path — phase 7 read-path fix exposes this row.
    if (diff === null) {
      // Diff still loading or errored — keep Accept disabled.
      return { kind: "setup-needed", draft, currentHash: null };
    }
    if (diff.isAccepted && !diff.isDirty) {
      return { kind: "accepted", draft, currentHash: null };
    }
    if (diff.isAccepted && diff.isDirty) {
      return {
        kind: "dirty-acceptance",
        draft,
        currentHash: diff.currentHash,
      };
    }
    return {
      kind: "awaiting-acceptance",
      draft,
      currentHash: diff.currentHash,
    };
  }, [draft, diff]);

  if (draft === null || state === null) return null;

  const onAccept = (hash: string): void => {
    accept.mutate({
      sessionId,
      missionId: draft.missionId,
      contractHash: hash,
    });
  };

  // Auto-retry opt-in is meaningful only for autonomous-full sessions (the
  // engine refuses it otherwise). Hide the toggle for restricted — the
  // server is still the authority.
  const showAutoRetry = permission === "full";
  const autoRetryEnabled = state.draft.constraints.autoRetryEnabled === true;
  const onToggleAutoRetry = (next: boolean): void => {
    autoRetry.mutate({
      sessionId,
      missionId: state.draft.missionId,
      enabled: next,
    });
  };

  const title = state.draft.title?.trim() || "Mission contract";

  return (
    <section
      role="region"
      aria-labelledby="mission-contract-card-title"
      data-vex-area="mission-contract-card"
      className="mt-7 overflow-hidden rounded-lg border border-[var(--vex-line-strong)] bg-[var(--vex-surface-1)] text-sm text-[var(--vex-text-2)]"
    >
      <CardHeader kind={state.kind} title={title} />
      <CardBody draft={state.draft} />
      {showAutoRetry ? (
        <AutoRetrySection
          enabled={autoRetryEnabled}
          pending={autoRetry.isPending}
          onToggle={onToggleAutoRetry}
        />
      ) : null}
      <CardFooter
        kind={state.kind}
        currentHash={state.currentHash}
        pending={accept.isPending}
        onAccept={onAccept}
      />
    </section>
  );
}

function readDraft(
  data: Result<MissionDraftDto | null> | undefined,
): MissionDraftDto | null {
  if (!data || !data.ok) return null;
  return data.data;
}

function readDiff(
  data: Result<MissionGetDiffResult> | undefined,
): Extract<MissionGetDiffResult, { outcome: "ready" }> | null {
  if (!data || !data.ok) return null;
  if (data.data.outcome !== "ready") return null;
  return data.data;
}
