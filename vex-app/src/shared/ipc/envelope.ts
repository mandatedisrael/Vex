/**
 * IPC request envelope shape (skill §6).
 * Every request from preload is wrapped: { requestId, payload }.
 */

import { z } from "zod";

export const requestEnvelopeSchema = <T extends z.ZodTypeAny>(payload: T) =>
  z
    .object({
      requestId: z.string().min(1),
      payload,
    })
    .strict();

export type RequestEnvelope<T> = {
  readonly requestId: string;
  readonly payload: T;
};
