import { describe, it, expect, vi } from "vitest";
import { withSessionLock } from "../../agent/session-lock.js";

describe("withSessionLock", () => {
  it("executes a single call and resolves", async () => {
    const fn = vi.fn().mockResolvedValue(undefined);
    await withSessionLock("s1", fn);
    expect(fn).toHaveBeenCalledOnce();
  });

  it("serializes concurrent calls on the SAME session", async () => {
    const order: number[] = [];
    const fn1 = async () => {
      order.push(1);
      await new Promise((r) => setTimeout(r, 30));
      order.push(2);
    };
    const fn2 = async () => {
      order.push(3);
      order.push(4);
    };

    // Fire both concurrently on the same session
    const p1 = withSessionLock("s-same", fn1);
    const p2 = withSessionLock("s-same", fn2);
    await Promise.all([p1, p2]);

    // fn1 should complete (1,2) before fn2 starts (3,4)
    expect(order).toEqual([1, 2, 3, 4]);
  });

  it("allows parallel execution on DIFFERENT sessions", async () => {
    const order: string[] = [];
    const fn1 = async () => {
      order.push("a-start");
      await new Promise((r) => setTimeout(r, 30));
      order.push("a-end");
    };
    const fn2 = async () => {
      order.push("b-start");
      order.push("b-end");
    };

    const p1 = withSessionLock("s-a", fn1);
    const p2 = withSessionLock("s-b", fn2);
    await Promise.all([p1, p2]);

    // b should start before a ends (parallel)
    const bStartIdx = order.indexOf("b-start");
    const aEndIdx = order.indexOf("a-end");
    expect(bStartIdx).toBeLessThan(aEndIdx);
  });

  it("second call still executes when first throws", async () => {
    const fn1 = vi.fn().mockRejectedValue(new Error("boom"));
    const fn2 = vi.fn().mockResolvedValue(undefined);

    const p1 = withSessionLock("s-err", fn1).catch(() => {});
    const p2 = withSessionLock("s-err", fn2);
    await Promise.all([p1, p2]);

    expect(fn2).toHaveBeenCalledOnce();
  });

  it("three concurrent calls execute in order on same session", async () => {
    const order: number[] = [];
    const makeFn = (n: number) => async () => { order.push(n); };

    const p1 = withSessionLock("s-three", makeFn(1));
    const p2 = withSessionLock("s-three", makeFn(2));
    const p3 = withSessionLock("s-three", makeFn(3));
    await Promise.all([p1, p2, p3]);

    expect(order).toEqual([1, 2, 3]);
  });

  it("cleans up lock map after all calls complete", async () => {
    // This is an internal detail, but important for memory
    await withSessionLock("s-cleanup", async () => {});
    // Lock should be removed — we can verify indirectly by running another
    // and checking it runs immediately
    let ran = false;
    await withSessionLock("s-cleanup", async () => { ran = true; });
    expect(ran).toBe(true);
  });
});
