import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  formatDocumentInput,
  formatQueryInput,
  embedDocument,
  embedQuery,
} from "@echo-agent/embeddings/client.js";
import { REQUIRED_EMBEDDING_DIM } from "@echo-agent/embeddings/config.js";

const VALID_CONFIG = {
  baseUrl: "http://localhost:12434/engines/llama.cpp/v1",
  model: "ai/embeddinggemma:300M-Q8_0",
  dim: REQUIRED_EMBEDDING_DIM,
  provider: "local",
};

function makeEmbedding(dim: number = REQUIRED_EMBEDDING_DIM): number[] {
  return Array.from({ length: dim }, (_, i) => i / dim);
}

function mockFetchOk(body: unknown): void {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(""),
  } as unknown as Response);
}

function mockFetchStatus(status: number, text = ""): void {
  global.fetch = vi.fn().mockResolvedValue({
    ok: false,
    status,
    text: () => Promise.resolve(text),
    json: () => Promise.resolve({}),
  } as unknown as Response);
}

describe("client formatters", () => {
  it("formatDocumentInput uses 'title: ... | text: ...' shape", () => {
    expect(formatDocumentInput("pumpfun entry", "Holders under 50")).toBe(
      "title: pumpfun entry | text: Holders under 50",
    );
  });

  it("formatQueryInput uses 'task: search result | query: ...' shape", () => {
    expect(formatQueryInput("early holder count")).toBe(
      "task: search result | query: early holder count",
    );
  });
});

describe("embedDocument", () => {
  const originalFetch = global.fetch;
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("POSTs to {baseUrl}/embeddings with formatted document input", async () => {
    mockFetchOk({ data: [{ embedding: makeEmbedding() }] });
    const result = await embedDocument("title", "summary", VALID_CONFIG);

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("http://localhost:12434/engines/llama.cpp/v1/embeddings");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ "Content-Type": "application/json" });
    const body = JSON.parse(init.body);
    expect(body.input).toBe("title: title | text: summary");
    expect(body.model).toBe("ai/embeddinggemma:300M-Q8_0");
    expect(result).toHaveLength(REQUIRED_EMBEDDING_DIM);
  });

  it("throws on dim mismatch", async () => {
    mockFetchOk({ data: [{ embedding: makeEmbedding(1024) }] });
    await expect(embedDocument("t", "s", VALID_CONFIG)).rejects.toThrow(/dim 1024.*expected 768/);
  });

  it("throws on malformed response (missing data[0].embedding)", async () => {
    mockFetchOk({ data: [] });
    await expect(embedDocument("t", "s", VALID_CONFIG)).rejects.toThrow(/malformed response/);
  });

  it("retries on 5xx and eventually succeeds", async () => {
    let calls = 0;
    global.fetch = vi.fn().mockImplementation(() => {
      calls++;
      if (calls < 2) {
        return Promise.resolve({
          ok: false,
          status: 503,
          text: () => Promise.resolve("service unavailable"),
          json: () => Promise.resolve({}),
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ data: [{ embedding: makeEmbedding() }] }),
        text: () => Promise.resolve(""),
      });
    });
    const result = await embedDocument("t", "s", VALID_CONFIG);
    expect(result).toHaveLength(REQUIRED_EMBEDDING_DIM);
    expect(calls).toBeGreaterThanOrEqual(2);
  });

  it("throws after retries exhausted on persistent 5xx", async () => {
    mockFetchStatus(500, "boom");
    await expect(embedDocument("t", "s", VALID_CONFIG)).rejects.toThrow(/returned 500/);
  });

  it("does not retry on 4xx (non-429)", async () => {
    let calls = 0;
    global.fetch = vi.fn().mockImplementation(() => {
      calls++;
      return Promise.resolve({
        ok: false,
        status: 400,
        text: () => Promise.resolve("bad request"),
        json: () => Promise.resolve({}),
      });
    });
    await expect(embedDocument("t", "s", VALID_CONFIG)).rejects.toThrow(/returned 400/);
    expect(calls).toBe(1);
  });
});

describe("embedQuery", () => {
  const originalFetch = global.fetch;
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("uses query format string", async () => {
    mockFetchOk({ data: [{ embedding: makeEmbedding() }] });
    await embedQuery("early holder count", VALID_CONFIG);
    const [, init] = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body.input).toBe("task: search result | query: early holder count");
  });
});
