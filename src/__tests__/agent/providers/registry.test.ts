import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockLoadComputeState = vi.fn();

vi.mock("../../../0g-compute/readiness.js", () => ({
  loadComputeState: () => mockLoadComputeState(),
}));
vi.mock("../../../utils/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Mock provider constructors
const mockOpenRouterProvider = {
  id: "openrouter",
  displayName: "OpenRouter",
  loadConfig: vi.fn(),
  getAuthHeaders: vi.fn(),
  getBalance: vi.fn(),
  getEndpoint: vi.fn(),
};

const mockZeroGProvider = {
  id: "0g-compute",
  displayName: "0G Compute",
  loadConfig: vi.fn(),
  getAuthHeaders: vi.fn(),
  getBalance: vi.fn(),
  getEndpoint: vi.fn(),
};

vi.mock("../../../agent/providers/openrouter.js", () => ({
  OpenRouterProvider: function() { return mockOpenRouterProvider; },
}));
vi.mock("../../../agent/providers/0g-compute.js", () => ({
  ZeroGProvider: function() { return mockZeroGProvider; },
}));

const { resolveProvider, getActiveProvider, resetProvider } = await import(
  "../../../agent/providers/registry.js"
);

const savedEnv = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  resetProvider();
  process.env = { ...savedEnv };
  delete process.env.AGENT_PROVIDER;
  delete process.env.OPENROUTER_API_KEY;
});

afterEach(() => {
  process.env = savedEnv;
});

describe("resolveProvider", () => {
  it("resolves OpenRouter when AGENT_PROVIDER=openrouter", async () => {
    process.env.AGENT_PROVIDER = "openrouter";
    const provider = await resolveProvider();
    expect(provider).toBe(mockOpenRouterProvider);
  });

  it("resolves 0G when AGENT_PROVIDER=0g-compute", async () => {
    process.env.AGENT_PROVIDER = "0g-compute";
    const provider = await resolveProvider();
    expect(provider).toBe(mockZeroGProvider);
  });

  it("returns null for unknown AGENT_PROVIDER", async () => {
    process.env.AGENT_PROVIDER = "unknown-provider";
    const provider = await resolveProvider();
    expect(provider).toBeNull();
  });

  it("falls back to OpenRouter when OPENROUTER_API_KEY is set", async () => {
    process.env.OPENROUTER_API_KEY = "sk-test-key";
    const provider = await resolveProvider();
    expect(provider).toBe(mockOpenRouterProvider);
  });

  it("falls back to 0G when compute-state.json exists", async () => {
    mockLoadComputeState.mockReturnValue({ ready: true });
    const provider = await resolveProvider();
    expect(provider).toBe(mockZeroGProvider);
  });

  it("returns null when no provider configured", async () => {
    mockLoadComputeState.mockReturnValue(null);
    const provider = await resolveProvider();
    expect(provider).toBeNull();
  });
});

describe("getActiveProvider", () => {
  it("returns cached provider after resolveProvider", async () => {
    process.env.AGENT_PROVIDER = "openrouter";
    await resolveProvider();
    expect(getActiveProvider()).toBe(mockOpenRouterProvider);
  });

  it("returns null before resolveProvider is called", () => {
    expect(getActiveProvider()).toBeNull();
  });
});

describe("resetProvider", () => {
  it("clears cached provider", async () => {
    process.env.AGENT_PROVIDER = "openrouter";
    await resolveProvider();
    expect(getActiveProvider()).not.toBeNull();
    resetProvider();
    expect(getActiveProvider()).toBeNull();
  });
});
