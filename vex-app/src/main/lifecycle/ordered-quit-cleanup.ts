/**
 * Ordered quit cleanup — sequence a long-lived worker's drain BEFORE the
 * compose/secret teardown.
 *
 * `globalCleanup.runAll()` invokes its tasks CONCURRENTLY
 * (`Promise.allSettled`, see `cleanup-registry.ts`). Registering a worker's
 * `stop()` as an independent task would race `cleanupOnQuit()`, which stops
 * the local Postgres compose project (`secret-cleanup.ts`) — pulling the DB
 * out from under an in-flight Track-2 job the worker is still draining.
 *
 * Composing the two into ONE ordered task guarantees the worker drains
 * first. The `finally` keeps compose + secret hygiene running even if the
 * worker's stop throws, so a stuck worker can never block secret cleanup.
 */
export function makeOrderedQuitCleanup(
  stopWorker: () => Promise<void>,
  quitCleanup: () => Promise<void>,
): () => Promise<void> {
  return async (): Promise<void> => {
    try {
      await stopWorker();
    } finally {
      await quitCleanup();
    }
  };
}
