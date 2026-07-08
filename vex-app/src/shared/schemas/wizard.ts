/**
 * Wizard schemas — Phase 1 setup ceremony (M7–M11).
 *
 * Three concerns share this module:
 *   1. Form-side password schema (renderer React Hook Form)
 *   2. IPC boundary schemas for `vex.onboarding.{keystoreSet,getWizardState,setWizardState}`
 *   3. Persistent wizard progress shape (`${ELECTRON_STATE_DIR}/wizard-state.json`)
 *
 * `WIZARD_STEP_IDS` is the single source of truth for step ordering — sidebar
 * rendering, schema enums, and forward-safe transition validation all derive
 * from this list. Adding/removing a step in M8–M11 is one edit here
 * (codex turn 5 RED #1).
 *
 * "keystore" as the step id is historical. The step now creates or
 * unlocks the encrypted local secret vault with the user's master
 * password; it does not persist `VEX_KEYSTORE_PASSWORD` to `.env`.
 */

import { z } from "zod";

// ── Step ordering — single source of truth (codex turn 5 RED #1) ────────────
export const WIZARD_STEP_IDS = [
  "keystore",
  "wallets",
  "apiKeys",
  "embedding",
  "agentCore",
  "provider",
  "review",
] as const;

export const wizardStepIdSchema = z.enum(WIZARD_STEP_IDS);
export type WizardStepId = z.infer<typeof wizardStepIdSchema>;

const stepIndex = (id: WizardStepId): number =>
  WIZARD_STEP_IDS.indexOf(id);

// ── Form-side schema (renderer only) ───────────────────────────────────────
// Floor for CREATING a new master password only. Deliberately separate from
// `PASSWORD_MIN_LENGTH` (secrets.ts, =8), which governs re-entering an
// ALREADY-EXISTING password on unlock and private-key export re-auth — those
// paths must keep accepting existing 8-char vaults. Raising this constant
// only tightens what a *new* master password may be.
export const PASSWORD_CREATE_MIN = 10;

export const keystorePasswordSchema = z
  .object({
    password: z.string().min(PASSWORD_CREATE_MIN, {
      message: `Password must be at least ${PASSWORD_CREATE_MIN} characters.`,
    }),
    confirm: z.string(),
  })
  .refine((d) => d.password === d.confirm, {
    message: "Passwords do not match.",
    path: ["confirm"],
  });

export type KeystorePasswordInput = z.infer<typeof keystorePasswordSchema>;

// ── IPC: keystoreSet ───────────────────────────────────────────────────────
// Confirm-match validation is renderer-side only; main never sees the
// confirm field so a malicious renderer cannot bypass the rule by
// invoking IPC directly with `{password, confirm}` shapes. This schema is
// also the MAIN-process floor: `registerOnboardingHandlers` validates every
// keystoreSet call against it directly (src/main/ipc/onboarding.ts), so
// `PASSWORD_CREATE_MIN` is enforced server-side, not just in the renderer form.
export const keystoreSetInputSchema = z
  .object({
    password: z.string().min(PASSWORD_CREATE_MIN, {
      message: `Password must be at least ${PASSWORD_CREATE_MIN} characters.`,
    }),
  })
  .strict();

export type KeystoreSetInput = z.infer<typeof keystoreSetInputSchema>;

export const keystoreSetResultSchema = z
  .object({
    kind: z.enum(["set", "unchanged"]),
  })
  .strict();

export type KeystoreSetResult = z.infer<typeof keystoreSetResultSchema>;

// ── Wizard state (persisted) ───────────────────────────────────────────────

// Canonical-prefix predicate (codex turn 6 RED): completedSteps must be
// a contiguous prefix of WIZARD_STEP_IDS. A renderer cannot persist
// "completedSteps: ['wake']" without also persisting every step before
// it — closes the door on the wizard skipping forward into Step 9
// (Review) with an arbitrary subset that bypasses the actual setup.
function isCanonicalPrefix(steps: ReadonlyArray<WizardStepId>): boolean {
  if (steps.length === 0) return true;
  const set = new Set(steps);
  if (set.size !== steps.length) return false;
  for (const id of set) {
    const idx = stepIndex(id);
    for (let i = 0; i < idx; i++) {
      const prior = WIZARD_STEP_IDS[i];
      if (prior === undefined) continue;
      if (!set.has(prior)) return false;
    }
  }
  return true;
}

const completedStepsSchema = z
  .array(wizardStepIdSchema)
  .readonly()
  .refine(
    (arr) => new Set(arr).size === arr.length,
    { message: "completedSteps must contain unique step ids." }
  )
  .refine(isCanonicalPrefix, {
    message:
      "completedSteps must be a canonical prefix of the wizard step list (no gaps).",
  });

// Forward-safe transition predicate (codex turn 5 small adjustment):
// currentStepId must be at-or-after the latest completed step in the
// canonical order. Prevents stale-state corruption (e.g. an old file
// claiming currentStepId="keystore" while completedSteps already
// contains "wallets") from sending the user back through completed
// ground. Applied at BOTH the persisted shape (load-time) AND the
// IPC input (caller validation) — the same invariant.
function isForwardSafe(s: {
  readonly currentStepId: WizardStepId;
  readonly completedSteps: ReadonlyArray<WizardStepId>;
}): boolean {
  if (s.completedSteps.length === 0) return true;
  const maxCompleted = Math.max(
    ...s.completedSteps.map((id) => stepIndex(id))
  );
  return stepIndex(s.currentStepId) >= maxCompleted;
}

// Completed-flag invariant (codex turn 6 RED): `completed === true`
// is allowed ONLY when currentStepId === "review" AND completedSteps
// contains every step before review. WizardShell uses `completed` as
// a single boolean to skip-to-app on a finished install; without
// this fence a renderer could persist `completed: true` at any step
// and bypass the entire ceremony. Fail closed.
const REVIEW_PRECONDITION = WIZARD_STEP_IDS.filter((id) => id !== "review");

function isCompletedConsistent(s: {
  readonly currentStepId: WizardStepId;
  readonly completedSteps: ReadonlyArray<WizardStepId>;
  // `| undefined` is required under exactOptionalPropertyTypes: the Zod
  // `.optional()` output type is `boolean | undefined`, and a plain
  // `completed?: boolean` parameter would reject it.
  readonly completed?: boolean | undefined;
}): boolean {
  if (s.completed !== true) return true;
  if (s.currentStepId !== "review") return false;
  const have = new Set(s.completedSteps);
  for (const required of REVIEW_PRECONDITION) {
    if (!have.has(required)) return false;
  }
  return true;
}

const FORWARD_SAFE_MESSAGE =
  "currentStepId must be at-or-after the latest completed step.";
const COMPLETED_CONSISTENT_MESSAGE =
  "completed=true requires currentStepId='review' and every prior step in completedSteps.";

// Phase 2 refactor (codex round 4 guardrail #1): bump schemaVersion to 2
// because the v1 step set included "mode"/"wake" which no longer exist
// in WIZARD_STEP_IDS. A v1 file with an old step id will fail the enum
// refinement, but persisted v1 files at `currentStepId: "keystore"` with
// `completedSteps: []` would otherwise look identical to a fresh v2 file
// and silently re-enter the wizard with stale provenance. Bumping the
// literal version forces every v1 file through `recoverDefaults()`
// (marker-first, fail-closed) — the next session-config bootstrap can
// then surface skip-badges for infra already on disk.
export const wizardStateSchema = z
  .object({
    schemaVersion: z.literal(2),
    currentStepId: wizardStepIdSchema,
    completedSteps: completedStepsSchema,
    completed: z.boolean(),
  })
  .strict()
  .refine(isForwardSafe, { message: FORWARD_SAFE_MESSAGE })
  .refine(isCompletedConsistent, { message: COMPLETED_CONSISTENT_MESSAGE });

export type WizardState = z.infer<typeof wizardStateSchema>;

export const defaultWizardState: WizardState = {
  schemaVersion: 2,
  currentStepId: "keystore",
  completedSteps: [],
  completed: false,
};

// IPC: setWizardState input mirrors the persisted shape minus schemaVersion
// (the store owns versioning). `completed` is optional on input — most
// step transitions only update currentStepId + completedSteps.
export const setWizardStateInputSchema = z
  .object({
    currentStepId: wizardStepIdSchema,
    completedSteps: completedStepsSchema,
    completed: z.boolean().optional(),
  })
  .strict()
  .refine(isForwardSafe, { message: FORWARD_SAFE_MESSAGE })
  .refine(isCompletedConsistent, { message: COMPLETED_CONSISTENT_MESSAGE });

export type SetWizardStateInput = z.infer<typeof setWizardStateInputSchema>;

export const wizardStateResultSchema = wizardStateSchema;
export type WizardStateResult = z.infer<typeof wizardStateResultSchema>;
