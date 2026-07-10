/**
 * Core wallet backup logic.
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
 *
 * Compatibility façade: the implementation now lives in `./backup/`. This file
 * re-exports the IDENTICAL public surface so existing callers (src/lib/wallet.ts
 * via @vex-lib, restore/, vex-app) see no difference.
 */

export {
  backupManifestV1Schema,
  backupManifestV2Schema,
  backupManifestSchema,
} from "./backup/manifest.js";
export type {
  BackupFileRole,
  BackupManifestV1,
  BackupManifestV2,
  BackupManifest,
  BackupManifestWallet,
  BackupFileEntry,
} from "./backup/manifest.js";
export { backupPurposeSchema } from "./backup/manifest.js";
export type { BackupPurpose } from "./backup/naming.js";
export {
  createBackupDirName,
  formatBackupTimestamp,
  isCanonicalVaultResetBackupName,
} from "./backup/naming.js";

export { autoBackup } from "./backup/create.js";
export type { AutoBackupOptions } from "./backup/create.js";
export { enforceBackupRetention } from "./backup/retention.js";
export { readArchiveManifest } from "./backup/read.js";
export { listAvailableBackups } from "./backup/list.js";
export type { AvailableBackup } from "./backup/list.js";
