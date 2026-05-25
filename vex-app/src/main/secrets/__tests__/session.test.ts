/**
 * Tests for the secret-vault session module.
 *
 * Focuses on the lock/unlock state machine without exercising real scrypt or
 * filesystem IO — the underlying vault library is mocked so we can assert
 * exactly what `lockSecretSession()` zeros out and what `getSecretSessionStatus()`
 * reports.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockApplySecretVaultToProcessEnv = vi.fn();
const mockCreateSecretVault = vi.fn();
const mockGetSecretVaultStatus = vi.fn();
const mockStripManagedSecretsFromDotenvFile = vi.fn();
const mockUnlockSecretVault = vi.fn();
const mockWriteSecretVaultSecrets = vi.fn();

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

vi.mock("@vex-lib/local-secret-vault.js", () => ({
  applySecretVaultToProcessEnv: (...args: unknown[]) =>
    mockApplySecretVaultToProcessEnv(...args),
  createSecretVault: (...args: unknown[]) => mockCreateSecretVault(...args),
  getSecretVaultStatus: (...args: unknown[]) =>
    mockGetSecretVaultStatus(...args),
  LocalSecretVaultError: LocalSecretVaultErrorMock,
  stripManagedSecretsFromDotenvFile: (...args: unknown[]) =>
    mockStripManagedSecretsFromDotenvFile(...args),
  unlockSecretVault: (...args: unknown[]) => mockUnlockSecretVault(...args),
  writeSecretVaultSecrets: (...args: unknown[]) =>
    mockWriteSecretVaultSecrets(...args),
}));

vi.mock("@vex-lib/secret-keys.js", () => ({
  MASTER_PASSWORD_ENV_KEY: "VEX_MASTER_PASSWORD",
  VAULT_SECRET_KEYS: ["JUPITER_API_KEY"] as const,
}));

// `@vex-lib/polymarket.js` re-exports through `polymarket-credentials.ts`,
// which transitively pulls in viem — loading the REAL module under this
// file's `vi.resetModules()` cycle re-evaluates that heavy graph per test.
// `parseCredentialMapEnv` is a tiny pure contract (parse JSON → {} when empty
// → THROW on malformed, fail closed), so we mirror it here with a faithful,
// dependency-free stub. The real helper is exercised end-to-end in the
// handler test (`polymarket-setup.test.ts`, via importActual without reset)
// and in its own unit tests, so there is no behavioural drift to hide.
const mockGetPrimaryEvmAddress = vi.fn();

class FakeVexError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VexError";
  }
}

vi.mock("@vex-lib/polymarket.js", () => ({
  ENV_POLYMARKET_API_KEY: "POLYMARKET_API_KEY",
  ENV_POLYMARKET_API_SECRET: "POLYMARKET_API_SECRET",
  ENV_POLYMARKET_PASSPHRASE: "POLYMARKET_PASSPHRASE",
  ENV_POLYMARKET_CLOB_CREDENTIALS_BY_ADDRESS:
    "POLYMARKET_CLOB_CREDENTIALS_BY_ADDRESS",
  parseCredentialMapEnv: (raw: string | undefined) => {
    if (!raw || raw.trim().length === 0) return {};
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new FakeVexError("malformed map (invalid JSON)");
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new FakeVexError("malformed map (shape)");
    }
    return parsed as Record<string, unknown>;
  },
}));

vi.mock("@vex-lib/wallet.js", () => ({
  getPrimaryEvmAddress: () => mockGetPrimaryEvmAddress(),
}));

vi.mock("../../paths/config-dir.js", () => ({
  ENV_FILE: "/tmp/vex-test-env",
  SECRETS_VAULT_FILE: "/tmp/vex-test-vault",
}));

vi.mock("../../logger/index.js", () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

async function loadSession(): Promise<typeof import("../session.js")> {
  vi.resetModules();
  return import("../session.js");
}

beforeEach(() => {
  mockApplySecretVaultToProcessEnv.mockReset();
  mockCreateSecretVault.mockReset();
  mockGetSecretVaultStatus.mockReset();
  mockStripManagedSecretsFromDotenvFile.mockReset();
  mockUnlockSecretVault.mockReset();
  mockWriteSecretVaultSecrets.mockReset();
  mockGetPrimaryEvmAddress.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("lockSecretSession", () => {
  it("flips status.unlocked back to false after a successful unlock", async () => {
    mockGetSecretVaultStatus.mockReturnValue({ configured: true });
    mockUnlockSecretVault.mockReturnValue({
      version: 1,
      secrets: {},
    });

    const session = await loadSession();
    const unlock = session.unlockSecretSession("correct-password");
    expect(unlock.ok).toBe(true);
    expect(session.getSecretSessionStatus()).toEqual({
      vaultConfigured: true,
      unlocked: true,
    });

    session.lockSecretSession();
    expect(session.getSecretSessionStatus()).toEqual({
      vaultConfigured: true,
      unlocked: false,
    });
  });

  it("locks even when never unlocked (idempotent at rest)", async () => {
    mockGetSecretVaultStatus.mockReturnValue({ configured: true });
    const session = await loadSession();
    expect(session.getSecretSessionStatus().unlocked).toBe(false);
    session.lockSecretSession();
    expect(session.getSecretSessionStatus().unlocked).toBe(false);
  });

  it("is idempotent across repeated calls", async () => {
    mockGetSecretVaultStatus.mockReturnValue({ configured: true });
    mockUnlockSecretVault.mockReturnValue({ version: 1, secrets: {} });

    const session = await loadSession();
    session.unlockSecretSession("correct-password");
    session.lockSecretSession();
    session.lockSecretSession();
    session.lockSecretSession();
    expect(session.getSecretSessionStatus().unlocked).toBe(false);
  });

  it("requireUnlockedMasterPassword fails after lock", async () => {
    mockGetSecretVaultStatus.mockReturnValue({ configured: true });
    mockUnlockSecretVault.mockReturnValue({ version: 1, secrets: {} });

    const session = await loadSession();
    session.unlockSecretSession("correct-password");
    expect(session.requireUnlockedMasterPassword().ok).toBe(true);

    session.lockSecretSession();
    const result = session.requireUnlockedMasterPassword();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("wallet.keystore_locked");
    }
  });
});

describe("unlockSecretSession error mapping", () => {
  it("maps LocalSecretVaultError('missing') to wallet.vault_not_configured", async () => {
    mockGetSecretVaultStatus.mockReturnValue({ configured: false });
    mockUnlockSecretVault.mockImplementation(() => {
      throw new LocalSecretVaultErrorMock("vault file missing", "missing");
    });

    const session = await loadSession();
    const result = session.unlockSecretSession("anypassword");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("wallet.vault_not_configured");
      expect(result.error.retryable).toBe(false);
    }
  });

  it("maps LocalSecretVaultError('invalid_password') to wallet.password_invalid", async () => {
    mockGetSecretVaultStatus.mockReturnValue({ configured: true });
    mockUnlockSecretVault.mockImplementation(() => {
      throw new LocalSecretVaultErrorMock("wrong password", "invalid_password");
    });

    const session = await loadSession();
    const result = session.unlockSecretSession("wrong");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("wallet.password_invalid");
      expect(result.error.retryable).toBe(true);
    }
  });
});

describe("getConfiguredPolymarketAddresses", () => {
  const MAP_KEY = "POLYMARKET_CLOB_CREDENTIALS_BY_ADDRESS";
  const PRIMARY = "0xAbCdEf0123456789AbCdEf0123456789AbCdEf01";
  const PRIMARY_LC = PRIMARY.toLowerCase();
  const MAPPED = "0x1111111111111111111111111111111111111111";
  const MAPPED_LC = MAPPED.toLowerCase();

  function creds(): { apiKey: string; apiSecret: string; passphrase: string } {
    return { apiKey: "k", apiSecret: "s", passphrase: "p" };
  }

  async function unlocked(
    secrets: Record<string, string>,
  ): Promise<typeof import("../session.js")> {
    mockGetSecretVaultStatus.mockReturnValue({ configured: true });
    // First unlock (session) then the helper's own unlock both return `secrets`.
    mockUnlockSecretVault.mockReturnValue({ version: 1, secrets });
    const session = await loadSession();
    const u = session.unlockSecretSession("correct-password");
    expect(u.ok).toBe(true);
    return session;
  }

  it("fails closed (wallet.keystore_locked) when the session is locked", async () => {
    mockGetSecretVaultStatus.mockReturnValue({ configured: true });
    const session = await loadSession();
    const result = session.getConfiguredPolymarketAddresses();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("wallet.keystore_locked");
  });

  it("returns the lowercased per-wallet map keys", async () => {
    const session = await unlocked({
      [MAP_KEY]: JSON.stringify({ [MAPPED_LC]: creds() }),
    });
    const result = session.getConfiguredPolymarketAddresses();
    expect(result.ok).toBe(true);
    if (result.ok) expect([...result.data].sort()).toEqual([MAPPED_LC]);
  });

  it("includes the primary address when all 3 fixed legacy keys are present", async () => {
    mockGetPrimaryEvmAddress.mockReturnValue(PRIMARY);
    const session = await unlocked({
      POLYMARKET_API_KEY: "k",
      POLYMARKET_API_SECRET: "s",
      POLYMARKET_PASSPHRASE: "p",
    });
    const result = session.getConfiguredPolymarketAddresses();
    expect(result.ok).toBe(true);
    if (result.ok) expect([...result.data]).toContain(PRIMARY_LC);
  });

  it("does NOT include the primary on a partial legacy trio (only 2 of 3 keys)", async () => {
    mockGetPrimaryEvmAddress.mockReturnValue(PRIMARY);
    const session = await unlocked({
      POLYMARKET_API_KEY: "k",
      POLYMARKET_API_SECRET: "s",
      // passphrase missing → not a complete legacy trio
    });
    const result = session.getConfiguredPolymarketAddresses();
    expect(result.ok).toBe(true);
    if (result.ok) expect([...result.data]).toEqual([]);
  });

  it("dedupes the primary across the map + legacy fallback", async () => {
    mockGetPrimaryEvmAddress.mockReturnValue(PRIMARY);
    const session = await unlocked({
      [MAP_KEY]: JSON.stringify({ [PRIMARY_LC]: creds() }),
      POLYMARKET_API_KEY: "k",
      POLYMARKET_API_SECRET: "s",
      POLYMARKET_PASSPHRASE: "p",
    });
    const result = session.getConfiguredPolymarketAddresses();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect([...result.data]).toEqual([PRIMARY_LC]);
      // No duplicate entry from the legacy fallback.
      expect(result.data.length).toBe(1);
    }
  });

  it("skips the legacy primary when there is no primary EVM wallet", async () => {
    mockGetPrimaryEvmAddress.mockReturnValue(null);
    const session = await unlocked({
      POLYMARKET_API_KEY: "k",
      POLYMARKET_API_SECRET: "s",
      POLYMARKET_PASSPHRASE: "p",
    });
    const result = session.getConfiguredPolymarketAddresses();
    expect(result.ok).toBe(true);
    if (result.ok) expect([...result.data]).toEqual([]);
  });

  it("NEVER returns secret values — only addresses", async () => {
    mockGetPrimaryEvmAddress.mockReturnValue(PRIMARY);
    const session = await unlocked({
      [MAP_KEY]: JSON.stringify({
        [MAPPED_LC]: { apiKey: "SECRET-K", apiSecret: "SECRET-S", passphrase: "SECRET-P" },
      }),
      POLYMARKET_API_KEY: "SECRET-LEGACY-K",
      POLYMARKET_API_SECRET: "SECRET-LEGACY-S",
      POLYMARKET_PASSPHRASE: "SECRET-LEGACY-P",
    });
    const result = session.getConfiguredPolymarketAddresses();
    expect(result.ok).toBe(true);
    if (result.ok) {
      const joined = result.data.join(" ");
      expect(joined).not.toContain("SECRET-K");
      expect(joined).not.toContain("SECRET-S");
      expect(joined).not.toContain("SECRET-P");
      expect(joined).not.toContain("SECRET-LEGACY-K");
      // Both addresses returned (map key + legacy primary).
      expect([...result.data].sort()).toEqual([MAPPED_LC, PRIMARY_LC].sort());
    }
  });

  it("fails CLOSED (error Result, NOT empty list) on a malformed map", async () => {
    const session = await unlocked({
      [MAP_KEY]: "{ not valid json",
    });
    const result = session.getConfiguredPolymarketAddresses();
    // Must be an error Result — never a silent empty list.
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("onboarding.env_persist_failed");
    }
  });
});
