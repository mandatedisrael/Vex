/**
 * Tests for the vex.wallet.exportPrivateKey IPC handler.
 *
 * Mocks: electron (ipcMain + clipboard), secrets/session, export-throttle,
 * verifySecretVaultPassword, engine keystore loaders, lifecycle/cleanup
 * registry, logger. Exercises the full handler control flow without
 * touching real keystores, the vault file, or the actual OS clipboard.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createTestWebContents,
  createTrustedSender,
  type TestIpcEvent,
} from "./test-sender.js";

type Handler = (
  event: TestIpcEvent,
  raw: unknown,
) => Promise<unknown>;

const handlers = new Map<string, Handler>();

// ── clipboard mock ─────────────────────────────────────────────────────────
let clipboardText = "";
const mockClipboardWriteText = vi.fn((text: string) => {
  clipboardText = text;
});
const mockClipboardReadText = vi.fn(() => clipboardText);
const mockClipboardClear = vi.fn(() => {
  clipboardText = "";
});

// ── session mocks ─────────────────────────────────────────────────────────
const mockGetSecretSessionStatus = vi.fn();
const mockLockSecretSession = vi.fn();

// ── throttle mocks ────────────────────────────────────────────────────────
const mockCheckExportAllowed = vi.fn();
const mockRecordExportFailure = vi.fn();
const mockRecordExportSuccess = vi.fn();

// ── vault verify mock ─────────────────────────────────────────────────────
const mockVerifySecretVaultPassword = vi.fn();

// LocalSecretVaultError clone (matches engine's surface used by handler).
class LocalSecretVaultErrorMock extends Error {
  constructor(
    message: string,
    readonly code: "missing" | "invalid_password" | "corrupt" | "io",
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "LocalSecretVaultError";
  }
}

// ── keystore loader + decrypt mocks ────────────────────────────────────────
const mockLoadKeystore = vi.fn();
const mockLoadSolanaKeystore = vi.fn();
const mockDecryptPrivateKey = vi.fn();
const mockDecryptSolanaSecretKey = vi.fn();
const mockEncodeSolanaSecretKey = vi.fn();

// VexError clone surfaced by keystore loaders on parse failure.
class FakeEngineVexError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "VexError";
  }
}

// ── cleanup registry mock ─────────────────────────────────────────────────
// Match the surface used: add(task) returns an unregister fn (async).
// Track active tasks so tests can simulate "app quit fires cleanup".
type CleanupTask = () => void | Promise<void>;
const cleanupTasks = new Set<CleanupTask>();
const mockGlobalCleanupAdd = vi.fn((task: CleanupTask) => {
  cleanupTasks.add(task);
  return async (): Promise<void> => {
    cleanupTasks.delete(task);
    await task();
  };
});

function runAllCleanup(): Promise<void> {
  const snapshot = [...cleanupTasks];
  cleanupTasks.clear();
  return Promise.allSettled(snapshot.map((t) => t())).then(() => undefined);
}

// ── module mocks ──────────────────────────────────────────────────────────
vi.mock("electron", () => ({
  ipcMain: {
    handle: (channel: string, fn: Handler) => {
      handlers.set(channel, fn);
    },
    removeHandler: (channel: string) => {
      handlers.delete(channel);
    },
  },
  app: { isPackaged: true },
  clipboard: {
    writeText: (text: string) => mockClipboardWriteText(text),
    readText: () => mockClipboardReadText(),
    clear: () => mockClipboardClear(),
  },
}));

vi.mock("../../secrets/session.js", () => ({
  getSecretSessionStatus: () => mockGetSecretSessionStatus(),
  lockSecretSession: () => mockLockSecretSession(),
}));

vi.mock("../../wallet/export-throttle.js", () => ({
  checkExportAllowed: () => mockCheckExportAllowed(),
  recordExportFailure: () => mockRecordExportFailure(),
  recordExportSuccess: () => mockRecordExportSuccess(),
}));

vi.mock("@vex-lib/local-secret-vault.js", () => ({
  LocalSecretVaultError: LocalSecretVaultErrorMock,
  verifySecretVaultPassword: (...args: unknown[]) =>
    mockVerifySecretVaultPassword(...args),
}));

vi.mock("@vex-lib/wallet.js", () => ({
  loadKeystore: () => mockLoadKeystore(),
  loadSolanaKeystore: () => mockLoadSolanaKeystore(),
  decryptPrivateKey: (keystore: unknown, password: string) =>
    mockDecryptPrivateKey(keystore, password),
  decryptSolanaSecretKey: (keystore: unknown, password: string) =>
    mockDecryptSolanaSecretKey(keystore, password),
  encodeSolanaSecretKey: (bytes: Uint8Array) =>
    mockEncodeSolanaSecretKey(bytes),
}));

vi.mock("../../paths/config-dir.js", () => ({
  SECRETS_VAULT_FILE: "/tmp/vex-test-vault",
}));

vi.mock("../../lifecycle/cleanup-registry.js", () => ({
  globalCleanup: {
    add: (task: CleanupTask) => mockGlobalCleanupAdd(task),
  },
}));

const mockLog = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

vi.mock("../../logger/index.js", () => ({
  log: mockLog,
}));

const {
  registerWalletExportHandler,
  __resetWalletExportStateForTests,
  __getActiveLeaseTokenForTests,
} = await import("../wallet-export.js");
const { CH } = await import("@shared/ipc/channels.js");
const { walletExportPrivateKeyInputSchema } = await import(
  "@shared/schemas/wallets.js"
);

const trustedSender = createTrustedSender({ sender: createTestWebContents() });

const VALID_INPUT_EVM = {
  chain: "evm" as const,
  password: "master-password-12",
  riskAcknowledged: true as const,
};

const VALID_INPUT_SOLANA = {
  chain: "solana" as const,
  password: "master-password-12",
  riskAcknowledged: true as const,
};

const STUB_KEYSTORE_EVM = {
  version: 1,
  ciphertext: "x",
  iv: "y",
  salt: "z",
  tag: "t",
  kdf: { name: "scrypt", N: 16384, r: 8, p: 1, dkLen: 32 },
};

const STUB_KEYSTORE_SOLANA = { ...STUB_KEYSTORE_EVM };

beforeEach(() => {
  vi.useFakeTimers();
  clipboardText = "";
  handlers.clear();
  cleanupTasks.clear();
  mockClipboardWriteText.mockClear();
  mockClipboardReadText.mockClear();
  mockClipboardClear.mockClear();
  mockGetSecretSessionStatus.mockReset();
  mockLockSecretSession.mockReset();
  mockCheckExportAllowed.mockReset();
  mockRecordExportFailure.mockReset();
  mockRecordExportSuccess.mockReset();
  mockVerifySecretVaultPassword.mockReset();
  mockLoadKeystore.mockReset();
  mockLoadSolanaKeystore.mockReset();
  mockDecryptPrivateKey.mockReset();
  mockDecryptSolanaSecretKey.mockReset();
  mockEncodeSolanaSecretKey.mockReset();
  mockGlobalCleanupAdd.mockClear();
  mockLog.info.mockClear();
  mockLog.warn.mockClear();
  mockLog.error.mockClear();
  mockLog.debug.mockClear();
  __resetWalletExportStateForTests();
});

afterEach(() => {
  __resetWalletExportStateForTests();
  handlers.clear();
  cleanupTasks.clear();
  vi.useRealTimers();
  vi.clearAllMocks();
});

function getHandler(): Handler {
  registerWalletExportHandler();
  const fn = handlers.get(CH.wallet.exportPrivateKey);
  if (!fn) throw new Error("handler not registered");
  return fn;
}

interface ErrResult {
  readonly ok: false;
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly retryAfterMs?: number;
    readonly correlationId?: string;
    readonly domain: string;
    readonly retryable: boolean;
    readonly userActionable: boolean;
  };
}

interface OkResult<T> {
  readonly ok: true;
  readonly data: T;
}

// ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ──

describe("input validation (Zod schema at boundary)", () => {
  it("rejects when riskAcknowledged is false", () => {
    const parsed = walletExportPrivateKeyInputSchema.safeParse({
      chain: "evm",
      password: "master-password-12",
      riskAcknowledged: false,
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects when riskAcknowledged is missing", () => {
    const parsed = walletExportPrivateKeyInputSchema.safeParse({
      chain: "evm",
      password: "master-password-12",
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects passwords below the configured minimum", () => {
    const parsed = walletExportPrivateKeyInputSchema.safeParse({
      chain: "evm",
      password: "short",
      riskAcknowledged: true,
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects unknown chains", () => {
    const parsed = walletExportPrivateKeyInputSchema.safeParse({
      chain: "bitcoin",
      password: "master-password-12",
      riskAcknowledged: true,
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects extra (strict-mode) properties", () => {
    const parsed = walletExportPrivateKeyInputSchema.safeParse({
      chain: "evm",
      password: "master-password-12",
      riskAcknowledged: true,
      extra: "smuggle",
    });
    expect(parsed.success).toBe(false);
  });

  it("accepts a fully-formed valid input", () => {
    const parsed = walletExportPrivateKeyInputSchema.safeParse(VALID_INPUT_EVM);
    expect(parsed.success).toBe(true);
  });
});

// ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ──

describe("throttle gate", () => {
  it("returns wallet.export_throttled with retryAfterMs when gate denies the attempt", async () => {
    mockCheckExportAllowed.mockReturnValue({
      allowed: false,
      retryAfterMs: 4_000,
      lockoutTriggered: false,
    });
    const fn = getHandler();

    const result = (await fn(trustedSender, {
      requestId: "throttled-1",
      payload: VALID_INPUT_EVM,
    })) as ErrResult;

    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("wallet.export_throttled");
    expect(result.error.retryAfterMs).toBe(4_000);
    expect(result.error.retryable).toBe(true);
    expect(result.error.domain).toBe("wallet");
    expect(result.error.correlationId).toBe("throttled-1");
    // Downstream calls must NOT run while the gate is closed.
    expect(mockVerifySecretVaultPassword).not.toHaveBeenCalled();
    expect(mockLoadKeystore).not.toHaveBeenCalled();
    expect(mockClipboardWriteText).not.toHaveBeenCalled();
  });
});

// ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ──

describe("session lock check", () => {
  it("returns wallet.keystore_locked when the session is locked", async () => {
    mockCheckExportAllowed.mockReturnValue({ allowed: true });
    mockGetSecretSessionStatus.mockReturnValue({
      vaultConfigured: true,
      unlocked: false,
    });
    const fn = getHandler();

    const result = (await fn(trustedSender, {
      requestId: "locked-1",
      payload: VALID_INPUT_EVM,
    })) as ErrResult;

    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("wallet.keystore_locked");
    // Verify the handler did not reach the decryption stage.
    expect(mockVerifySecretVaultPassword).not.toHaveBeenCalled();
    expect(mockClipboardWriteText).not.toHaveBeenCalled();
  });
});

// ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ──

describe("password re-auth", () => {
  beforeEach(() => {
    mockCheckExportAllowed.mockReturnValue({ allowed: true });
    mockGetSecretSessionStatus.mockReturnValue({
      vaultConfigured: true,
      unlocked: true,
    });
  });

  it("returns wallet.password_invalid and records throttle failure on wrong password", async () => {
    mockVerifySecretVaultPassword.mockImplementation(() => {
      throw new LocalSecretVaultErrorMock("wrong", "invalid_password");
    });
    mockRecordExportFailure.mockReturnValue({ lockoutTriggered: false });
    mockCheckExportAllowed
      // First call (initial gate) — allowed.
      .mockReturnValueOnce({ allowed: true })
      // Second call (post-failure surface a retryAfterMs hint) — denied.
      .mockReturnValueOnce({
        allowed: false,
        retryAfterMs: 1_000,
        lockoutTriggered: false,
      });
    const fn = getHandler();

    const result = (await fn(trustedSender, {
      requestId: "wp-1",
      payload: VALID_INPUT_EVM,
    })) as ErrResult;

    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("wallet.password_invalid");
    expect(result.error.retryAfterMs).toBe(1_000);
    expect(mockRecordExportFailure).toHaveBeenCalledTimes(1);
    expect(mockLockSecretSession).not.toHaveBeenCalled();
    expect(mockClipboardWriteText).not.toHaveBeenCalled();
  });

  it("relocks the vault and returns keystore_locked on the 5th wrong password (lockoutTriggered)", async () => {
    mockVerifySecretVaultPassword.mockImplementation(() => {
      throw new LocalSecretVaultErrorMock("wrong", "invalid_password");
    });
    mockRecordExportFailure.mockReturnValue({ lockoutTriggered: true });
    const fn = getHandler();

    const result = (await fn(trustedSender, {
      requestId: "lockout-1",
      payload: VALID_INPUT_EVM,
    })) as ErrResult;

    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("wallet.keystore_locked");
    expect(result.error.message).toMatch(/relocked|re-enter/i);
    expect(mockLockSecretSession).toHaveBeenCalledTimes(1);
    expect(mockClipboardWriteText).not.toHaveBeenCalled();
  });

  it("returns wallet.vault_not_configured on LocalSecretVaultError(missing)", async () => {
    mockVerifySecretVaultPassword.mockImplementation(() => {
      throw new LocalSecretVaultErrorMock("missing", "missing");
    });
    const fn = getHandler();

    const result = (await fn(trustedSender, {
      requestId: "missing-1",
      payload: VALID_INPUT_EVM,
    })) as ErrResult;

    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("wallet.vault_not_configured");
    // Must NOT advance the throttle counter — IO/state issue, not attacker.
    expect(mockRecordExportFailure).not.toHaveBeenCalled();
  });

  it("does NOT advance the throttle on non-password vault errors (corrupt/io)", async () => {
    mockVerifySecretVaultPassword.mockImplementation(() => {
      throw new LocalSecretVaultErrorMock("io", "io");
    });
    const fn = getHandler();

    const result = (await fn(trustedSender, {
      requestId: "io-1",
      payload: VALID_INPUT_EVM,
    })) as ErrResult;

    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("internal.unexpected");
    expect(mockRecordExportFailure).not.toHaveBeenCalled();
    expect(mockLockSecretSession).not.toHaveBeenCalled();
  });
});

// ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ──

describe("keystore loading", () => {
  beforeEach(() => {
    mockCheckExportAllowed.mockReturnValue({ allowed: true });
    mockGetSecretSessionStatus.mockReturnValue({
      vaultConfigured: true,
      unlocked: true,
    });
    mockVerifySecretVaultPassword.mockReturnValue(undefined);
  });

  it("returns wallet.keystore_missing when EVM keystore loader yields null", async () => {
    mockLoadKeystore.mockReturnValue(null);
    const fn = getHandler();

    const result = (await fn(trustedSender, {
      requestId: "ks-missing-evm",
      payload: VALID_INPUT_EVM,
    })) as ErrResult;

    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("wallet.keystore_missing");
    expect(mockDecryptPrivateKey).not.toHaveBeenCalled();
    expect(mockClipboardWriteText).not.toHaveBeenCalled();
  });

  it("returns wallet.keystore_missing when Solana keystore loader yields null", async () => {
    mockLoadSolanaKeystore.mockReturnValue(null);
    const fn = getHandler();

    const result = (await fn(trustedSender, {
      requestId: "ks-missing-sol",
      payload: VALID_INPUT_SOLANA,
    })) as ErrResult;

    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("wallet.keystore_missing");
  });

  it("returns wallet.keystore_corrupt when the loader throws KEYSTORE_CORRUPT", async () => {
    mockLoadKeystore.mockImplementation(() => {
      throw new FakeEngineVexError("KEYSTORE_CORRUPT", "bad schema");
    });
    const fn = getHandler();

    const result = (await fn(trustedSender, {
      requestId: "ks-corrupt-1",
      payload: VALID_INPUT_EVM,
    })) as ErrResult;

    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("wallet.keystore_corrupt");
  });

  it("returns wallet.keystore_corrupt on unrecognised loader exceptions (defensive)", async () => {
    mockLoadKeystore.mockImplementation(() => {
      throw new Error("unexpected loader explosion");
    });
    const fn = getHandler();

    const result = (await fn(trustedSender, {
      requestId: "ks-explode-1",
      payload: VALID_INPUT_EVM,
    })) as ErrResult;

    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("wallet.keystore_corrupt");
  });
});

// ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ──

describe("success path — EVM", () => {
  beforeEach(() => {
    mockCheckExportAllowed.mockReturnValue({ allowed: true });
    mockGetSecretSessionStatus.mockReturnValue({
      vaultConfigured: true,
      unlocked: true,
    });
    mockVerifySecretVaultPassword.mockReturnValue(undefined);
    mockLoadKeystore.mockReturnValue(STUB_KEYSTORE_EVM);
  });

  it("writes the hex private key to clipboard and returns the expected shape", async () => {
    const EVM_SECRET =
      "0xabcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";
    mockDecryptPrivateKey.mockReturnValue(EVM_SECRET);
    const fn = getHandler();

    const result = (await fn(trustedSender, {
      requestId: "ok-evm",
      payload: VALID_INPUT_EVM,
    })) as OkResult<{
      chain: string;
      format: string;
      copied: boolean;
      clearAfterMs: number;
    }>;

    expect(result.ok).toBe(true);
    expect(result.data).toEqual({
      chain: "evm",
      format: "hex",
      copied: true,
      clearAfterMs: 10_000,
    });
    expect(mockClipboardWriteText).toHaveBeenCalledWith(EVM_SECRET);
    expect(mockRecordExportSuccess).toHaveBeenCalledTimes(1);
    expect(mockGlobalCleanupAdd).toHaveBeenCalledTimes(1);
    expect(__getActiveLeaseTokenForTests()).not.toBeNull();
  });

  it("audit-logs metadata only — secret never appears in log args", async () => {
    const EVM_SECRET =
      "0xabcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";
    mockDecryptPrivateKey.mockReturnValue(EVM_SECRET);
    const fn = getHandler();

    await fn(trustedSender, {
      requestId: "audit-1",
      payload: VALID_INPUT_EVM,
    });

    const allLogArgs = [
      ...mockLog.info.mock.calls.flat(),
      ...mockLog.warn.mock.calls.flat(),
      ...mockLog.error.mock.calls.flat(),
      ...mockLog.debug.mock.calls.flat(),
    ]
      .filter((v): v is string => typeof v === "string")
      .join("\n");
    expect(allLogArgs).not.toContain(EVM_SECRET);
    // The metadata audit line should still mention the chain + correlationId.
    expect(mockLog.info).toHaveBeenCalledWith(
      expect.stringMatching(/chain=evm.*correlationId=audit-1/),
    );
  });
});

// ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ──

describe("success path — Solana", () => {
  beforeEach(() => {
    mockCheckExportAllowed.mockReturnValue({ allowed: true });
    mockGetSecretSessionStatus.mockReturnValue({
      vaultConfigured: true,
      unlocked: true,
    });
    mockVerifySecretVaultPassword.mockReturnValue(undefined);
    mockLoadSolanaKeystore.mockReturnValue(STUB_KEYSTORE_SOLANA);
  });

  it("zeroizes the decrypted Uint8Array after encoding, writes base58 to clipboard", async () => {
    const SOLANA_BYTES = new Uint8Array(64);
    SOLANA_BYTES.fill(7);
    const BASE58 = "fakebase58encodedsecret1234567890";
    mockDecryptSolanaSecretKey.mockReturnValue(SOLANA_BYTES);
    mockEncodeSolanaSecretKey.mockImplementation((bytes: Uint8Array) => {
      // Confirm the bytes are still non-zero AT encode time.
      expect(Array.from(bytes).every((b) => b === 7)).toBe(true);
      return BASE58;
    });
    const fn = getHandler();

    const result = (await fn(trustedSender, {
      requestId: "ok-sol",
      payload: VALID_INPUT_SOLANA,
    })) as OkResult<{
      chain: string;
      format: string;
      copied: boolean;
      clearAfterMs: number;
    }>;

    expect(result.ok).toBe(true);
    expect(result.data.chain).toBe("solana");
    expect(result.data.format).toBe("base58");
    expect(mockClipboardWriteText).toHaveBeenCalledWith(BASE58);
    // After the handler returns, the buffer should be zeroed in place.
    expect(Array.from(SOLANA_BYTES).every((b) => b === 0)).toBe(true);
  });
});

// ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ──

describe("clipboard lease lifecycle", () => {
  beforeEach(() => {
    mockCheckExportAllowed.mockReturnValue({ allowed: true });
    mockGetSecretSessionStatus.mockReturnValue({
      vaultConfigured: true,
      unlocked: true,
    });
    mockVerifySecretVaultPassword.mockReturnValue(undefined);
    mockLoadKeystore.mockReturnValue(STUB_KEYSTORE_EVM);
  });

  it("clear fires after CLEAR_AFTER_MS when clipboard content matches our hash", async () => {
    const SECRET =
      "0xabcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";
    mockDecryptPrivateKey.mockReturnValue(SECRET);
    const fn = getHandler();
    await fn(trustedSender, {
      requestId: "lease-1",
      payload: VALID_INPUT_EVM,
    });
    expect(clipboardText).toBe(SECRET);

    // Just before the window — should NOT clear yet.
    vi.advanceTimersByTime(9_999);
    expect(mockClipboardClear).not.toHaveBeenCalled();
    expect(clipboardText).toBe(SECRET);

    // Cross the boundary.
    vi.advanceTimersByTime(2);
    expect(mockClipboardClear).toHaveBeenCalledTimes(1);
    expect(clipboardText).toBe("");
  });

  it("does NOT clear when clipboard content changed before the timer fires", async () => {
    const SECRET =
      "0xabcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";
    mockDecryptPrivateKey.mockReturnValue(SECRET);
    const fn = getHandler();
    await fn(trustedSender, {
      requestId: "lease-overwrite",
      payload: VALID_INPUT_EVM,
    });

    // Simulate the user copying something else over our secret.
    clipboardText = "https://example.com/something";

    vi.advanceTimersByTime(10_001);
    // Timer ran but content no longer matches our hash → no clear.
    expect(mockClipboardClear).not.toHaveBeenCalled();
    expect(clipboardText).toBe("https://example.com/something");
  });

  it("a second export cancels the previous lease's timer", async () => {
    const SECRET_1 =
      "0x1111111111111111111111111111111111111111111111111111111111111111";
    const SECRET_2 =
      "0x2222222222222222222222222222222222222222222222222222222222222222";
    mockDecryptPrivateKey.mockReturnValueOnce(SECRET_1).mockReturnValueOnce(SECRET_2);
    const fn = getHandler();

    await fn(trustedSender, {
      requestId: "lease-first",
      payload: VALID_INPUT_EVM,
    });
    expect(clipboardText).toBe(SECRET_1);
    const tokenAfterFirst = __getActiveLeaseTokenForTests();

    // Second export overrides — should cancel first timer + cleanup-registry entry.
    await fn(trustedSender, {
      requestId: "lease-second",
      payload: VALID_INPUT_EVM,
    });
    expect(clipboardText).toBe(SECRET_2);
    const tokenAfterSecond = __getActiveLeaseTokenForTests();
    expect(tokenAfterSecond).not.toBe(tokenAfterFirst);

    // Advance past the FIRST timer's original window — clipboard should
    // STILL hold the second secret because the first timer was cancelled.
    vi.advanceTimersByTime(10_001);
    // The SECOND lease's timer is also due now (it was set the same way
    // measured from the same fake-time anchor) — so a clear is expected
    // but for SECRET_2, not SECRET_1.
    expect(mockClipboardClear).toHaveBeenCalledTimes(1);
    expect(clipboardText).toBe("");
  });

  it("registers a cleanup task that conditionally clears on app quit", async () => {
    const SECRET =
      "0xabcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";
    mockDecryptPrivateKey.mockReturnValue(SECRET);
    const fn = getHandler();
    await fn(trustedSender, {
      requestId: "lease-quit",
      payload: VALID_INPUT_EVM,
    });
    expect(cleanupTasks.size).toBe(1);
    expect(clipboardText).toBe(SECRET);

    // Simulate app quit firing globalCleanup.runAll() — task should
    // clear the clipboard because content still matches our hash.
    await runAllCleanup();
    expect(mockClipboardClear).toHaveBeenCalledTimes(1);
    expect(clipboardText).toBe("");
  });

  it("cleanup task no-ops on quit when clipboard content was overwritten", async () => {
    const SECRET =
      "0xabcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";
    mockDecryptPrivateKey.mockReturnValue(SECRET);
    const fn = getHandler();
    await fn(trustedSender, {
      requestId: "lease-quit-overwritten",
      payload: VALID_INPUT_EVM,
    });

    clipboardText = "user copied something else";
    await runAllCleanup();
    expect(mockClipboardClear).not.toHaveBeenCalled();
    expect(clipboardText).toBe("user copied something else");
  });
});
