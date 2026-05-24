/**
 * Core wallet backup logic.
 * No CLI output — caller is responsible for display.
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, cpSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../../config/store.js";
import { getPrimaryEvmAddress, getPrimarySolanaAddress } from "./inventory.js";
import { CONFIG_DIR, BACKUPS_DIR, SOLANA_KEYSTORE_FILE } from "../../config/paths.js";
import { VexError, ErrorCodes } from "../../errors.js";
import { minLogger as logger } from "../../utils/logger-shim.js";

const MAX_BACKUPS = 20;

interface BackupManifest {
  version: 1;
  cliVersion: string;
  createdAt: string;
  walletAddress: string | null;
  solanaWalletAddress: string | null;
  chainId: number;
  files: string[];
}

function getCLIVersion(): string {
  try {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const pkgPath = join(__dirname, "..", "..", "..", "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    return pkg.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

/**
 * Create a backup of keystore.json and/or config.json.
 * Returns backup path, or null if nothing to back up.
 * Throws VexError(AUTO_BACKUP_FAILED) on write failure.
 */
export async function autoBackup(): Promise<string | null> {
  const keystorePath = join(CONFIG_DIR, "keystore.json");
  const solanaKeystorePath = SOLANA_KEYSTORE_FILE;
  const configPath = join(CONFIG_DIR, "config.json");

  const hasKeystore = existsSync(keystorePath);
  const hasSolanaKeystore = existsSync(solanaKeystorePath);
  const hasConfig = existsSync(configPath);

  if (!hasKeystore && !hasSolanaKeystore && !hasConfig) {
    return null;
  }

  try {
    mkdirSync(BACKUPS_DIR, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, "").replace("Z", "Z");
    const backupDir = join(BACKUPS_DIR, timestamp);
    mkdirSync(backupDir, { recursive: true });

    const files: string[] = [];

    if (hasKeystore) {
      cpSync(keystorePath, join(backupDir, "keystore.json"));
      files.push("keystore.json");
    }
    if (hasSolanaKeystore) {
      cpSync(solanaKeystorePath, join(backupDir, "solana-keystore.json"));
      files.push("solana-keystore.json");
    }
    if (hasConfig) {
      cpSync(configPath, join(backupDir, "config.json"));
      files.push("config.json");
    }

    const cfg = loadConfig();
    const manifest: BackupManifest = {
      version: 1,
      cliVersion: getCLIVersion(),
      createdAt: new Date().toISOString(),
      walletAddress: getPrimaryEvmAddress(cfg),
      solanaWalletAddress: getPrimarySolanaAddress(cfg),
      chainId: cfg.chain.chainId,
      files,
    };
    writeFileSync(join(backupDir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf-8");

    // Enforce retention: remove oldest if over MAX_BACKUPS
    enforceBackupRetention();

    logger.debug(`Auto-backup created at ${backupDir}`);
    return backupDir;
  } catch (err) {
    throw new VexError(
      ErrorCodes.AUTO_BACKUP_FAILED,
      `Failed to create auto-backup: ${err instanceof Error ? err.message : String(err)}`,
      "Check permissions on the config directory."
    );
  }
}

export function enforceBackupRetention(): void {
  if (!existsSync(BACKUPS_DIR)) return;
  try {
    const entries = readdirSync(BACKUPS_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();

    while (entries.length > MAX_BACKUPS) {
      const oldest = entries.shift()!;
      rmSync(join(BACKUPS_DIR, oldest), { recursive: true, force: true });
      logger.debug(`Removed old backup: ${oldest}`);
    }
  } catch {
    // best-effort
  }
}
