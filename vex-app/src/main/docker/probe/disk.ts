/**
 * Available disk-space probe for the System Check screen. Returns GB
 * available at `targetPath` (rounded to 2 decimals), or 0 on any error.
 */

import { statfs } from "node:fs/promises";

// ── Disk space ───────────────────────────────────────────────────────

export async function getAvailableDiskGB(targetPath: string): Promise<number> {
  try {
    const stats = await statfs(targetPath);
    const bytes = stats.bavail * stats.bsize;
    const gb = bytes / 1024 / 1024 / 1024;
    // Round to 2 decimals — anything below ~5GB is the operational threshold
    // surface as a warning row in System Check.
    return Math.max(0, Math.round(gb * 100) / 100);
  } catch {
    return 0;
  }
}
