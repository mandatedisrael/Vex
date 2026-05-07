/**
 * CleanupRegistry per skill §11.
 *
 * Every external handle is a lease — timers, streams, IPC listeners, Docker logs,
 * pg clients, BrowserWindow refs. Each registers an idempotent cleanup task.
 * runAll() invoked on app quit; failures don't block other cleanups.
 */

type Cleanup = () => void | Promise<void>;

export class CleanupRegistry {
  private readonly tasks = new Set<Cleanup>();
  private running = false;

  add(task: Cleanup): () => Promise<void> {
    this.tasks.add(task);
    return async () => {
      this.tasks.delete(task);
      await task();
    };
  }

  async runAll(): Promise<void> {
    if (this.running) return;
    this.running = true;
    const snapshot = [...this.tasks];
    this.tasks.clear();
    await Promise.allSettled(snapshot.map((t) => t()));
    this.running = false;
  }

  size(): number {
    return this.tasks.size;
  }
}

export const globalCleanup = new CleanupRegistry();
