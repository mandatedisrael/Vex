import { beforeEach, describe, expect, it, vi } from "vitest";

const mockFetchJson = vi.fn();
function callMock<T>(mock: unknown, args: unknown[]): T {
  return (mock as (...innerArgs: unknown[]) => T)(...args);
}
vi.mock("@utils/http.js", () => ({
  fetchJson: (...args: unknown[]) => callMock(mockFetchJson, args),
}));

const {
  jupiterTokenContentByMints,
  jupiterTokenContentCooking,
  jupiterTokenContentFeed,
  jupiterTokenContentSummaries,
} = await import("@tools/solana-ecosystem/jupiter/jupiter-tokens/content/client.js");

describe("jupiter token content client", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv, JUPITER_API_KEY: "test-jupiter-key" };
  });

  it("calls /tokens/v2/content with comma-separated mints", async () => {
    mockFetchJson.mockResolvedValueOnce({ data: [] });

    await jupiterTokenContentByMints([
      "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN",
      "So11111111111111111111111111111111111111112",
    ]);

    const [url, opts] = mockFetchJson.mock.calls[0];
    expect(url).toContain("/tokens/v2/content?mints=JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN%2CSo11111111111111111111111111111111111111112");
    expect(opts.headers).toEqual({ "x-api-key": "test-jupiter-key" });
  });

  it("calls /tokens/v2/content/cooking", async () => {
    mockFetchJson.mockResolvedValueOnce({ data: [] });

    await jupiterTokenContentCooking();

    const [url] = mockFetchJson.mock.calls[0];
    expect(url).toBe("https://api.jup.ag/tokens/v2/content/cooking");
  });

  it("calls /tokens/v2/content/feed with pagination params", async () => {
    mockFetchJson.mockResolvedValueOnce({ data: { contents: [], tokenSummary: null, newsSummary: null, pagination: { limit: 25, total: 0, page: 2, totalPages: 0 } } });

    await jupiterTokenContentFeed({
      mint: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN",
      page: 2,
      limit: 25,
    });

    const [url] = mockFetchJson.mock.calls[0];
    expect(url).toBe("https://api.jup.ag/tokens/v2/content/feed?mint=JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN&page=2&limit=25");
  });

  it("calls /tokens/v2/content/summaries", async () => {
    mockFetchJson.mockResolvedValueOnce({ data: [] });

    await jupiterTokenContentSummaries([
      "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN",
    ]);

    const [url] = mockFetchJson.mock.calls[0];
    expect(url).toBe("https://api.jup.ag/tokens/v2/content/summaries?mints=JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN");
  });

  it("rejects when JUPITER_API_KEY is missing", async () => {
    delete process.env.JUPITER_API_KEY;

    await expect(
      jupiterTokenContentCooking(),
    ).rejects.toMatchObject({ code: "HTTP_REQUEST_FAILED" });

    expect(mockFetchJson).not.toHaveBeenCalled();
  });

  it("rejects content mints batches larger than 50 before fetching", async () => {
    const mints = Array.from({ length: 51 }, () => "So11111111111111111111111111111111111111112");

    await expect(
      jupiterTokenContentByMints(mints),
    ).rejects.toMatchObject({ code: "HTTP_REQUEST_FAILED" });

    expect(mockFetchJson).not.toHaveBeenCalled();
  });
});
