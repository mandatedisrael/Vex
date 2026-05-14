/**
 * `vex:cancel` IPC handler — abort an in-flight request by its
 * correlationId.
 *
 * Architecture: every `registerHandler` invocation creates a fresh
 * `AbortController`, stores it in a module-scoped registry keyed by
 * the request's correlationId, and passes the signal to the handler
 * as `ctx.signal`. The handler plumbs the signal down to whatever
 * primitive owns the long-running work (subprocess spawn, fetch, etc.).
 *
 * This handler does the lookup-and-fire:
 *   - lookup `correlationId` in the registry,
 *   - if found, call `.abort()` and return `ok({cancelled: true})`,
 *   - if not found (already completed, never existed, or already
 *     cancelled), return `ok({cancelled: false})`.
 *
 * No auth on the cancel surface: the correlationId is opaque and
 * generated client-side by preload. A single trusted renderer can
 * cancel any of its own in-flight requests; cross-frame fishing for
 * correlationIds is not a threat in the current Electron sandbox.
 *
 * The cancel handler is itself registered via `registerHandler`, so
 * it briefly inserts its OWN controller into the registry — harmless
 * because the handler runs synchronously (a Map lookup) and immediately
 * removes it in the `finally` block.
 */

import { ok, type Result } from "@shared/ipc/result.js";
import {
  cancelInputSchema,
  cancelResultSchema,
  type CancelResult,
} from "@shared/schemas/cancel.js";
import { CH } from "@shared/ipc/channels.js";
import { getCancelController, registerHandler } from "./register-handler.js";
import { log } from "../logger/index.js";

export function registerCancelHandler(): () => void {
  return registerHandler({
    channel: CH.cancel,
    domain: "internal",
    inputSchema: cancelInputSchema,
    outputSchema: cancelResultSchema,
    handle: async ({ correlationId }): Promise<Result<CancelResult>> => {
      const controller = getCancelController(correlationId);
      if (controller === undefined) {
        // Already completed, never existed, or removed from the
        // registry. Idempotent: every subsequent call for the same id
        // also returns {cancelled: false}.
        return ok({ cancelled: false });
      }
      if (controller.signal.aborted) {
        // Target is still in flight (its handler hasn't returned, so
        // the controller is still in the registry) but already aborted
        // by a prior cancel. Treat the second cancel as a no-op so
        // the renderer can distinguish "I caused this" from "someone
        // else got there first". Codex turn 14 fix.
        return ok({ cancelled: false });
      }
      controller.abort();
      log.info(
        `[ipc:vex:cancel] aborted request correlationId=${correlationId}`,
      );
      return ok({ cancelled: true });
    },
  });
}
