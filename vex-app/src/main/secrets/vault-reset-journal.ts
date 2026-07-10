import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { VAULT_RESET_JOURNAL_FILE } from "../paths/config-dir.js";

export const vaultResetJournalSchema = z.discriminatedUnion("state", [
  z.object({ version: z.literal(1), state: z.literal("requested") }).strict(),
  z
    .object({
      version: z.literal(1),
      state: z.literal("backup-complete"),
      backupDirName: z.string().min(1),
    })
    .strict(),
]);

export type VaultResetJournal = z.infer<typeof vaultResetJournalSchema>;
export type VaultResetJournalRead =
  | { readonly kind: "absent" }
  | { readonly kind: "unknown" }
  | { readonly kind: "invalid" }
  | { readonly kind: "valid"; readonly journal: VaultResetJournal };

function isErrno(error: unknown, code: string): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === code
  );
}

export async function readVaultResetJournal(
  filePath: string = VAULT_RESET_JOURNAL_FILE,
): Promise<VaultResetJournalRead> {
  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch (error) {
    return isErrno(error, "ENOENT") ? { kind: "absent" } : { kind: "unknown" };
  }
  try {
    const parsed = vaultResetJournalSchema.safeParse(JSON.parse(raw));
    return parsed.success
      ? { kind: "valid", journal: parsed.data }
      : { kind: "invalid" };
  } catch {
    return { kind: "invalid" };
  }
}

export async function writeVaultResetJournal(
  value: VaultResetJournal,
  filePath: string = VAULT_RESET_JOURNAL_FILE,
): Promise<void> {
  const validated = vaultResetJournalSchema.parse(value);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`;
  try {
    await fs.writeFile(tmp, JSON.stringify(validated, null, 2), {
      encoding: "utf8",
      mode: 0o600,
    });
    await fs.rename(tmp, filePath);
    await fs.chmod(filePath, 0o600);
  } catch (error) {
    await fs.unlink(tmp).catch(() => undefined);
    throw error;
  }
}

export async function clearVaultResetJournal(
  filePath: string = VAULT_RESET_JOURNAL_FILE,
): Promise<void> {
  await fs.unlink(filePath);
}
