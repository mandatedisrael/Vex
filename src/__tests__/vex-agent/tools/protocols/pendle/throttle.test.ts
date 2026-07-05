/**
 * Pendle CU-weighted throttle — cost math, TTL caching, dedupe, penalty gate.
 */

import { describe, it, expect, vi } from "vitest";

import { PendleThrottle, parseRetryAfterMs } from "@tools/pendle/throttle.js";

function fakeClock() {
  let t = 0;
  return {
    now: () => t,
    sleep: vi.fn(async (ms: number) => {
      t += ms;
    }),
    advance: (ms: number) => {
      t += ms;
    },
  };
}

describe("parseRetryAfterMs", () => {
  it("parses delta-seconds and falls back", () => {
    expect(parseRetryAfterMs("3")).toBe(3000);
    expect(parseRetryAfterMs(null, 5000)).toBe(5000);
  });
});

describe("PendleThrottle — CU cost accounting", () => {
  it("blocks (sleeps) once the per-minute CU budget is spent", async () => {
    const clock = fakeClock();
    // 14 CU/min budget → two 7-CU converts fit, the third must wait.
    const t = new PendleThrottle({ cuPerMinute: 14, deps: { now: clock.now, sleep: clock.sleep } });
    const run = () => t.run(`k${Math.random()}`, 7, 0, async () => "ok");
    await run();
    await run();
    expect(clock.sleep).not.toHaveBeenCalled();
    await run(); // third convert — budget exhausted → must sleep to refill
    expect(clock.sleep).toHaveBeenCalled();
  });

  it("serves a cached read within TTL without a second fetch (and skips the CU)", async () => {
    const clock = fakeClock();
    const t = new PendleThrottle({ cuPerMinute: 90, deps: { now: clock.now, sleep: clock.sleep } });
    const fetcher = vi.fn(async () => "markets");
    await t.run("markets", 1, 60_000, fetcher);
    await t.run("markets", 1, 60_000, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
    // After TTL, the cache misses.
    clock.advance(61_000);
    await t.run("markets", 1, 60_000, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("NEVER caches a convert (ttl 0) — every call refetches", async () => {
    const clock = fakeClock();
    const t = new PendleThrottle({ cuPerMinute: 90, deps: { now: clock.now, sleep: clock.sleep } });
    const fetcher = vi.fn(async () => "plan");
    await t.run("convert", 7, 0, fetcher);
    await t.run("convert", 7, 0, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("dedupes concurrent identical requests into one fetch", async () => {
    const clock = fakeClock();
    const t = new PendleThrottle({ cuPerMinute: 90, deps: { now: clock.now, sleep: clock.sleep } });
    let resolve!: (v: string) => void;
    const deferred = new Promise<string>((r) => (resolve = r));
    const fetcher = vi.fn(() => deferred);
    const p1 = t.run("dupe", 1, 60_000, fetcher);
    const p2 = t.run("dupe", 1, 60_000, fetcher);
    resolve("shared");
    expect(await p1).toBe("shared");
    expect(await p2).toBe("shared");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("penalize parks the bucket so the next acquire sleeps", async () => {
    const clock = fakeClock();
    const t = new PendleThrottle({ cuPerMinute: 90, deps: { now: clock.now, sleep: clock.sleep } });
    t.penalize(4000);
    await t.run("after-penalty", 1, 0, async () => "ok");
    expect(clock.sleep).toHaveBeenCalledWith(4000);
  });
});
