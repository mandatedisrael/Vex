import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockProviderBalance } from "./_fixtures.js";

const mockGetProviderBalance = vi.fn();
const mockGetInferenceConfig = vi.fn();
const mockGetActiveProvider = vi.fn();
const mockPublish = vi.fn();
const mockRecordEvent = vi.fn();
const mockUpdateBaseline = vi.fn();

vi.mock("../../agent/billing.js", () => ({
  getProviderBalance: () => mockGetProviderBalance(),
}));
vi.mock("../../agent/engine.js", () => ({
  getInferenceConfig: () => mockGetInferenceConfig(),
}));
vi.mock("../../agent/providers/registry.js", () => ({
  getActiveProvider: () => mockGetActiveProvider(),
}));
vi.mock("../../agent/autonomy-inbox.js", () => ({
  publish: (...args: unknown[]) => mockPublish(...args),
}));
vi.mock("../../agent/db/repos/topup.js", () => ({
  recordEvent: (...args: unknown[]) => mockRecordEvent(...args),
  updateBaseline: (...args: unknown[]) => mockUpdateBaseline(...args),
}));
vi.mock("../../utils/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { checkBalance, onTopupSuccess, _resetForTest, startMonitor, stopMonitor } =
  await import("../../agent/topup-monitor.js");

beforeEach(() => {
  vi.clearAllMocks();
  _resetForTest();
  mockGetInferenceConfig.mockReturnValue({ provider: "0g-compute", model: "test" });
  mockGetActiveProvider.mockReturnValue({ id: "0g-compute", getBalance: vi.fn() });
  mockRecordEvent.mockResolvedValue(undefined);
  mockPublish.mockResolvedValue(undefined);
  mockUpdateBaseline.mockResolvedValue(undefined);
});

describe("checkBalance", () => {
  it("returns early when no inference config", async () => {
    mockGetInferenceConfig.mockReturnValue(null);
    await checkBalance();
    expect(mockPublish).not.toHaveBeenCalled();
  });

  it("returns early for non-0G provider", async () => {
    mockGetActiveProvider.mockReturnValue({ id: "openrouter" });
    await checkBalance();
    expect(mockPublish).not.toHaveBeenCalled();
  });

  it("does nothing when balance is not low", async () => {
    mockGetActiveProvider.mockReturnValue({
      id: "0g-compute",
      getBalance: vi.fn().mockResolvedValue(mockProviderBalance({ isLow: false })),
    });
    await checkBalance();
    expect(mockPublish).not.toHaveBeenCalled();
  });

  it("publishes compute_balance_low when balance is low", async () => {
    mockGetActiveProvider.mockReturnValue({
      id: "0g-compute",
      getBalance: vi.fn().mockResolvedValue(
        mockProviderBalance({ isLow: true, availableRaw: 2, availableDisplay: "2.00 0G", currency: "0G" }),
      ),
    });

    await checkBalance();

    expect(mockPublish).toHaveBeenCalledWith(
      "compute_balance_low",
      expect.objectContaining({ available: 2 }),
    );
    expect(mockRecordEvent).toHaveBeenCalled();
  });

  it("respects cooldown between alerts", async () => {
    const lowBalance = mockProviderBalance({ isLow: true, availableRaw: 1, availableDisplay: "1.00 0G", currency: "0G" });
    mockGetActiveProvider.mockReturnValue({
      id: "0g-compute",
      getBalance: vi.fn().mockResolvedValue(lowBalance),
    });

    await checkBalance(); // first alert
    await checkBalance(); // within cooldown

    expect(mockPublish).toHaveBeenCalledTimes(1);
  });

  it("resets consecutive alerts when balance recovers", async () => {
    const lowBalance = mockProviderBalance({ isLow: true, availableRaw: 1, availableDisplay: "1.00 0G" });
    const goodBalance = mockProviderBalance({ isLow: false, availableRaw: 50 });

    const mockGetBalance = vi.fn()
      .mockResolvedValueOnce(lowBalance)
      .mockResolvedValueOnce(goodBalance);

    mockGetActiveProvider.mockReturnValue({ id: "0g-compute", getBalance: mockGetBalance });

    await checkBalance(); // low
    _resetForTest(); // simulate cooldown passed
    await checkBalance(); // recovered

    // No second publish (balance is fine)
    expect(mockPublish).toHaveBeenCalledTimes(1);
  });

  it("does not throw on DB error", async () => {
    mockGetActiveProvider.mockReturnValue({
      id: "0g-compute",
      getBalance: vi.fn().mockRejectedValue(new Error("DB down")),
    });

    await expect(checkBalance()).resolves.toBeUndefined();
  });
});

describe("onTopupSuccess", () => {
  it("updates baseline and records success event", async () => {
    await onTopupSuccess(50, 100, 25);

    expect(mockUpdateBaseline).toHaveBeenCalledWith(50, 100, 25);
    expect(mockRecordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "topup_succeeded",
        amount: 25,
        balanceAfter: 50,
      }),
    );
  });
});

describe("startMonitor / stopMonitor", () => {
  it("start is idempotent", () => {
    startMonitor();
    startMonitor(); // second call should not create a second interval
    stopMonitor();
  });

  it("stop clears the interval", () => {
    startMonitor();
    stopMonitor();
    // No error on second stop
    stopMonitor();
  });
});
