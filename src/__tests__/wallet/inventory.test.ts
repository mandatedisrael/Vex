import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { privateKeyToAddress } from "viem/accounts";

const { testDir, testConfigFile, testKeystoreFile, testSolanaKeystoreFile } = vi.hoisted(() => {
  const { join } = require("node:path");
  const { tmpdir } = require("node:os");
  const _dir = join(tmpdir(), `vex-inv-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  return {
    testDir: _dir,
    testConfigFile: join(_dir, "config.json"),
    testKeystoreFile: join(_dir, "keystore.json"),
    testSolanaKeystoreFile: join(_dir, "solana-keystore.json"),
  };
});

const TEST_PASSWORD = "test-password-inventory";

vi.mock("@config/paths.js", () => ({
  CONFIG_DIR: testDir,
  CONFIG_FILE: testConfigFile,
  KEYSTORE_FILE: testKeystoreFile,
  SOLANA_KEYSTORE_FILE: testSolanaKeystoreFile,
}));

vi.mock("@utils/env.js", () => ({
  requireKeystorePassword: vi.fn(() => TEST_PASSWORD),
  getKeystorePassword: vi.fn(() => TEST_PASSWORD),
}));

vi.mock("@utils/logger-shim.js", () => ({
  minLogger: { debug: vi.fn(), error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

const { ErrorCodes } = await import("../../errors.js");
const { loadConfig } = await import("@config/store.js");
const inv = await import("@tools/wallet/inventory.js");
const { createEvmWalletEntry, importEvmWalletEntry, createSolanaWalletEntry, exportAllWallets } =
  await import("@tools/wallet/inventory-create.js");
const { requireEvmWallet, resolveWalletForFamily } = await import("@tools/wallet/multi-auth.js");
const { saveKeystore, encryptPrivateKey } = await import("@tools/wallet/keystore.js");

const KEY_A = "0x" + "ab".repeat(32);
const KEY_B = "0x" + "cd".repeat(32);

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (err: unknown) {
    return (err as { code?: string }).code;
  }
  return undefined;
}

describe("wallet inventory (stage 1)", () => {
  beforeEach(() => {
    if (existsSync(testDir)) rmSync(testDir, { recursive: true });
    mkdirSync(testDir, { recursive: true });
  });
  afterEach(() => {
    if (existsSync(testDir)) rmSync(testDir, { recursive: true });
  });

  describe("create / import + caps", () => {
    it("appends up to the per-family cap and rejects the overflow", () => {
      createEvmWalletEntry();
      createEvmWalletEntry();
      createEvmWalletEntry();
      expect(loadConfig().wallet.evm).toHaveLength(inv.MAX_WALLETS_PER_FAMILY);
      expect(codeOf(() => createEvmWalletEntry())).toBe(ErrorCodes.WALLET_INVENTORY_FULL);
    });

    it("rejects a duplicate address (case-insensitive for EVM)", () => {
      importEvmWalletEntry(KEY_A);
      expect(codeOf(() => importEvmWalletEntry(KEY_A))).toBe(ErrorCodes.WALLET_DUPLICATE_ADDRESS);
    });

    it("EVM and Solana caps are independent", () => {
      createEvmWalletEntry();
      createSolanaWalletEntry();
      expect(loadConfig().wallet.evm).toHaveLength(1);
      expect(loadConfig().wallet.solana).toHaveLength(1);
    });
  });

  describe("derivePath traversal + legacy guards", () => {
    it("derives CONFIG_DIR/wallet-<id>.json for normal entries", () => {
      const e = createEvmWalletEntry();
      expect(inv.derivePath("evm", e)).toBe(`${testDir}/wallet-${e.id}.json`);
    });

    it("rejects a crafted traversal id", () => {
      const bad = { id: "evm_../../etc/passwd", address: "0xabc", label: "x", createdAt: "" };
      expect(codeOf(() => inv.derivePath("evm", bad))).toBe(ErrorCodes.WALLET_ID_INVALID);
    });

    it("a valid legacy entry resolves to the fixed keystore file", () => {
      expect(
        inv.derivePath("evm", { id: "evm_legacy", address: "0xabc", label: "x", createdAt: "", legacy: true }),
      ).toBe(testKeystoreFile);
      expect(
        inv.derivePath("solana", { id: "sol_legacy", address: "x", label: "x", createdAt: "", legacy: true }),
      ).toBe(testSolanaKeystoreFile);
    });

    it("rejects the reserved sentinel used as a non-legacy id", () => {
      expect(
        codeOf(() => inv.derivePath("evm", { id: "evm_legacy", address: "0xabc", label: "x", createdAt: "" })),
      ).toBe(ErrorCodes.WALLET_ID_INVALID);
    });

    it("rejects a legacy entry whose id is not the family sentinel", () => {
      expect(
        codeOf(() => inv.derivePath("evm", { id: "evm_nope", address: "0xabc", label: "x", createdAt: "", legacy: true })),
      ).toBe(ErrorCodes.WALLET_ID_INVALID);
    });

    it("rejects cross-family ids (prefix must match family)", () => {
      const evm = createEvmWalletEntry();
      const sol = createSolanaWalletEntry();
      expect(codeOf(() => inv.derivePath("solana", evm))).toBe(ErrorCodes.WALLET_ID_INVALID);
      expect(codeOf(() => inv.derivePath("evm", sol))).toBe(ErrorCodes.WALLET_ID_INVALID);
    });
  });

  describe("primary resolution / back-compat", () => {
    it("requireEvmWallet (zero-arg) resolves the first inventory entry", () => {
      const first = importEvmWalletEntry(KEY_A);
      importEvmWalletEntry(KEY_B);
      const wallet = requireEvmWallet();
      expect(wallet.address.toLowerCase()).toBe(first.address.toLowerCase());
    });

    it("getPrimaryEvmAddress returns null with an empty inventory", () => {
      expect(inv.getPrimaryEvmAddress()).toBeNull();
    });

    it("fails closed when the primary keystore file is missing", () => {
      const e = createEvmWalletEntry();
      rmSync(inv.derivePath("evm", e));
      expect(codeOf(() => requireEvmWallet())).toBe(ErrorCodes.KEYSTORE_NOT_FOUND);
    });

    it("fails closed when the EVM key does not match the recorded address", () => {
      // Record address(KEY_A) as the legacy primary, but write a keystore that
      // actually holds KEY_B → signer/address mismatch must fail closed.
      inv.registerPrimaryLegacyWallet("evm", privateKeyToAddress(KEY_A as `0x${string}`));
      saveKeystore(encryptPrivateKey(KEY_B, TEST_PASSWORD));
      expect(codeOf(() => requireEvmWallet())).toBe(ErrorCodes.SIGNER_MISMATCH);
    });
  });

  describe("resolveWalletForFamily (session scope)", () => {
    it("default source returns the primary wallet", () => {
      const e = importEvmWalletEntry(KEY_A);
      const wallet = resolveWalletForFamily("eip155", { source: "default" });
      expect(wallet.address.toLowerCase()).toBe(e.address.toLowerCase());
    });

    it("session source resolves the selected entry by id + address", () => {
      importEvmWalletEntry(KEY_A);
      const target = importEvmWalletEntry(KEY_B);
      const wallet = resolveWalletForFamily("eip155", {
        source: "session",
        evm: { id: target.id, address: target.address },
        solana: null,
      });
      expect(wallet.address.toLowerCase()).toBe(target.address.toLowerCase());
    });

    it("fails closed when the family is not selected", () => {
      importEvmWalletEntry(KEY_A);
      const code = codeOf(() =>
        resolveWalletForFamily("eip155", { source: "session", evm: null, solana: null }),
      );
      expect(code).toBe(ErrorCodes.WALLET_NOT_SELECTED);
    });

    it("fails closed on address drift under the same id", () => {
      const e = importEvmWalletEntry(KEY_A);
      const code = codeOf(() =>
        resolveWalletForFamily("eip155", {
          source: "session",
          evm: { id: e.id, address: "0x0000000000000000000000000000000000000000" },
          solana: null,
        }),
      );
      expect(code).toBe(ErrorCodes.WALLET_SCOPE_MISMATCH);
    });

    it("fails closed when the selected wallet was removed", () => {
      importEvmWalletEntry(KEY_A);
      const code = codeOf(() =>
        resolveWalletForFamily("eip155", {
          source: "session",
          evm: { id: "evm_00000000-0000-0000-0000-000000000000", address: "0xabc" },
          solana: null,
        }),
      );
      expect(code).toBe(ErrorCodes.WALLET_SCOPE_MISMATCH);
    });
  });

  describe("exportAll", () => {
    it("returns filenames only and never key material", () => {
      importEvmWalletEntry(KEY_A);
      const destDir = `${testDir}/export`;
      const result = exportAllWallets(destDir);

      expect(result.files).toContain("config.json");
      expect(result.files.some((f) => f.startsWith("wallet-") && f.endsWith(".json"))).toBe(true);

      const serialized = JSON.stringify(result);
      expect(serialized).not.toContain("ciphertext");
      expect(serialized).not.toContain(KEY_A.slice(2));
    });
  });
});
