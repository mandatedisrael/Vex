import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { retryWithBackoff, withTimeout, isRetryableError } = await import(
  "../../agent/resilience.js"
);

describe("retryWithBackoff", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("returns result on first successful attempt", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const result = await retryWithBackoff(fn, { maxRetries: 3, baseDelayMs: 1 });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries and succeeds on second attempt", async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error("fail"))
      .mockResolvedValue("ok");
    const result = await retryWithBackoff(fn, { maxRetries: 3, baseDelayMs: 1 });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("throws last error after exhausting all retries", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("permanent fail"));
    await expect(
      retryWithBackoff(fn, { maxRetries: 2, baseDelayMs: 1 }),
    ).rejects.toThrow("permanent fail");
    expect(fn).toHaveBeenCalledTimes(3); // initial + 2 retries
  });

  it("stops early when shouldRetry returns false", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("client error"));
    await expect(
      retryWithBackoff(fn, {
        maxRetries: 5,
        baseDelayMs: 1,
        shouldRetry: () => false,
      }),
    ).rejects.toThrow("client error");
    expect(fn).toHaveBeenCalledTimes(1); // no retry
  });

  it("respects maxDelayMs cap", async () => {
    const delays: number[] = [];
    const originalSetTimeout = globalThis.setTimeout;
    vi.spyOn(globalThis, "setTimeout").mockImplementation(((fn: () => void, ms?: number) => {
      delays.push(ms ?? 0);
      return originalSetTimeout(fn, 0); // execute immediately for speed
    }) as typeof setTimeout);

    const fnMock = vi.fn()
      .mockRejectedValueOnce(new Error("1"))
      .mockRejectedValueOnce(new Error("2"))
      .mockResolvedValue("ok");

    await retryWithBackoff(fnMock, { maxRetries: 3, baseDelayMs: 100, maxDelayMs: 150 });
    // All delays should be capped at 150
    for (const d of delays) {
      expect(d).toBeLessThanOrEqual(150);
    }
    vi.restoreAllMocks();
  });

  it("logs retry attempts when label is provided", async () => {
    const logger = (await import("../../utils/logger.js")).default;
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error("temp"))
      .mockResolvedValue("ok");
    await retryWithBackoff(fn, { maxRetries: 2, baseDelayMs: 1 }, "test-op");
    expect(logger.debug).toHaveBeenCalled();
  });
});

describe("withTimeout", () => {
  it("resolves when promise completes before timeout", async () => {
    const result = await withTimeout(Promise.resolve("fast"), 5000, "test");
    expect(result).toBe("fast");
  });

  it("rejects with descriptive error when promise times out", async () => {
    const slow = new Promise(() => {}); // never resolves
    await expect(withTimeout(slow, 50, "slow-op")).rejects.toThrow(
      "slow-op timed out after 0.05s",
    );
  });

  it("error message includes seconds", async () => {
    const slow = new Promise(() => {});
    try {
      await withTimeout(slow, 2000, "my-task");
    } catch (e) {
      expect((e as Error).message).toContain("2s");
    }
  });
});

describe("isRetryableError", () => {
  it("AbortError is NOT retryable", () => {
    const err = new Error("aborted");
    err.name = "AbortError";
    expect(isRetryableError(err)).toBe(false);
  });

  it("ETIMEDOUT is retryable", () => {
    const err = new Error("timeout") as NodeJS.ErrnoException;
    err.code = "ETIMEDOUT";
    expect(isRetryableError(err)).toBe(true);
  });

  it("ECONNRESET is retryable", () => {
    const err = new Error("reset") as NodeJS.ErrnoException;
    err.code = "ECONNRESET";
    expect(isRetryableError(err)).toBe(true);
  });

  it("ECONNREFUSED is retryable", () => {
    const err = new Error("refused") as NodeJS.ErrnoException;
    err.code = "ECONNREFUSED";
    expect(isRetryableError(err)).toBe(true);
  });

  it("502 is retryable", () => {
    expect(isRetryableError(new Error("returned 502"))).toBe(true);
  });

  it("503 is retryable", () => {
    expect(isRetryableError(new Error("returned 503"))).toBe(true);
  });

  it("429 is retryable", () => {
    expect(isRetryableError(new Error("returned 429"))).toBe(true);
  });

  it("400 is NOT retryable", () => {
    expect(isRetryableError(new Error("returned 400"))).toBe(false);
  });

  it("401 is NOT retryable", () => {
    expect(isRetryableError(new Error("returned 401"))).toBe(false);
  });

  it("403 is NOT retryable", () => {
    expect(isRetryableError(new Error("returned 403"))).toBe(false);
  });

  it("404 is NOT retryable", () => {
    expect(isRetryableError(new Error("returned 404"))).toBe(false);
  });

  it("unknown error with no code is retryable (conservative)", () => {
    expect(isRetryableError(new Error("something went wrong"))).toBe(true);
  });
});
