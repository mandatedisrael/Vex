import { describe, expect, it, vi } from "vitest";
import { makeOrderedQuitCleanup } from "../ordered-quit-cleanup.js";

describe("makeOrderedQuitCleanup", () => {
  it("awaits the worker stop BEFORE invoking the quit cleanup", async () => {
    const order: string[] = [];
    const stopWorker = vi.fn(async () => {
      // a real worker stop yields (drains an in-flight job) before resolving
      await Promise.resolve();
      order.push("stop");
    });
    const quitCleanup = vi.fn(async () => {
      order.push("cleanup");
    });

    await makeOrderedQuitCleanup(stopWorker, quitCleanup)();

    // Compose/Postgres teardown must not begin until the worker has drained.
    expect(order).toEqual(["stop", "cleanup"]);
  });

  it("still runs the quit cleanup when the worker stop rejects (finally)", async () => {
    const quitCleanup = vi.fn(async () => {});
    const task = makeOrderedQuitCleanup(async () => {
      throw new Error("stop boom");
    }, quitCleanup);

    await expect(task()).rejects.toThrow("stop boom");
    // A stuck/throwing worker must never block secret + compose hygiene.
    expect(quitCleanup).toHaveBeenCalledTimes(1);
  });
});
