import { z } from "zod";

/**
 * Shared lower bound for master-password length. Single source of truth for
 * the renderer's client-side check and the boundary Zod schema below.
 */
export const PASSWORD_MIN_LENGTH = 8;

export const secretsStatusSchema = z
  .object({
    vaultConfigured: z.boolean(),
    unlocked: z.boolean(),
  })
  .strict();

export type SecretsStatus = z.infer<typeof secretsStatusSchema>;

export const secretsUnlockInputSchema = z
  .object({
    password: z.string().min(PASSWORD_MIN_LENGTH),
  })
  .strict();

export type SecretsUnlockInput = z.infer<typeof secretsUnlockInputSchema>;

export const secretsUnlockResultSchema = z
  .object({
    unlocked: z.literal(true),
  })
  .strict();

export type SecretsUnlockResult = z.infer<typeof secretsUnlockResultSchema>;

/**
 * Lock IPC contract — explicit lockdown trigger (settings button, mission
 * cancel, etc.). Input is empty; output confirms the in-process scrub ran.
 */
export const secretsLockInputSchema = z.object({}).strict();
export type SecretsLockInput = z.infer<typeof secretsLockInputSchema>;

export const secretsLockResultSchema = z
  .object({
    locked: z.literal(true),
  })
  .strict();

export type SecretsLockResult = z.infer<typeof secretsLockResultSchema>;

export const resetToFreshVaultInputSchema = z
  .object({ confirm: z.literal(true) })
  .strict();
export type ResetToFreshVaultInput = z.infer<typeof resetToFreshVaultInputSchema>;

export const resetToFreshVaultResultSchema = z
  .object({ scheduled: z.literal(true) })
  .strict();
export type ResetToFreshVaultResult = z.infer<typeof resetToFreshVaultResultSchema>;
