import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const PROVIDER_ADDRESS = "0xPROVIDER0000000000000000000000000000abcd";
const SERVICE_ENDPOINT = "https://example.0g/v1";
const SERVICE_MODEL = "phi-4";

const computeState = { activeProvider: PROVIDER_ADDRESS, model: SERVICE_MODEL, configuredAt: 0 };

const getRequestHeaders = vi.fn(async (_addr: string, _content: string) => ({
  "X-0g-Auth": "stub-hmac",
}));

vi.mock("../../../tools/0g-compute/readiness.js", () => ({
  loadComputeState: () => computeState,
  saveComputeState: vi.fn(),
}));

vi.mock("../../../tools/0g-compute/broker-factory.js", () => ({
  getAuthenticatedBroker: async () => ({
    inference: { getRequestHeaders },
  }),
}));

vi.mock("../../../tools/0g-compute/operations.js", () => ({
  getServiceMetadata: vi.fn(async () => ({ model: SERVICE_MODEL, endpoint: SERVICE_ENDPOINT })),
  listChatServices: vi.fn(async () => []),
  getLedgerBalance: vi.fn(async () => null),
  getSubAccountBalance: vi.fn(async () => null),
}));

vi.mock("../../../tools/0g-compute/pricing.js", () => ({
  calculateProviderPricing: () => ({ recommendedAlertLockedOg: 0.0001 }),
  formatPricePerMTokens: () => "1.0",
}));

const { ZeroGComputeProvider } = await import("../../../echo-agent/inference/0g-compute.js");

describe("ZeroGComputeProvider — endpoint cache", () => {
  let originalFetch: typeof fetch;
  let fetchMock: ReturnType<typeof vi.fn>;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    delete process.env.AGENT_PROVIDER;
    delete process.env.AGENT_MODEL;
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.AGENT_TEMPERATURE;
    delete process.env.AGENT_CONTEXT_LIMIT;
    delete process.env.AGENT_MAX_OUTPUT_TOKENS;

    originalFetch = globalThis.fetch;
    fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => "",
      json: async () => ({
        choices: [{ message: { content: "hello back", tool_calls: undefined }, finish_reason: "stop" }],
        usage: { prompt_tokens: 4, completion_tokens: 2 },
      }),
    } as unknown as Response));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    getRequestHeaders.mockClear();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    process.env = originalEnv;
  });

  it("loadConfig returns provider id, not the on-chain address", async () => {
    const provider = new ZeroGComputeProvider();
    const config = await provider.loadConfig();

    expect(config).not.toBeNull();
    expect(config!.provider).toBe("0g-compute");
    expect(config!.provider).not.toBe(PROVIDER_ADDRESS);
    expect(config!.model).toBe(SERVICE_MODEL);
  });

  it("doFetch hits the service endpoint, not the provider address", async () => {
    const provider = new ZeroGComputeProvider();
    const config = await provider.loadConfig();
    expect(config).not.toBeNull();

    await provider.chatCompletionSimple(
      [{ role: "user", content: "ping" }],
      config!,
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const requestedUrl = fetchMock.mock.calls[0]![0] as string;
    expect(requestedUrl).toBe(`${SERVICE_ENDPOINT}/chat/completions`);
    expect(requestedUrl).not.toContain(PROVIDER_ADDRESS);

    expect(getRequestHeaders).toHaveBeenCalledWith(PROVIDER_ADDRESS, expect.any(String));
  });

  it("chatCompletion throws if loadConfig was never called", async () => {
    const provider = new ZeroGComputeProvider();
    const config = {
      provider: "0g-compute",
      model: SERVICE_MODEL,
      contextLimit: 32_000,
      maxOutputTokens: 1024,
      inputPricePerM: 1,
      outputPricePerM: 1,
      priceCurrency: "0G" as const,
      cachePricePerM: null,
      reasoningPricePerM: null,
    };

    await expect(
      provider.chatCompletionSimple([{ role: "user", content: "ping" }], config),
    ).rejects.toThrow(/endpoint not loaded/);
  });
});
