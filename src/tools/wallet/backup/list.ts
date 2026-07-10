/**
 * List backup archives with metadata-only (no secrets, no absolute paths).
 * No direct output — caller is responsible for display.
 */

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { BACKUPS_DIR } from "../../../config/paths.js";
import { minLogger as logger } from "../../../utils/logger-shim.js";
import type { BackupManifest } from "./manifest.js";
import { readArchiveManifest } from "./read.js";

export interface AvailableBackup {
  /**
   * Opaque archive id = the backup directory's basename (a timestamp). NOT an
   * absolute path: the caller (vex-app main) resolves it under BACKUPS_DIR and
   * the restore primitive re-validates containment via realpath. Keeping the
   * surface path-free avoids leaking the on-disk layout to the renderer.
   */
  readonly id: string;
  readonly timestamp: string;
  readonly walletCount: number;
  readonly addresses: string[];
  readonly vaultIncluded: boolean;
  readonly envIncluded: boolean;
}

/**
 * List backup archives under BACKUPS_DIR with metadata ONLY (no secrets, no
 * absolute paths), sorted newest-first. Tolerates V1 and V2 manifests; a
 * missing/corrupt manifest is skipped with a warning rather than throwing.
 */
export function listAvailableBackups(): AvailableBackup[] {
  if (!existsSync(BACKUPS_DIR)) return [];

  let dirs: string[];
  try {
    dirs = readdirSync(BACKUPS_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch (err) {
    logger.warn(
      `Could not enumerate backups: ${err instanceof Error ? err.message : String(err)}`,
    );
    return [];
  }

  const out: AvailableBackup[] = [];
  for (const id of dirs) {
    const dir = join(BACKUPS_DIR, id);
    let manifest: BackupManifest;
    try {
      manifest = readArchiveManifest(dir);
    } catch {
      logger.warn(`Skipping backup ${id}: missing or invalid manifest.`);
      continue;
    }

    if (manifest.version === 2) {
      const addresses = manifest.wallets.map((w) => w.address);
      out.push({
        id,
        timestamp: manifest.createdAt,
        walletCount: manifest.wallets.length,
        addresses,
        vaultIncluded: manifest.files.some((f) => f.role === "vault"),
        envIncluded: manifest.files.some((f) => f.role === "env"),
      });
      continue;
    }

    // V1: no inventory snapshot — derive a best-effort metadata view.
    const addresses: string[] = [];
    if (manifest.walletAddress) addresses.push(manifest.walletAddress);
    if (manifest.solanaWalletAddress) addresses.push(manifest.solanaWalletAddress);
    out.push({
      id,
      timestamp: manifest.createdAt ?? id,
      walletCount: addresses.length,
      addresses,
      vaultIncluded: false,
      envIncluded: false,
    });
  }

  return out.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}
