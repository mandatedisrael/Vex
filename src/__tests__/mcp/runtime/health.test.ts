import { beforeEach, describe, expect, it, vi } from "vitest";
import { EchoError, ErrorCodes } from "../../../errors.js";

const mockQuery = vi.fn();
const mockLoadEmbeddingConfig = vi.fn();
const mockFetchWithTimeout = vi.fn();

vi.mock("@echo-agent/db/client.js", () => ({
  getPool: () => ({
    query: (...args: unknown[]) => mockQuery(...args),
  }),
}));

vi.mock("@echo-agent/embeddings/config.js", () => ({
  EMBEDDING_REQUEST_TIMEOUT_MS: 30_000,
  loadEmbeddingConfig: (...args: unknown[]) => mockLoadEmbeddingConfig(...args),
}));

vi.mock("@utils/http.js", () => ({
  fetchWithTimeout: (...args: unknown[]) => mockFetchWithTimeout(...args),
}));

const { McpHealthError, probeEmbeddings } = await import("../../../mcp/runtime/health.js");

describe("mcp runtime health", () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockLoadEmbeddingConfig.mockReset();
    mockFetchWithTimeout.mockReset();
    mockLoadEmbeddingConfig.mockReturnValue({
      baseUrl: "http://localhost:12434/engines/llama.cpp/v1",
      model: "ai/embeddinggemma:300M-Q8_0",
      dim: 3,
      provider: "local",
    });
  });

  it("uses the shared timeout wrapper for the embeddings probe", async () => {
    mockFetchWithTimeout.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: [{ embedding: [0.1, 0.2, 0.3] }] }),
    } as Response);

    await probeEmbeddings();

    expect(mockFetchWithTimeout).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetchWithTimeout.mock.calls[0];
    expect(url).toBe("http://localhost:12434/engines/llama.cpp/v1/embeddings");
    expect(init).toMatchObject({
      method: "POST",
      headers: { "content-type": "application/json" },
      timeoutMs: 30_000,
    });
  });

  it("wraps timeout failures as McpHealthError with fail-fast guidance", async () => {
    mockFetchWithTimeout.mockRejectedValue(
      new EchoError(
        ErrorCodes.HTTP_TIMEOUT,
        "Request timed out after 30000ms",
        "Check network connectivity or try again later",
      ),
    );

    const error = await probeEmbeddings().catch((err) => err);

    expect(error).toBeInstanceOf(McpHealthError);
    expect(error).toMatchObject({
      name: "McpHealthError",
      message: expect.stringContaining("Request timed out after 30000ms"),
      hint: expect.stringContaining("within 30000ms"),
    });
  });
});
