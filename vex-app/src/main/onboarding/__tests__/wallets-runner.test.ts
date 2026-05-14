/**
 * Tests for wallets-runner — the M8 main-side wrapper around engine
 * createWallet/importWallet. Mocks @vex-lib/wallet so we exercise the
 * VexError → public Result mapping without touching real keystore I/O.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockCreateWallet = vi.fn();
const mockCreateSolanaWallet = vi.fn();
const mockImportWallet = vi.fn();
const mockImportSolanaWallet = vi.fn();

vi.mock("@vex-lib/wallet.js", () => ({
  createWallet: () => mockCreateWallet(),
  createSolanaWallet: () => mockCreateSolanaWallet(),
  importWallet: (rawKey: string) => mockImportWallet(rawKey),
  importSolanaWallet: (rawKey: string) => mockImportSolanaWallet(rawKey),
}));

vi.mock("../../logger/index.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const {
  generateEvmWallet,
  generateSolanaWallet,
  importEvmWallet,
  importSolanaWalletRunner,
  mapWalletEngineError,
} = await import("../wallets-runner.js");

class FakeVexError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "VexError";
  }
}

beforeEach(() => {
  mockCreateWallet.mockReset();
  mockCreateSolanaWallet.mockReset();
  mockImportWallet.mockReset();
  mockImportSolanaWallet.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("generateEvmWallet", () => {
  it("returns ok({address}) on engine success", async () => {
    mockCreateWallet.mockResolvedValue({
      address: "0xabcdef0123456789abcdef0123456789abcdef01",
      chainId: 1,
      overwritten: false,
    });
    const result = await generateEvmWallet();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.address).toBe(
        "0xabcdef0123456789abcdef0123456789abcdef01"
      );
    }
  });

  it("maps KEYSTORE_ALREADY_EXISTS to wallet.policy_blocked", async () => {
    mockCreateWallet.mockRejectedValue(
      new FakeVexError("KEYSTORE_ALREADY_EXISTS", "Keystore already exists.")
    );
    const result = await generateEvmWallet();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("wallet.policy_blocked");
      expect(result.error.userActionable).toBe(true);
    }
  });

  it("maps KEYSTORE_PASSWORD_NOT_SET to wallet.password_invalid", async () => {
    mockCreateWallet.mockRejectedValue(
      new FakeVexError("KEYSTORE_PASSWORD_NOT_SET", "Password not set.")
    );
    const result = await generateEvmWallet();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("wallet.password_invalid");
  });
});

describe("generateSolanaWallet", () => {
  it("returns ok({address}) on engine success", async () => {
    mockCreateSolanaWallet.mockResolvedValue({
      address: "DRpbCBMxVnDK7maPM5tGv6MvCsx1WTokJBKVz5Pk5Hxe",
      overwritten: false,
    });
    const result = await generateSolanaWallet();
    expect(result.ok).toBe(true);
    if (result.ok)
      expect(result.data.address).toBe(
        "DRpbCBMxVnDK7maPM5tGv6MvCsx1WTokJBKVz5Pk5Hxe"
      );
  });
});

describe("importEvmWallet", () => {
  it("rejects bad EVM private key format with validation.invalid_input", async () => {
    mockImportWallet.mockRejectedValue(
      new Error("Invalid private key: must be 32 bytes hex")
    );
    const result = await importEvmWallet("garbage");
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error.code).toBe("validation.invalid_input");
  });

  it("returns ok on engine success", async () => {
    mockImportWallet.mockResolvedValue({
      address: "0xabcdef0123456789abcdef0123456789abcdef01",
      chainId: 1,
      overwritten: false,
    });
    const result = await importEvmWallet("0xabc…valid…");
    expect(result.ok).toBe(true);
  });
});

describe("importSolanaWalletRunner", () => {
  it("maps INVALID_PRIVATE_KEY VexError to validation.invalid_input", async () => {
    mockImportSolanaWallet.mockRejectedValue(
      new FakeVexError(
        "INVALID_PRIVATE_KEY",
        "Solana secret key must be base58 or JSON byte array"
      )
    );
    const result = await importSolanaWalletRunner("garbage");
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error.code).toBe("validation.invalid_input");
  });
});

describe("mapWalletEngineError", () => {
  it("maps unrecognised errors to internal.unexpected", () => {
    const result = mapWalletEngineError(new Error("totally unexpected"));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("internal.unexpected");
  });

  it("maps AUTO_BACKUP_FAILED to onboarding.env_persist_failed", () => {
    const result = mapWalletEngineError(
      new FakeVexError("AUTO_BACKUP_FAILED", "boom")
    );
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error.code).toBe("onboarding.env_persist_failed");
  });

  it("maps KEYSTORE_DECRYPT_FAILED to wallet.password_invalid", () => {
    const result = mapWalletEngineError(
      new FakeVexError("KEYSTORE_DECRYPT_FAILED", "wrong pass")
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("wallet.password_invalid");
  });

  it("maps KEYSTORE_NOT_FOUND to wallet.keystore_missing (distinct from corrupt)", () => {
    const result = mapWalletEngineError(
      new FakeVexError("KEYSTORE_NOT_FOUND", "file missing")
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("wallet.keystore_missing");
  });

  it("maps KEYSTORE_CORRUPT to wallet.keystore_corrupt (file present but bad)", () => {
    const result = mapWalletEngineError(
      new FakeVexError("KEYSTORE_CORRUPT", "bad schema")
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("wallet.keystore_corrupt");
  });
});
