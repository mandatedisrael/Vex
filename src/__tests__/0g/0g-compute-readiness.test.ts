import { describe, it, expect, vi, beforeEach } from "vitest";
import { existsSync, readFileSync } from "node:fs";

// ── Mock modules ────────────────────────────────────────────────────

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    existsSync: vi.fn(() => false),
    readFileSync: vi.fn(() => ""),
    writeFileSync: vi.fn(),
    renameSync: vi.fn(),
    mkdirSync: vi.fn(),
  };
});

vi.mock("@tools/wallet/auth.js", () => ({
  requireWalletAndKeystore: vi.fn(),
}));

vi.mock("@tools/0g-compute/broker-factory.js", () => ({
  getAuthenticatedBroker: vi.fn(),
}));

vi.mock("@tools/0g-compute/bridge.js", () => ({
  withSuppressedConsole: vi.fn((fn: () => unknown) => fn()),
}));

vi.mock("@tools/0g-compute/constants.js", () => ({
  ZG_COMPUTE_DIR: "/tmp/test-echoclaw-0g-compute",
  ZG_COMPUTE_STATE_FILE: "/tmp/test-echoclaw-0g-compute/compute-state.json",
}));

vi.mock("@utils/logger.js", () => ({
  default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// ── Imports (after mocks) ───────────────────────────────────────────

import { checkComputeReadiness } from "@tools/0g-compute/readiness.js";
import { requireWalletAndKeystore } from "@tools/wallet/auth.js";
import { getAuthenticatedBroker } from "@tools/0g-compute/broker-factory.js";

// ── Helpers ─────────────────────────────────────────────────────────

const mockWallet = requireWalletAndKeystore as ReturnType<typeof vi.fn>;
const mockBroker = getAuthenticatedBroker as ReturnType<typeof vi.fn>;
const mockExistsSync = existsSync as ReturnType<typeof vi.fn>;
const mockReadFileSync = readFileSync as unknown as ReturnType<typeof vi.fn>;

const TEST_PROVIDER = "0x1234567890abcdef1234567890abcdef12345678";

function makeBroker(overrides: {
  ledger?: boolean;
  subAccount?: { balance: bigint; pendingRefund: bigint } | null;
  acked?: boolean;
  services?: Array<{ provider: string; inputPrice: bigint; outputPrice: bigint }>;
} = {}) {
  return {
    ledger: {
      getLedger: overrides.ledger === false
        ? () => { throw new Error("no ledger"); }
        : () => ({}),
      getLedgerWithDetail: () => ({ infers: [] }),
    },
    inference: {
      getAccount: overrides.subAccount === null
        ? () => { throw new Error("no account"); }
        : () => ({
            balance: overrides.subAccount?.balance ?? 5_000000000000000000n,
            pendingRefund: overrides.subAccount?.pendingRefund ?? 0n,
          }),
      acknowledged: () => overrides.acked ?? true,
      listServiceWithDetail: () => overrides.services ?? [{
        provider: TEST_PROVIDER,
        inputPrice: 500_000n,
        outputPrice: 1_000_000n,
        serviceType: "chatbot",
      }],
      getServiceMetadata: () => ({
        endpoint: "https://provider.example.com",
        model: "test-model",
      }),
    },
  };
}

function setupComputeState(provider = TEST_PROVIDER): void {
  mockExistsSync.mockReturnValue(true);
  mockReadFileSync.mockReturnValue(JSON.stringify({
    activeProvider: provider,
    model: "test-model",
    configuredAt: Date.now(),
  }));
}

// ── Tests ───────────────────────────────────────────────────────────

describe("checkComputeReadiness", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(false);
  });

  it("should fail when wallet is not configured", async () => {
    mockWallet.mockImplementation(() => { throw new Error("No wallet"); });

    const result = await checkComputeReadiness();

    expect(result.ready).toBe(false);
    expect(result.checks.wallet.ok).toBe(false);
    expect(result.checks.wallet.detail).toContain("No wallet");
  });

  it("should fail when broker init fails", async () => {
    mockWallet.mockReturnValue({ address: "0xTestAddr", privateKey: "0xkey" });
    mockBroker.mockRejectedValue(new Error("RPC unreachable"));

    const result = await checkComputeReadiness();

    expect(result.ready).toBe(false);
    expect(result.checks.wallet.ok).toBe(true);
    expect(result.checks.broker.ok).toBe(false);
    expect(result.checks.broker.detail).toContain("RPC unreachable");
  });

  it("should fail when no ledger exists", async () => {
    mockWallet.mockReturnValue({ address: "0xTestAddr", privateKey: "0xkey" });
    mockBroker.mockResolvedValue(makeBroker({ ledger: false }));

    const result = await checkComputeReadiness();

    expect(result.ready).toBe(false);
    expect(result.checks.ledger.ok).toBe(false);
  });

  it("should fail when sub-account balance is below threshold", async () => {
    mockWallet.mockReturnValue({ address: "0xTestAddr", privateKey: "0xkey" });
    mockBroker.mockResolvedValue(makeBroker({
      subAccount: {
        balance: 100000000000000000n, // 0.1 0G — below 1.0 minimum
        pendingRefund: 0n,
      },
      services: [{
        provider: TEST_PROVIDER,
        inputPrice: 500_000n,
        outputPrice: 1_000_000n,
      }],
    }));
    setupComputeState();

    const result = await checkComputeReadiness();

    expect(result.ready).toBe(false);
    expect(result.checks.subAccount.ok).toBe(false);
  });

  it("should fail when ACK is false", async () => {
    mockWallet.mockReturnValue({ address: "0xTestAddr", privateKey: "0xkey" });
    mockBroker.mockResolvedValue(makeBroker({ acked: false }));
    setupComputeState();

    const result = await checkComputeReadiness();

    expect(result.ready).toBe(false);
    expect(result.checks.ack.ok).toBe(false);
  });

  it("should return ready=true when all checks pass", async () => {
    mockWallet.mockReturnValue({ address: "0xTestAddr", privateKey: "0xkey" });
    mockBroker.mockResolvedValue(makeBroker({
      services: [{
        provider: TEST_PROVIDER,
        inputPrice: 500_000n,
        outputPrice: 1_000_000n,
      }],
    }));
    setupComputeState();

    const result = await checkComputeReadiness();

    expect(result.ready).toBe(true);
    expect(result.provider).toBe(TEST_PROVIDER);
    expect(Object.values(result.checks).every(c => c.ok)).toBe(true);
  });

  it("should recover provider from sub-account scan when no compute-state.json", async () => {
    mockWallet.mockReturnValue({ address: "0xTestAddr", privateKey: "0xkey" });

    const brokerInstance = makeBroker();
    brokerInstance.ledger.getLedgerWithDetail = () => ({
      infers: [[TEST_PROVIDER, 5_000000000000000000n, 0n]],
    });
    mockBroker.mockResolvedValue(brokerInstance);
    mockExistsSync.mockReturnValue(false);

    const result = await checkComputeReadiness();

    expect(result.ready).toBe(true);
    expect(result.provider).toBe(TEST_PROVIDER);
  });
});
