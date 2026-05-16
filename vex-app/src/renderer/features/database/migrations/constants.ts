/**
 * Constants for the migrations bootstrap surface — step counter + the
 * auto-advance delay for the `noop` (schema already up to date) path.
 *
 * `TOTAL_ONBOARDING_STEPS` matches the formula used by the four
 * preceding onboarding screens (see
 * features/compose/bootstrap/constants.ts). Migrations is step 4 of
 * the pre-wizard sequence (systemCheck 1, dockerBootstrap 2,
 * composeBootstrap 3, migrations 4); intro is excluded from the
 * counter (it's a brand surface, not a setup task).
 */

import { WIZARD_STEP_IDS } from "@shared/schemas/wizard.js";

const SETUP_VIEWS_BEFORE_WIZARD = 4;
export const TOTAL_ONBOARDING_STEPS =
  SETUP_VIEWS_BEFORE_WIZARD + (WIZARD_STEP_IDS.length - 1);
export const MIGRATIONS_STEP = 4;

/**
 * Auto-advance delay for the noop branch — visual confirmation tile
 * shows briefly before the orchestrator transitions to the wizard.
 * Existing tests pin this constant; do not raise without updating them.
 */
export const NOOP_AUTO_ADVANCE_MS = 500;

/**
 * Bounded buffer for the list of migration files that completed before
 * a failure. Surfaced by ErrorBody's "Show N applied before failure"
 * disclosure. 50 lines matches the compose log buffer ceiling and is
 * comfortably larger than any realistic migration count.
 */
export const APPLIED_HISTORY_MAX = 50;
