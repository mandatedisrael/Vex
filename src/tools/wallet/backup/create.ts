/**
 * Core wallet backup creation logic.
 * No direct output — caller is responsible for display.
 *
 * Manifest V2 (this module's writer): captures the FULL wallet surface — every
 * per-family inventory keystore (legacy fixed file + per-id `wallet-<id>.json`),
 * the encrypted secret vault, the sanitized `.env`, and `config.json`. V1
 * (legacy: a flat `files: string[]`) is parsed ONLY for listing metadata
 * (`listAvailableBackups`). Archive RESTORE is V2-only and fail-closed on V1
 * (a V1 manifest carries no per-file roles, so restoring from it would be
 * ambiguous); recover individual legacy keystores via the single-file
 * `restoreWalletFromFile` path instead.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { loadConfig } from "../../../config/store.js";
import {
  BACKUPS_DIR,
  CONFIG_FILE,
  ENV_FILE,
  SECRETS_VAULT_FILE,
} from "../../../config/paths.js";
import { VexError, ErrorCodes } from "../../../errors.js";
import { minLogger as logger } from "../../../utils/logger-shim.js";
import {
  derivePath,
  getPrimaryEvmAddress,
  getPrimarySolanaAddress,
  type InventoryFamily,
} from "../inventory.js";
import type {
  BackupFileRole,
  BackupFileEntry,
  BackupManifestV2,
  BackupManifestWallet,
} from "./manifest.js";
import { enforceBackupRetention } from "./retention.js";
import {
  createBackupDirName,
  type BackupPurpose,
} from "./naming.js";

export interface AutoBackupOptions {
  readonly purpose?: BackupPurpose;
}

function getCLIVersion(): string {
  try {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const pkgPath = join(__dirname, "..", "..", "..", "..", "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as { version?: string };
    return pkg.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

function legacyRole(family: InventoryFamily): BackupFileRole {
  return family === "solana" ? "legacy-solana" : "legacy-evm";
}

function walletRole(family: InventoryFamily): BackupFileRole {
  return family === "solana" ? "wallet-solana" : "wallet-evm";
}

/**
 * Create a complete backup of the current wallet surface under
 * `BACKUPS_DIR/<timestamp>/`:
 *   - every inventory keystore (legacy fixed files + per-id `wallet-<id>.json`),
 *   - the encrypted secret vault (`secrets.vault.json`),
 *   - the `.env` file,
 *   - `config.json`,
 * plus a V2 `manifest.json` written LAST (after all copies succeed) so a copy
 * failure can never leave a "complete" manifest behind.
 *
 * Returns the backup path, or null if there is genuinely nothing to back up.
 * Throws VexError(AUTO_BACKUP_FAILED) on write failure.
 */
export async function autoBackup(
  options: AutoBackupOptions = {},
): Promise<string | null> {
  const purpose = options.purpose ?? "ordinary";
  const cfg = loadConfig();

  // Enumerate every inventory keystore the SAME way exportAllWallets does, so a
  // restore can rebuild the full inventory. A bad LOCAL id (config is trusted)
  // is skipped with a warning rather than aborting the whole backup.
  interface PlannedCopy {
    readonly src: string;
    readonly filename: string;
    readonly fileEntry: BackupFileEntry;
    readonly wallet: BackupManifestWallet;
  }
  const planned: PlannedCopy[] = [];

  for (const family of ["evm", "solana"] as const) {
    for (const entry of cfg.wallet[family]) {
      let src: string;
      try {
        src = derivePath(family, entry);
      } catch (err) {
        logger.warn(
          `Skipping ${family} wallet ${entry.id} in backup (non-canonical id): ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        continue;
      }
      if (!existsSync(src)) continue;
      const legacy = entry.legacy === true;
      const filename = basename(src);
      planned.push({
        src,
        filename,
        fileEntry: legacy
          ? { filename, role: legacyRole(family) }
          : {
              filename,
              role: walletRole(family),
              walletId: entry.id,
              walletFamily: family,
              address: entry.address,
            },
        wallet: {
          id: entry.id,
          family,
          address: entry.address,
          label: entry.label,
          createdAt: entry.createdAt,
          legacy,
        },
      });
    }
  }

  const hasVault = existsSync(SECRETS_VAULT_FILE);
  const hasEnv = existsSync(ENV_FILE);
  const hasConfig = existsSync(CONFIG_FILE);

  if (planned.length === 0 && !hasVault && !hasEnv && !hasConfig) {
    return null;
  }

  try {
    mkdirSync(BACKUPS_DIR, { recursive: true });

    const backupDirName = createBackupDirName(purpose);
    const backupDir = join(BACKUPS_DIR, backupDirName);
    mkdirSync(backupDir, { recursive: true });

    const files: BackupFileEntry[] = [];
    const wallets: BackupManifestWallet[] = [];

    // Copy keystores (throws on failure → no manifest written below).
    for (const item of planned) {
      copyBytes(item.src, join(backupDir, item.filename));
      files.push(item.fileEntry);
      wallets.push(item.wallet);
    }

    if (hasVault) {
      copyBytes(SECRETS_VAULT_FILE, join(backupDir, basename(SECRETS_VAULT_FILE)));
      files.push({ filename: basename(SECRETS_VAULT_FILE), role: "vault" });
    }
    if (hasEnv) {
      copyBytes(ENV_FILE, join(backupDir, basename(ENV_FILE)));
      files.push({ filename: basename(ENV_FILE), role: "env" });
    }
    if (hasConfig) {
      copyBytes(CONFIG_FILE, join(backupDir, basename(CONFIG_FILE)));
      files.push({ filename: basename(CONFIG_FILE), role: "config" });
    }

    const manifest: BackupManifestV2 = {
      version: 2,
      cliVersion: getCLIVersion(),
      createdAt: new Date().toISOString(),
      walletAddress: getPrimaryEvmAddress(cfg),
      solanaWalletAddress: getPrimarySolanaAddress(cfg),
      chainId: cfg.chain.chainId,
      wallets,
      files,
      purpose,
    };
    // Write manifest LAST — after every copy above succeeded.
    writeFileSync(
      join(backupDir, "manifest.json"),
      JSON.stringify(manifest, null, 2),
      "utf-8",
    );

    // Protect the snapshot we just created from being evicted by retention —
    // otherwise a pre-restore backup taken when already at MAX (or with
    // future-dated dirs on disk) could be pruned out from under the restore.
    enforceBackupRetention(backupDirName);

    if (purpose === "vault-reset") {
      logger.debug(
        `Vault-reset backup created files=${files.length} wallets=${wallets.length}`,
      );
    } else {
      logger.debug(`Auto-backup created at ${backupDir}`);
    }
    return backupDir;
  } catch (err) {
    if (err instanceof VexError) throw err;
    throw new VexError(
      ErrorCodes.AUTO_BACKUP_FAILED,
      `Failed to create auto-backup: ${err instanceof Error ? err.message : String(err)}`,
      "Check permissions on the config directory.",
    );
  }
}

/**
 * Byte-for-byte copy via read+write (NOT cpSync, which can preserve links /
 * permissions in surprising ways). Keystore/vault perms are re-applied by the
 * restore primitive on write; here we only need an exact-content copy.
 */
function copyBytes(src: string, dest: string): void {
  writeFileSync(dest, readFileSync(src));
}
