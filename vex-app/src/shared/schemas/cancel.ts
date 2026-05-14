/**
 * Schemas for the `vex:cancel` IPC channel.
 *
 * Renderer requests cancellation of an in-flight request by its
 * correlationId (the same UUID that preload generated when invoking
 * the original channel). Main looks the id up in its in-process
 * `cancelRegistry`, aborts the corresponding `AbortController`, and
 * returns `{ cancelled: boolean }`:
 *
 *   - `cancelled: true`  — controller existed and was aborted.
 *   - `cancelled: false` — controller not found (request already
 *     completed, never existed, or was cancelled by an earlier call).
 *     Idempotent + non-leaky; not modeled as an error.
 *
 * The correlationId is validated as a UUID because preload mints it
 * via `crypto.randomUUID()`. Defense-in-depth: a renderer typo or a
 * tampered payload can't smuggle arbitrary keys into the registry
 * lookup.
 */

import { z } from "zod";

export const cancelInputSchema = z
  .object({
    correlationId: z.string().uuid(),
  })
  .strict();

export const cancelResultSchema = z
  .object({
    cancelled: z.boolean(),
  })
  .strict();

export type CancelInput = z.infer<typeof cancelInputSchema>;
export type CancelResult = z.infer<typeof cancelResultSchema>;
