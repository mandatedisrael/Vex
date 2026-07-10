/**
 * Compatibility-façade surface test for `backup.ts` after the structural split
 * into `./backup/` modules (manifest / create / retention / read / list).
 *
 * Pins the EXACT runtime export set of the façade + each export's typeof, so a
 * caller importing from the old path (`@tools/wallet/backup.js`, re-exported by
 * src/lib/wallet.ts via @vex-lib and consumed by restore/) sees no difference.
 * Type-only imports of the exported types must also compile against the façade.
 *
 * Boundary modules are mocked (real temp CONFIG_DIR paths + logger) so importing
 * the façade — which transitively pulls in the create/read/list implementations
 * — never touches the real config tree.
 */

import { describe, expect, it, vi } from "vitest";

const { testDir, testConfigFile, testBackupsDir, testEnvFile, testVaultFile } = vi.hoisted(() => {
  const { join } = require("node:path");
  const { tmpdir } = require("node:os");
  const _dir = join(tmpdir(), `vex-backup-surface-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  return {
    testDir: _dir,
    testConfigFile: join(_dir, "config.json"),
    testBackupsDir: join(_dir, "backups"),
    testEnvFile: join(_dir, ".env"),
    testVaultFile: join(_dir, "secrets.vault.json"),
  };
});

vi.mock("@config/paths.js", () => ({
  CONFIG_DIR: testDir,
  CONFIG_FILE: testConfigFile,
  BACKUPS_DIR: testBackupsDir,
  ENV_FILE: testEnvFile,
  SECRETS_VAULT_FILE: testVaultFile,
}));

vi.mock("@utils/logger-shim.js", () => ({
  minLogger: { debug: vi.fn(), error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

// Type-only imports of the 7 exported types must compile against the façade.
type _Role = import("@tools/wallet/backup.js").BackupFileRole;
type _V1 = import("@tools/wallet/backup.js").BackupManifestV1;
type _V2 = import("@tools/wallet/backup.js").BackupManifestV2;
type _M = import("@tools/wallet/backup.js").BackupManifest;
type _Wallet = import("@tools/wallet/backup.js").BackupManifestWallet;
type _Entry = import("@tools/wallet/backup.js").BackupFileEntry;
type _Available = import("@tools/wallet/backup.js").AvailableBackup;
type _Purpose = import("@tools/wallet/backup.js").BackupPurpose;
type _Options = import("@tools/wallet/backup.js").AutoBackupOptions;

type BackupMod = typeof import("@tools/wallet/backup.js");

describe("backup façade surface", () => {
  it("exposes exactly the expected runtime exports with correct typeof", async () => {
    const backupMod: BackupMod = await import("@tools/wallet/backup.js");

    // The exact set of RUNTIME export keys (the 7 types are erased at runtime).
    const keys = Object.keys(backupMod).sort();
    expect(keys).toEqual([
      "autoBackup",
      "backupManifestSchema",
      "backupManifestV1Schema",
      "backupManifestV2Schema",
      "backupPurposeSchema",
      "createBackupDirName",
      "enforceBackupRetention",
      "formatBackupTimestamp",
      "isCanonicalVaultResetBackupName",
      "listAvailableBackups",
      "readArchiveManifest",
    ]);

    expect(typeof backupMod.autoBackup).toBe("function");
    expect(typeof backupMod.enforceBackupRetention).toBe("function");
    expect(typeof backupMod.readArchiveManifest).toBe("function");
    expect(typeof backupMod.listAvailableBackups).toBe("function");
    // Zod schemas are objects exposing a `.safeParse` method.
    expect(typeof backupMod.backupManifestSchema.safeParse).toBe("function");
    expect(typeof backupMod.backupManifestV1Schema.safeParse).toBe("function");
    expect(typeof backupMod.backupManifestV2Schema.safeParse).toBe("function");

    // Keep the type-only imports referenced so they are not elided as unused.
    const _typeProbe: ReadonlyArray<
      _Role | _V1 | _V2 | _M | _Wallet | _Entry | _Available | _Purpose | _Options
    > = [];
    void _typeProbe;
    // Import-bound: cold-transforming the heavy viem/solana module graph under
    // vitest exceeds the 10s default. Bundled at runtime, so this is test-only.
  }, 30_000);
});
