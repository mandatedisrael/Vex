/**
 * Tests for the vex.onboarding.polymarketAutoSetup IPC handler
 * (Phase 2 #7 + puzzle 5 B-UI per-wallet).
 *
 * Mocks: electron (ipcMain), secrets/session (status + write +
 * getConfiguredPolymarketAddresses), env-write-mutex, engine acquire
 * primitive (@vex-lib/polymarket — acquire mocked, the PURE
 * `buildPolymarketVaultUpdates` runs for real via importActual), engine
 * wallet inventory (@vex-lib/wallet — getWalletById / getPrimaryEvmEntry /
 * getPrimaryEvmAddress), vault verify (@vex-lib/local-secret-vault), logger.
 *
 * Exercises:
 *  - Zod input validation at the boundary
 *  - Session lock check
 *  - Unknown walletId → fails closed BEFORE acquire / re-auth
 *  - Pre-network per-wallet overwrite check (selected wallet configured)
 *  - Vault re-auth failure
 *  - Keystore decrypt failure inside acquire (mismatched password state)
 *  - Acquire mapping for POLYMARKET_AUTH_FAILED + HTTP_REQUEST_FAILED
 *  - Happy path PRIMARY (no walletId) → map key + 3 fixed keys
 *  - Happy path NON-PRIMARY (walletId) → ONLY the map key (merged)
 *  - TOCTOU per-wallet race re-check INSIDE the env-write lock
 *  - VEX_KEYSTORE_PASSWORD untouched throughout
 *  - Audit log carries only address + correlationId (never creds / walletId)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createTestWebContents,
  createTrustedSender,
  type TestIpcEvent,
} from "../../../__tests__/test-sender.js";

type Handler = (
  event: TestIpcEvent,
  raw: unknown,
) => Promise<unknown>;

const handlers = new Map<string, Handler>();

// ── Mocks (regular Jest-style; loaded before handler import) ──────────────
const mockGetSecretSessionStatus = vi.fn();
const mockGetConfiguredPolymarketAddresses = vi.fn();
const mockWriteUnlockedSecrets = vi.fn();

const mockGetWalletById = vi.fn();
const mockGetPrimaryEvmEntry = vi.fn();
const mockGetPrimaryEvmAddress = vi.fn();
const mockVerifySecretVaultPassword = vi.fn();

const mockAcquireCredentials = vi.fn();

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

class FakeEngineVexError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "VexError";
  }
}

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
}));

vi.mock("../../../../secrets/session.js", () => ({
  getSecretSessionStatus: () => mockGetSecretSessionStatus(),
  getConfiguredPolymarketAddresses: () =>
    mockGetConfiguredPolymarketAddresses(),
  writeUnlockedSecrets: (updates: unknown) =>
    mockWriteUnlockedSecrets(updates),
}));

vi.mock("../../../../onboarding/env-write-mutex.js", () => ({
  withEnvWriteLock: <T>(fn: () => Promise<T>) => fn(),
}));

// The acquire primitive is mocked; the PURE credential-map helpers
// (`buildPolymarketVaultUpdates`, the ENV constant) run for real so the
// `writeUnlockedSecrets` argument assertions exercise the true key-selection
// logic (the single source of truth for key selection).
vi.mock("@vex-lib/polymarket.js", async () => {
  const actual = await vi.importActual<
    typeof import("@vex-lib/polymarket.js")
  >("@vex-lib/polymarket.js");
  return {
    acquirePolymarketCredentialsWithPassword: (
      password: string,
      entry?: unknown,
    ) => mockAcquireCredentials(password, entry),
    buildPolymarketVaultUpdates: actual.buildPolymarketVaultUpdates,
    ENV_POLYMARKET_CLOB_CREDENTIALS_BY_ADDRESS:
      actual.ENV_POLYMARKET_CLOB_CREDENTIALS_BY_ADDRESS,
  };
});

vi.mock("@vex-lib/wallet.js", () => ({
  getWalletById: (family: string, id: string) =>
    mockGetWalletById(family, id),
  getPrimaryEvmEntry: () => mockGetPrimaryEvmEntry(),
  getPrimaryEvmAddress: () => mockGetPrimaryEvmAddress(),
}));

vi.mock("@vex-lib/local-secret-vault.js", () => ({
  LocalSecretVaultError: LocalSecretVaultErrorMock,
  verifySecretVaultPassword: (...args: unknown[]) =>
    mockVerifySecretVaultPassword(...args),
}));

vi.mock("../../../../paths/config-dir.js", () => ({
  SECRETS_VAULT_FILE: "/tmp/vex-test-vault",
}));

const mockLog = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

vi.mock("../../../../logger/index.js", () => ({
  log: mockLog,
}));

const { registerPolymarketSetupHandler } = await import(
  "../../polymarket-setup.js"
);
const { CH } = await import("@shared/ipc/channels.js");
const {
  ENV_POLYMARKET_CLOB_CREDENTIALS_BY_ADDRESS,
  buildPolymarketVaultUpdates,
} = await import("@vex-lib/polymarket.js");

const trustedSender = createTrustedSender({ sender: createTestWebContents() });

// ── Test fixtures ─────────────────────────────────────────────────────────
const VALID_INPUT = {
  password: "correct-password-12",
  riskAcknowledged: true as const,
  overwriteConfirmed: false,
};

const STUB_ADDRESS = "0xAbCdEf0123456789AbCdEf0123456789AbCdEf01" as const;
const STUB_LC = STUB_ADDRESS.toLowerCase();
const OTHER_PRIMARY = "0x1111111111111111111111111111111111111111" as const;
const STUB_CREDS = {
  apiKey: "k-secret",
  secret: "s-secret",
  passphrase: "p-secret",
};

const PRIMARY_ENTRY = {
  id: "evm_legacy",
  address: STUB_ADDRESS,
  label: "Primary",
  createdAt: new Date(0).toISOString(),
  legacy: true,
};
const NON_PRIMARY_ENTRY = {
  id: "evm_11111111-1111-1111-1111-111111111111",
  address: STUB_ADDRESS,
  label: "Trading",
  createdAt: new Date(0).toISOString(),
};

// ── Env snapshot guard ────────────────────────────────────────────────────
let envSnapshot: NodeJS.ProcessEnv;

beforeEach(() => {
  envSnapshot = { ...process.env };
  delete process.env.VEX_KEYSTORE_PASSWORD;
  delete process.env[ENV_POLYMARKET_CLOB_CREDENTIALS_BY_ADDRESS];

  handlers.clear();
  mockGetSecretSessionStatus.mockReset();
  mockGetConfiguredPolymarketAddresses.mockReset();
  mockWriteUnlockedSecrets.mockReset();
  mockGetWalletById.mockReset();
  mockGetPrimaryEvmEntry.mockReset();
  mockGetPrimaryEvmAddress.mockReset();
  mockVerifySecretVaultPassword.mockReset();
  mockAcquireCredentials.mockReset();
  mockLog.info.mockClear();
  mockLog.warn.mockClear();
  mockLog.error.mockClear();
  mockLog.debug.mockClear();
});

afterEach(() => {
  handlers.clear();
  vi.clearAllMocks();
  process.env = envSnapshot;
});

function getHandler(): Handler {
  registerPolymarketSetupHandler();
  const fn = handlers.get(CH.onboarding.polymarketAutoSetup);
  if (!fn) throw new Error("handler not registered");
  return fn;
}

interface ErrResult {
  readonly ok: false;
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly domain: string;
    readonly correlationId?: string;
  };
}

interface OkResult<T> {
  readonly ok: true;
  readonly data: T;
}

function expectVexKeystorePasswordUntouched(): void {
  expect(process.env.VEX_KEYSTORE_PASSWORD).toBeUndefined();
}

/** ok-Result of the configured-address set helper. */
function configuredOk(addresses: readonly string[]): {
  ok: true;
  data: readonly string[];
} {
  return { ok: true, data: addresses };
}

// ── Cases ─────────────────────────────────────────────────────────────────

describe("preconditions", () => {
  it("returns wallet.keystore_locked when the session is locked", async () => {
    mockGetSecretSessionStatus.mockReturnValue({
      vaultConfigured: true,
      unlocked: false,
    });
    const fn = getHandler();
    const result = (await fn(trustedSender, {
      requestId: "pre-1",
      payload: VALID_INPUT,
    })) as ErrResult;
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("wallet.keystore_locked");
    expect(mockVerifySecretVaultPassword).not.toHaveBeenCalled();
    expect(mockAcquireCredentials).not.toHaveBeenCalled();
    expectVexKeystorePasswordUntouched();
  });

  it("returns wallet.not_found (fails closed) for an unknown walletId BEFORE acquire/re-auth", async () => {
    mockGetSecretSessionStatus.mockReturnValue({
      vaultConfigured: true,
      unlocked: true,
    });
    mockGetWalletById.mockReturnValue(null);
    const fn = getHandler();
    const result = (await fn(trustedSender, {
      requestId: "pre-2",
      payload: { ...VALID_INPUT, walletId: "evm_does-not-exist" },
    })) as ErrResult;
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("wallet.not_found");
    expect(mockGetWalletById).toHaveBeenCalledWith("evm", "evm_does-not-exist");
    // Critical: no re-auth, no acquire, no configured-probe, no write.
    expect(mockVerifySecretVaultPassword).not.toHaveBeenCalled();
    expect(mockAcquireCredentials).not.toHaveBeenCalled();
    expect(mockGetConfiguredPolymarketAddresses).not.toHaveBeenCalled();
    expect(mockWriteUnlockedSecrets).not.toHaveBeenCalled();
    expectVexKeystorePasswordUntouched();
  });

  it("returns wallet.not_found when there is no primary EVM wallet (no walletId)", async () => {
    mockGetSecretSessionStatus.mockReturnValue({
      vaultConfigured: true,
      unlocked: true,
    });
    mockGetPrimaryEvmEntry.mockReturnValue(null);
    const fn = getHandler();
    const result = (await fn(trustedSender, {
      requestId: "pre-3",
      payload: VALID_INPUT,
    })) as ErrResult;
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("wallet.not_found");
    expect(mockAcquireCredentials).not.toHaveBeenCalled();
    expect(mockVerifySecretVaultPassword).not.toHaveBeenCalled();
    expectVexKeystorePasswordUntouched();
  });

  it("returns wallet.keystore_locked when the configured-probe relocks pre-network", async () => {
    mockGetSecretSessionStatus.mockReturnValue({
      vaultConfigured: true,
      unlocked: true,
    });
    mockGetPrimaryEvmEntry.mockReturnValue(PRIMARY_ENTRY);
    // Probe fails closed (session relocked between status check and here).
    mockGetConfiguredPolymarketAddresses.mockReturnValue({
      ok: false,
      error: {
        code: "wallet.keystore_locked",
        domain: "wallet",
        message: "locked",
        retryable: false,
        userActionable: true,
        redacted: true,
      },
    });
    const fn = getHandler();
    const result = (await fn(trustedSender, {
      requestId: "pre-4",
      payload: VALID_INPUT,
    })) as ErrResult;
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("wallet.keystore_locked");
    expect(mockVerifySecretVaultPassword).not.toHaveBeenCalled();
    expect(mockAcquireCredentials).not.toHaveBeenCalled();
    expect(mockWriteUnlockedSecrets).not.toHaveBeenCalled();
    expectVexKeystorePasswordUntouched();
  });
});

describe("pre-network overwrite check (per selected wallet)", () => {
  it("returns wallet.risk_confirmation_required when the selected wallet is configured + overwriteConfirmed=false", async () => {
    mockGetSecretSessionStatus.mockReturnValue({
      vaultConfigured: true,
      unlocked: true,
    });
    mockGetPrimaryEvmEntry.mockReturnValue(PRIMARY_ENTRY);
    mockGetConfiguredPolymarketAddresses.mockReturnValue(
      configuredOk([STUB_LC]),
    );
    const fn = getHandler();
    const result = (await fn(trustedSender, {
      requestId: "ov-1",
      payload: VALID_INPUT,
    })) as ErrResult;
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("wallet.risk_confirmation_required");
    // No network call when the user has not confirmed overwrite.
    expect(mockVerifySecretVaultPassword).not.toHaveBeenCalled();
    expect(mockAcquireCredentials).not.toHaveBeenCalled();
    expect(mockWriteUnlockedSecrets).not.toHaveBeenCalled();
    expectVexKeystorePasswordUntouched();
  });

  it("does NOT block when a DIFFERENT wallet is configured (selected one is not)", async () => {
    mockGetSecretSessionStatus.mockReturnValue({
      vaultConfigured: true,
      unlocked: true,
    });
    mockGetWalletById.mockReturnValue(NON_PRIMARY_ENTRY);
    // Only some OTHER address is configured; the selected one is not.
    mockGetConfiguredPolymarketAddresses.mockReturnValue(
      configuredOk([OTHER_PRIMARY.toLowerCase()]),
    );
    mockVerifySecretVaultPassword.mockReturnValue(undefined);
    mockGetPrimaryEvmAddress.mockReturnValue(OTHER_PRIMARY);
    mockAcquireCredentials.mockResolvedValue({
      address: STUB_ADDRESS,
      credentials: STUB_CREDS,
    });
    mockWriteUnlockedSecrets.mockReturnValue({ ok: true, data: undefined });

    const fn = getHandler();
    const result = (await fn(trustedSender, {
      requestId: "ov-2",
      payload: { ...VALID_INPUT, walletId: NON_PRIMARY_ENTRY.id },
    })) as OkResult<{ configured: true; address: string }>;
    expect(result.ok).toBe(true);
    expect(mockAcquireCredentials).toHaveBeenCalledTimes(1);
  });

  it("proceeds past the pre-network check when overwriteConfirmed=true", async () => {
    mockGetSecretSessionStatus.mockReturnValue({
      vaultConfigured: true,
      unlocked: true,
    });
    mockGetPrimaryEvmEntry.mockReturnValue(PRIMARY_ENTRY);
    mockGetConfiguredPolymarketAddresses.mockReturnValue(
      configuredOk([STUB_LC]),
    );
    mockVerifySecretVaultPassword.mockReturnValue(undefined);
    mockGetPrimaryEvmAddress.mockReturnValue(STUB_ADDRESS);
    mockAcquireCredentials.mockResolvedValue({
      address: STUB_ADDRESS,
      credentials: STUB_CREDS,
    });
    mockWriteUnlockedSecrets.mockReturnValue({ ok: true, data: undefined });

    const fn = getHandler();
    const result = (await fn(trustedSender, {
      requestId: "ov-3",
      payload: { ...VALID_INPUT, overwriteConfirmed: true },
    })) as OkResult<{ configured: true; address: string }>;

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.address).toBe(STUB_ADDRESS);
    }
    expect(mockAcquireCredentials).toHaveBeenCalledTimes(1);
  });
});
