/**
 * Wallet schemas — Wizard Step 2 (M8) IPC boundary.
 *
 * Six channels live under `CH.onboarding.wallet*`:
 *   - walletGenerate{Evm,Solana}    — generate fresh keypair, encrypt with
 *                                     master password from M7
 *   - walletImport{Evm,Solana}      — accept user-supplied raw private key
 *                                     (EVM hex / Solana base58 or JSON array),
 *                                     encrypt + persist
 *   - walletRestoreFromBackup        — main opens dialog → user picks .json
 *                                     keystore → main decrypts + verifies +
 *                                     mismatch-confirms + atomic-restores
 *   - walletOpenBackupFolder        — open a previously-created backup dir
 *                                     in the OS file manager
 *
 * Design notes per codex turn 8:
 * - rawKey for import is a SECRET. The schema accepts it at the IPC boundary
 *   but the renderer MUST collect it via uncontrolled DOM ref + clear-on-submit
 *   and MUST NOT route it through TanStack `useMutation` (which can park the
 *   variables in observer/cache state — SKILL §14 "no secrets in renderer
 *   state/query cache").
 * - The generate/import result schemas intentionally do NOT carry a
 *   `backupDir` field. M8 refuses overwrite (no force flag), so a fresh
 *   generate/import never triggers `autoBackup()`. Restore is the only path
 *   that produces a backup directory and exposes it for "Open backup folder".
 * - User cancellation of the file picker (restore) maps to
 *   `err({code:"internal.cancelled"})` so the renderer can silently no-op
 *   instead of rendering an error.
 */

import { z } from "zod";
import { PASSWORD_MIN_LENGTH } from "./secrets.js";

// ── Chain discriminator ───────────────────────────────────────────────────
export const chainSchema = z.enum(["evm", "solana"]);
export type WalletChain = z.infer<typeof chainSchema>;

// ── Address shapes (public, safe to surface) ──────────────────────────────
// EVM: 0x-prefixed 40 hex chars (20 bytes). Case is checksum-sensitive
// upstream (viem returns checksum-cased) so we accept both cases at the
// IPC boundary and let the renderer display verbatim.
const evmAddressSchema = z
  .string()
  .regex(/^0x[a-fA-F0-9]{40}$/, "Invalid EVM address.");

// Solana: base58 32-byte public key — typically 43 or 44 chars. We use a
// permissive length range (32-44) plus a base58-charset check to avoid
// false rejects on some edge bases.
const solanaAddressSchema = z
  .string()
  .min(32)
  .max(44)
  .regex(/^[1-9A-HJ-NP-Za-km-z]+$/, "Invalid Solana address (base58).");

// ── walletGenerate{Evm,Solana} ───────────────────────────────────────────
export const walletGenerateInputSchema = z.object({}).strict();

export const walletGenerateEvmResultSchema = z
  .object({ address: evmAddressSchema })
  .strict();
export type WalletGenerateEvmResult = z.infer<typeof walletGenerateEvmResultSchema>;

export const walletGenerateSolanaResultSchema = z
  .object({ address: solanaAddressSchema })
  .strict();
export type WalletGenerateSolanaResult = z.infer<typeof walletGenerateSolanaResultSchema>;

// ── walletImport{Evm,Solana} ─────────────────────────────────────────────
// rawKey is a secret. Min length is the only schema-side check; full format
// validation lives in main via `normalizePrivateKey()` (EVM) and
// `normalizeSolanaSecretKey()` (Solana auto-detect JSON-array vs base58).
// Renderer MUST clear the source DOM input + form state synchronously
// after a single async submit — see SKILL §14.
export const walletImportEvmInputSchema = z
  .object({ rawKey: z.string().min(1, "Private key required.") })
  .strict();
export type WalletImportEvmInput = z.infer<typeof walletImportEvmInputSchema>;

export const walletImportSolanaInputSchema = z
  .object({ rawKey: z.string().min(1, "Secret key required.") })
  .strict();
export type WalletImportSolanaInput = z.infer<typeof walletImportSolanaInputSchema>;

export const walletImportEvmResultSchema = walletGenerateEvmResultSchema;
export type WalletImportEvmResult = WalletGenerateEvmResult;

export const walletImportSolanaResultSchema = walletGenerateSolanaResultSchema;
export type WalletImportSolanaResult = WalletGenerateSolanaResult;

// ── walletRestoreFromBackup ─────────────────────────────────────────────
// No `sourcePath` on the input — the file picker runs in main (single
// roundtrip per codex turn 8 answer #2). Renderer never sees local
// filesystem paths.
export const walletRestoreInputSchema = z
  .object({ chain: chainSchema })
  .strict();
export type WalletRestoreInput = z.infer<typeof walletRestoreInputSchema>;

// `replacedAddress` is the prior on-disk address that was overwritten
// (null on first-time restore where no keystore previously existed).
// `backupDir` is the path of the auto-backup created before overwriting
// (null when nothing existed to back up — codex turn 8 answer #3).
export const walletRestoreResultSchema = z
  .object({
    chain: chainSchema,
    address: z.string(),
    replacedAddress: z.string().nullable(),
    backupDir: z.string().nullable(),
  })
  .strict();
export type WalletRestoreResult = z.infer<typeof walletRestoreResultSchema>;

// ── walletOpenBackupFolder ──────────────────────────────────────────────
// Renderer passes the `backupDir` it received from a previous restore
// result. Main MUST validate the path is a real directory inside
// `${CONFIG_DIR}/backups/` via `fs.realpath` BEFORE opening (codex turn
// 8 answer #5 — symlink-safe), otherwise refuses with
// `validation.invalid_input`.
export const walletOpenBackupFolderInputSchema = z
  .object({ backupDir: z.string().min(1) })
  .strict();
export type WalletOpenBackupFolderInput = z.infer<typeof walletOpenBackupFolderInputSchema>;

export const walletOpenBackupFolderResultSchema = z
  .object({ ok: z.boolean() })
  .strict();
export type WalletOpenBackupFolderResult = z.infer<typeof walletOpenBackupFolderResultSchema>;

// ── walletExportPrivateKey (Phase 2 feature #6) ────────────────────────
// Sudo-style re-auth flow: user re-types the master password and must
// explicitly acknowledge the risk before the handler decrypts a keystore
// and routes the raw secret to the OS clipboard with a clear-on-expiry
// lease. `riskAcknowledged: true` is a hard literal — schema rejects any
// other value at both ends of the IPC boundary so an accidental
// auto-tick / missing checkbox can never reach the decryption path.
export const walletExportPrivateKeyInputSchema = z
  .object({
    chain: chainSchema,
    password: z.string().min(PASSWORD_MIN_LENGTH),
    riskAcknowledged: z.literal(true),
  })
  .strict();
export type WalletExportPrivateKeyInput = z.infer<
  typeof walletExportPrivateKeyInputSchema
>;

// Result deliberately does NOT echo the secret. The handler writes it to
// the OS clipboard inside main and tells the renderer "copied — will
// auto-clear in clearAfterMs". `format` reports how the secret was
// encoded so the renderer can describe what was placed on the clipboard.
export const walletExportPrivateKeyResultSchema = z
  .object({
    chain: chainSchema,
    format: z.enum(["hex", "base58"]),
    copied: z.literal(true),
    clearAfterMs: z.number().int().positive(),
  })
  .strict();
export type WalletExportPrivateKeyResult = z.infer<
  typeof walletExportPrivateKeyResultSchema
>;
