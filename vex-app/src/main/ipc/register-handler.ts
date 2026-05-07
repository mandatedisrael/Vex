/**
 * IPC handler registration helper per skill §6.
 *
 * Every handler:
 *  - validates senderFrame.url against trusted origins
 *  - parses input via Zod schema (request envelope)
 *  - validates outgoing data via Zod outputSchema (defense-in-depth — catches
 *    handler bugs that produce wrong-shape Result<T>)
 *  - returns Result<T, VexError> (never throws raw)
 *  - logs internal errors with correlationId
 */

import { ipcMain, type IpcMainInvokeEvent } from "electron";
import { app } from "electron";
import type { z } from "zod";
import { requestEnvelopeSchema } from "@shared/ipc/envelope.js";
import {
  err,
  type Result,
  type VexDomain,
  type VexError,
} from "@shared/ipc/result.js";
import { log } from "../logger/index.js";

const TRUSTED_PRODUCTION_ORIGIN = "app://vex";
const TRUSTED_DEV_ORIGIN = "http://127.0.0.1:5173";

function assertTrustedSender(event: IpcMainInvokeEvent): void {
  const url = event.senderFrame?.url ?? "";
  const trusted =
    url.startsWith(`${TRUSTED_PRODUCTION_ORIGIN}/`) ||
    url === TRUSTED_PRODUCTION_ORIGIN ||
    (!app.isPackaged &&
      (url.startsWith(`${TRUSTED_DEV_ORIGIN}/`) || url === TRUSTED_DEV_ORIGIN));

  if (!trusted) {
    throw new Error(`Untrusted IPC sender: ${url || "<unknown>"}`);
  }
}

export interface HandlerArgs<I, O> {
  readonly channel: string;
  readonly domain: VexDomain;
  readonly inputSchema: z.ZodType<I>;
  /**
   * Optional Zod schema for the success-path data payload.
   * When provided, every `ok({...}).data` is validated before send.
   * Skip only for empty-shape responses or when schema would echo input verbatim.
   */
  readonly outputSchema?: z.ZodType<O>;
  readonly handle: (
    input: I,
    ctx: { readonly requestId: string; readonly event: IpcMainInvokeEvent }
  ) => Promise<Result<O>>;
}

export function registerHandler<I, O>(args: HandlerArgs<I, O>): () => void {
  const envelope = requestEnvelopeSchema(args.inputSchema);

  const fn = async (event: IpcMainInvokeEvent, raw: unknown): Promise<Result<O>> => {
    let requestId = "<unknown>";
    try {
      assertTrustedSender(event);
      const parsed = envelope.safeParse(raw);
      if (!parsed.success) {
        return err({
          code: "validation.invalid_input",
          domain: args.domain,
          message: "Invalid request payload.",
          retryable: false,
          userActionable: false,
          redacted: true,
          correlationId: requestId,
        });
      }
      requestId = parsed.data.requestId;
      const result = await args.handle(parsed.data.payload, {
        requestId,
        event,
      });

      // Output validation (defense-in-depth)
      if (result.ok && args.outputSchema) {
        const outValidation = args.outputSchema.safeParse(result.data);
        if (!outValidation.success) {
          log.error(
            `[ipc:${args.channel}] correlationId=${requestId}: handler produced invalid output shape`,
            outValidation.error.format()
          );
          return err({
            code: "internal.contract_violation",
            domain: args.domain,
            message: "Internal error.",
            retryable: false,
            userActionable: false,
            redacted: true,
            correlationId: requestId,
          });
        }
      }

      return result;
    } catch (error: unknown) {
      // Pass `error` as a separate arg so the redactor can scrub it BEFORE the
      // string is emitted. Template-embedding the message would bypass redaction.
      const message =
        error instanceof Error ? error.message : "Unknown internal error";
      log.error(
        `[ipc:${args.channel}] correlationId=${requestId}: handler threw`,
        error
      );

      const isUntrusted = message.startsWith("Untrusted IPC sender");
      const errorPayload: VexError = {
        code: isUntrusted ? "validation.invalid_sender" : "internal.contract_violation",
        domain: args.domain,
        message: isUntrusted
          ? "Request rejected: untrusted sender."
          : "Internal error.",
        retryable: false,
        userActionable: false,
        redacted: true,
        correlationId: requestId,
      };
      return err(errorPayload);
    }
  };

  ipcMain.handle(args.channel, fn);

  return () => {
    ipcMain.removeHandler(args.channel);
  };
}
