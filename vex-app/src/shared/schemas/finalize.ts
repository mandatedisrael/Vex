/**
 * Schemas for `vex.onboarding.completeSetup` — Wizard Step 9 finalize (M11).
 *
 * Single combined IPC: telemetryConsent travels alongside the finalize
 * trigger so the consent flip happens AFTER the wizard state is marked
 * complete (codex v2 WRONG-DIRECTION on D11 — separate IPC ordered
 * before finalize would leave telemetry on for an unfinished install).
 *
 * Output `backupPath` is `string | null` because the underlying
 * engine `autoBackup()` may return null when there's nothing to back
 * up (no keystore yet — defensive, the wizard reaches Review only
 * after wallets exist, but we surface the engine semantic faithfully).
 *
 * `telemetryWarning` carries a short user-readable string when the
 * Sentry consent flip failed AFTER the rest of finalize succeeded;
 * setup is still done, the toggle didn't take effect this run.
 */

import { z } from "zod";

export const completeSetupInputSchema = z
  .object({
    telemetryConsent: z.boolean(),
  })
  .strict();

export type CompleteSetupInput = z.infer<typeof completeSetupInputSchema>;

export const completeSetupResultSchema = z
  .object({
    completedAt: z.string().datetime(),
    backupPath: z.string().nullable(),
    telemetryWarning: z.string().nullable(),
  })
  .strict();

export type CompleteSetupResult = z.infer<typeof completeSetupResultSchema>;
