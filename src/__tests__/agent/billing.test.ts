import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockInferenceConfig, mockProviderBalance, mockUsageState } from "./_fixtures.js";

const mockGetActiveProvider = vi.fn();
const mockInsertSnapshot = vi.fn();
const mockGetUsageStats = vi.fn();

vi.mock("../../agent/providers/registry.js", () => ({
  getActiveProvider: () => mockGetActiveProvider(),
}));
vi.mock("../../agent/db/repos/billing.js", () => ({
  insertSnapshot: (...args: unknown[]) => mockInsertSnapshot(...args),
}));
vi.mock("../../agent/db/repos/usage.js", () => ({
  getUsageStats: (...args: unknown[]) => mockGetUsageStats(...args),
}));
vi.mock("../../utils/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { getProviderBalance, recordBillingSnapshot, getBillingState } = await import(
  "../../agent/billing.js"
);

beforeEach(() => { vi.clearAllMocks(); });

// ── getProviderBalance ──────────────────────────────────────────────

describe("getProviderBalance", () => {
  it("returns balance from active provider", async () => {
    const balance = mockProviderBalance();
    mockGetActiveProvider.mockReturnValue({ getBalance: vi.fn().mockResolvedValue(balance) });
    const result = await getProviderBalance();
    expect(result).toEqual(balance);
  });

  it("returns null when no provider", async () => {
    mockGetActiveProvider.mockReturnValue(null);
    const result = await getProviderBalance();
    expect(result).toBeNull();
  });
});

// ── recordBillingSnapshot ───────────────────────────────────────────

describe("recordBillingSnapshot", () => {
  it("inserts snapshot when balance is available", async () => {
    const balance = mockProviderBalance({ total: 50, available: 45, locked: 5 });
    mockGetActiveProvider.mockReturnValue({ getBalance: vi.fn().mockResolvedValue(balance) });
    mockInsertSnapshot.mockResolvedValue(undefined);

    await recordBillingSnapshot("openrouter", 0.01);

    expect(mockInsertSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        providerBalance: 50,
        providerAvailable: 45,
        providerLocked: 5,
        sessionCost: 0.01,
        provider: "openrouter",
        currency: "0G",
      }),
    );
  });

  it("does not insert when no balance available", async () => {
    mockGetActiveProvider.mockReturnValue({ getBalance: vi.fn().mockResolvedValue(null) });
    await recordBillingSnapshot("openrouter", 0.01);
    expect(mockInsertSnapshot).not.toHaveBeenCalled();
  });

  it("does not insert when no provider", async () => {
    mockGetActiveProvider.mockReturnValue(null);
    await recordBillingSnapshot("openrouter", 0.01);
    expect(mockInsertSnapshot).not.toHaveBeenCalled();
  });
});

// ── getBillingState ─────────────────────────────────────────────────

describe("getBillingState", () => {
  it("assembles full billing state", async () => {
    const balance = mockProviderBalance({ availableRaw: 100, currency: "USD", isLow: false });
    mockGetActiveProvider.mockReturnValue({ getBalance: vi.fn().mockResolvedValue(balance) });
    mockGetUsageStats.mockResolvedValue(mockUsageState({ lifetimeCost: 10, requestCount: 100, sessionCost: 0.5 }));

    const config = mockInferenceConfig({ model: "test-model", priceCurrency: "USD" });
    const state = await getBillingState(config, "sess-1");

    expect(state.providerBalance).toBe(100);
    expect(state.providerCurrency).toBe("USD");
    expect(state.sessionBurn).toBe(0.5);
    expect(state.lifetimeBurn).toBe(10);
    expect(state.avgCostPerRequest).toBe(0.1);
    expect(state.estimatedRequestsRemaining).toBe(1000);
    expect(state.isLowBalance).toBe(false);
    expect(state.model).toBe("test-model");
  });

  it("handles zero request count (no division by zero)", async () => {
    mockGetActiveProvider.mockReturnValue({ getBalance: vi.fn().mockResolvedValue(mockProviderBalance()) });
    mockGetUsageStats.mockResolvedValue(mockUsageState({ requestCount: 0, lifetimeCost: 0 }));

    const state = await getBillingState(mockInferenceConfig());
    expect(state.avgCostPerRequest).toBe(0);
    expect(state.estimatedRequestsRemaining).toBe(0);
  });

  it("handles null provider balance", async () => {
    mockGetActiveProvider.mockReturnValue(null);
    mockGetUsageStats.mockResolvedValue(mockUsageState());

    const config = mockInferenceConfig({ priceCurrency: "0G" });
    const state = await getBillingState(config);

    expect(state.providerBalance).toBe(0);
    expect(state.providerCurrency).toBe("0G");
    expect(state.isLowBalance).toBe(false);
  });

  it("includes pricing from config", async () => {
    mockGetActiveProvider.mockReturnValue(null);
    mockGetUsageStats.mockResolvedValue(mockUsageState());

    const config = mockInferenceConfig({ inputPricePerM: 3, outputPricePerM: 15, priceCurrency: "USD" });
    const state = await getBillingState(config);

    expect(state.pricing.inputPerM).toBe("3.0000");
    expect(state.pricing.outputPerM).toBe("15.0000");
    expect(state.pricing.currency).toBe("USD");
  });
});
