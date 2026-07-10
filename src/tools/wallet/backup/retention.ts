/**
 * Backup retention: prune oldest backups down to MAX_BACKUPS.
 * No direct output — caller is responsible for display.
 */

import { existsSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

import { BACKUPS_DIR } from "../../../config/paths.js";
import { minLogger as logger } from "../../../utils/logger-shim.js";

const MAX_BACKUPS = 20;

/**
 * Prune oldest backups down to MAX_BACKUPS. `protectName` (a backup dir
 * basename) is NEVER evicted — used to guarantee a just-created pre-restore
 * snapshot survives even if other (possibly future-dated) dirs sort "newer".
 */
export function enforceBackupRetention(protectName?: string): void {
  if (!existsSync(BACKUPS_DIR)) return;
  try {
    const all = readdirSync(BACKUPS_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();

    const protectedExists = protectName !== undefined && all.includes(protectName);
    const isResetArchive = (name: string): boolean =>
      name.startsWith("vault-reset-");
    const ordinary = all.filter((name) => !isResetArchive(name));
    const candidates = ordinary.filter((name) => name !== protectName);
    // If the protected dir is on disk it occupies one retention slot.
    const protectedOrdinaryExists =
      protectedExists && !isResetArchive(protectName);
    const keep = Math.max(0, MAX_BACKUPS - (protectedOrdinaryExists ? 1 : 0));

    while (candidates.length > keep) {
      const oldest = candidates.shift()!;
      rmSync(join(BACKUPS_DIR, oldest), { recursive: true, force: true });
      logger.debug(`Removed old backup: ${oldest}`);
    }
  } catch {
    // best-effort
  }
}
