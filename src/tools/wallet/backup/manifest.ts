/**
 * Backup manifest schemas + types — the PUBLIC contract consumed by restore/.
 *
 * Manifest V2 (the backup writer's format): captures the FULL wallet surface —
 * every per-family inventory keystore (legacy fixed file + per-id
 * `wallet-<id>.json`), the encrypted secret vault, the sanitized `.env`, and
 * `config.json`. V1 (legacy: a flat `files: string[]`) is parsed ONLY for
 * listing metadata (`listAvailableBackups`). Archive RESTORE is V2-only and
 * fail-closed on V1 (a V1 manifest carries no per-file roles, so restoring from
 * it would be ambiguous); recover individual legacy keystores via the
 * single-file `restoreWalletFromFile` path instead.
 */

import { z } from "zod";

export const backupPurposeSchema = z.enum(["ordinary", "vault-reset"]);

// ── Manifest schemas / types ────────────────────────────────────────────────

/** A file recorded in a V2 backup manifest. `role` tags how restore should treat it. */
export type BackupFileRole =
  | "legacy-evm"
  | "legacy-solana"
  | "wallet-evm"
  | "wallet-solana"
  | "vault"
  | "env"
  | "config";

const backupFileEntrySchema = z.object({
  filename: z.string().min(1),
  role: z.enum([
    "legacy-evm",
    "legacy-solana",
    "wallet-evm",
    "wallet-solana",
    "vault",
    "env",
    "config",
  ]),
  walletId: z.string().optional(),
  walletFamily: z.enum(["evm", "solana"]).optional(),
  address: z.string().optional(),
});

const backupManifestWalletSchema = z.object({
  id: z.string(),
  family: z.enum(["evm", "solana"]),
  address: z.string(),
  label: z.string(),
  createdAt: z.string(),
  legacy: z.boolean(),
});

/** V1 manifest (pre-multi-wallet): a flat list of filenames. Read-only. */
export const backupManifestV1Schema = z.object({
  version: z.literal(1),
  cliVersion: z.string().optional(),
  createdAt: z.string().optional(),
  walletAddress: z.string().nullable().optional(),
  solanaWalletAddress: z.string().nullable().optional(),
  chainId: z.number().optional(),
  files: z.array(z.string()),
});

/** V2 manifest: full wallet surface with per-file roles + inventory snapshot. */
export const backupManifestV2Schema = z.object({
  version: z.literal(2),
  cliVersion: z.string(),
  createdAt: z.string(),
  walletAddress: z.string().nullable().optional(),
  solanaWalletAddress: z.string().nullable().optional(),
  chainId: z.number().optional(),
  wallets: z.array(backupManifestWalletSchema),
  files: z.array(backupFileEntrySchema),
  purpose: backupPurposeSchema.optional().default("ordinary"),
});

/**
 * Version-gated parse accepting V1 AND V2. A discriminated union on `version`
 * gives precise error messages and rejects any other shape (incl. version > 2).
 */
export const backupManifestSchema = z.discriminatedUnion("version", [
  backupManifestV1Schema,
  backupManifestV2Schema,
]);

export type BackupManifestV1 = z.infer<typeof backupManifestV1Schema>;
export type BackupManifestV2 = z.infer<typeof backupManifestV2Schema>;
export type BackupManifest = z.infer<typeof backupManifestSchema>;
export type BackupManifestWallet = z.infer<typeof backupManifestWalletSchema>;
export type BackupFileEntry = z.infer<typeof backupFileEntrySchema>;
