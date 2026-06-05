/**
 * Cancel-registry singleton for the IPC handler harness.
 *
 * Module-scoped registry mapping a request's correlationId to the
 * AbortController whose signal flows into the handler. The `vex:cancel`
 * IPC handler reaches into this registry by correlationId and calls
 * `.abort()` on the controller; the originating handler's `ctx.signal`
 * therefore fires, and any spawn/fetch/wait it owns aborts.
 *
 * The registry is in-process only: a renderer-issued cancel cannot
 * outlive the main process. Cleaned in the handler's `finally` so
 * completed/failed requests can never be "cancelled" after the fact
 * (the registry lookup returns undefined → cancel returns
 * `{cancelled: false}`).
 *
 * LEAF module: it must NOT import register-handler.ts. `registerHandler`
 * (the façade) writes/deletes via `cancelRegistry`; getCancelController /
 * __resetCancelRegistryForTests read via it. Exactly ONE `cancelRegistry`
 * Map exists in the process — every consumer imports this module.
 */

export const cancelRegistry = new Map<string, AbortController>();

export function getCancelController(
  correlationId: string,
): AbortController | undefined {
  return cancelRegistry.get(correlationId);
}

/**
 * Test-only: clear the cancel registry. Tests that spawn fake handlers
 * and want a clean slate between cases use this to drop any controllers
 * that survived a failed-test finally block.
 */
export function __resetCancelRegistryForTests(): void {
  cancelRegistry.clear();
}
