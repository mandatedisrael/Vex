export type BackupPurpose = "ordinary" | "vault-reset";

const BACKUP_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{9}Z$/;

export function formatBackupTimestamp(date: Date): string {
  return date.toISOString().replace(/[:.]/g, "");
}

export function createBackupDirName(
  purpose: BackupPurpose,
  date: Date = new Date(),
): string {
  const timestamp = formatBackupTimestamp(date);
  return purpose === "vault-reset" ? `vault-reset-${timestamp}` : timestamp;
}

export function isCanonicalVaultResetBackupName(name: string): boolean {
  const prefix = "vault-reset-";
  return (
    name.startsWith(prefix) &&
    BACKUP_TIMESTAMP_PATTERN.test(name.slice(prefix.length))
  );
}
