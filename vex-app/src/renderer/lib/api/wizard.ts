/**
 * TanStack Query hooks over `vex.onboarding.{getWizardState,setWizardState,keystoreSet}`.
 *
 * `wizardState` runs at a short staleTime (5s) — short enough that a
 * refresh after the user crashed mid-wizard re-reads the persisted
 * state, but not so short that StrictMode dev double-mount + every
 * sidebar re-render thrashes the IPC. After `keystoreSet` succeeds,
 * the env state query is invalidated so a future skip-badge check
 * reflects the new password (codex turn 5 answer #4). The wizard
 * itself advances by mutating the local React step state and writing
 * the next `currentStepId` via `setWizardState`.
 */

import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import type { Result } from "@shared/ipc/result.js";
import {
  WIZARD_STEP_IDS,
  type KeystoreSetInput,
  type KeystoreSetResult,
  type SetWizardStateInput,
  type WizardState,
  type WizardStepId,
} from "@shared/schemas/wizard.js";
import { onboardingKeys } from "./queryKeys.js";

/**
 * Compute the next persisted state for a forward step transition.
 * - Adds `current` to `completedSteps` (idempotent — no duplicates).
 * - Returns `next` as the new `currentStepId`.
 * - When `next === "review"` and the caller wants to mark the wizard
 *   completed, pass `markCompleted: true`.
 *
 * Pure helper — does no IPC. Used by step components to build the
 * `setWizardState` payload before calling `useSetWizardState().mutate`.
 */
export function nextWizardStateFor(args: {
  readonly completedSteps: ReadonlyArray<WizardStepId>;
  readonly current: WizardStepId;
  readonly next: WizardStepId;
  readonly markCompleted?: boolean;
}): SetWizardStateInput {
  const completed = args.completedSteps.includes(args.current)
    ? args.completedSteps
    : [...args.completedSteps, args.current];
  return {
    currentStepId: args.next,
    completedSteps: completed,
    ...(args.markCompleted ? { completed: true } : {}),
  };
}

/** Returns the canonical next step id, or null if `current` is the last step. */
export function nextStepId(current: WizardStepId): WizardStepId | null {
  const idx = WIZARD_STEP_IDS.indexOf(current);
  if (idx < 0 || idx >= WIZARD_STEP_IDS.length - 1) return null;
  return WIZARD_STEP_IDS[idx + 1] ?? null;
}

export function wizardStateOptions() {
  return queryOptions({
    queryKey: onboardingKeys.wizardState(),
    queryFn: () => window.vex.onboarding.getWizardState(),
    staleTime: 5_000,
  });
}

export function useWizardState(): UseQueryResult<Result<WizardState>> {
  return useQuery(wizardStateOptions());
}

export function useSetWizardState(): UseMutationResult<
  Result<WizardState>,
  Error,
  SetWizardStateInput
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: SetWizardStateInput) =>
      window.vex.onboarding.setWizardState(input),
    onSuccess: (result) => {
      if (result.ok) {
        queryClient.setQueryData(onboardingKeys.wizardState(), result);
      }
    },
  });
}

export function useKeystoreSet(): UseMutationResult<
  Result<KeystoreSetResult>,
  Error,
  KeystoreSetInput
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: KeystoreSetInput) =>
      window.vex.onboarding.keystoreSet(input),
    onSuccess: (result) => {
      if (result.ok) {
        // The skip-badge layer reads `envState.hasKeystorePassword`;
        // invalidate it so the next mount (or any other panel that
        // gates on it) sees the freshly-persisted value (codex turn 5
        // answer #4). We intentionally do NOT refetch eagerly — the
        // wizard advances to Step 2 immediately, this mount unmounts.
        void queryClient.invalidateQueries({
          queryKey: onboardingKeys.envState(),
        });
      }
    },
  });
}
