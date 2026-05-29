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
//
// Exported because the polymarket auto-setup result schema (api-keys.ts)
// reuses it for the wallet address returned to the renderer.
export const evmAddressSchema = z
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

// ── walletListBackups / walletRestoreArchive (C2 — full-archive restore) ─────
//
// listBackups returns metadata ONLY (no secrets, no absolute paths). `id` is
// the opaque backup-dir basename the C1 primitive re-resolves under
// BACKUPS_DIR — the renderer never receives or sends a filesystem path.
//
// restoreArchive takes that opaque `id` + the master password. The result
// carries `filesRestored` (basenames) + `walletsRestored` (public inventory
// metadata, NO key material) + `vaultLocked`. The C1 primitive's absolute
// `backupDir` is deliberately NOT surfaced over IPC (metadata-only boundary).
export const walletListBackupsInputSchema = z.object({}).strict();
export type WalletListBackupsInput = z.infer<typeof walletListBackupsInputSchema>;

export const walletAvailableBackupSchema = z
  .object({
    id: z.string().min(1),
    timestamp: z.string(),
    walletCount: z.number().int().nonnegative(),
    addresses: z.array(z.string()),
    vaultIncluded: z.boolean(),
    envIncluded: z.boolean(),
  })
  .strict();
export type WalletAvailableBackup = z.infer<typeof walletAvailableBackupSchema>;

export const walletListBackupsResultSchema = z
  .object({ backups: z.array(walletAvailableBackupSchema) })
  .strict();
export type WalletListBackupsResult = z.infer<typeof walletListBackupsResultSchema>;

export const walletRestoreArchiveInputSchema = z
  .object({
    // Opaque backup id from listBackups (a directory basename) — NOT a path.
    id: z.string().min(1),
    password: z.string().min(1),
  })
  .strict();
export type WalletRestoreArchiveInput = z.infer<
  typeof walletRestoreArchiveInputSchema
>;

// Public, secret-free inventory metadata mapped from the C1
// `WalletInventoryEntry`. `legacy` is optional (absent for non-legacy ids).
export const walletRestoredEntrySchema = z
  .object({
    id: z.string(),
    address: z.string(),
    label: z.string(),
    createdAt: z.string(),
    legacy: z.boolean().optional(),
  })
  .strict();
export type WalletRestoredEntry = z.infer<typeof walletRestoredEntrySchema>;

export const walletRestoreArchiveResultSchema = z
  .object({
    filesRestored: z.array(z.string()),
    walletsRestored: z.array(walletRestoredEntrySchema),
    vaultLocked: z.boolean(),
  })
  .strict();
export type WalletRestoreArchiveResult = z.infer<
  typeof walletRestoreArchiveResultSchema
>;

// ── Multi-wallet inventory add/import/export (puzzle 5 phase 5D) ─────────────
// Append (not overwrite) up to 3/family. `label` capped here (boundary) AND in
// the engine inventory helper. Results carry no key material.
export const walletAddInputSchema = z
  .object({ label: z.string().trim().max(120).optional() })
  .strict();
export type WalletAddInput = z.infer<typeof walletAddInputSchema>;

export const walletImportAddInputSchema = z
  .object({ rawKey: z.string().min(1), label: z.string().trim().max(120).optional() })
  .strict();
export type WalletImportAddInput = z.infer<typeof walletImportAddInputSchema>;

export const walletAddResultSchema = z
  .object({
    id: z.string().max(128),
    address: z.string().max(128),
    label: z.string().max(120),
  })
  .strict();
export type WalletAddResult = z.infer<typeof walletAddResultSchema>;

export const walletExportAllInputSchema = z.object({}).strict();
export type WalletExportAllInput = z.infer<typeof walletExportAllInputSchema>;

export const walletExportAllResultSchema = z
  .object({ files: z.array(z.string().max(256)).max(64) })
  .strict();
export type WalletExportAllResult = z.infer<typeof walletExportAllResultSchema>;

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
    /**
     * Which wallet to export (multi-wallet, up to 3/family). Main is the
     * authority: it resolves this id → inventory entry → keystore path and
     * verifies the decrypted key derives the recorded address. The renderer
     * NEVER sends the address as authority.
     */
    walletId: z.string().min(1).max(128),
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

// ── Agent integration puzzle 1: per-session wallet scope ─────────────────
//
// Per-session wallet scope DB rows don't exist yet (planned for puzzle 05/10
// when wallet scope + mission contract hash + audit storage land together).
// In puzzle 1 the read-only handler returns an empty scope so the renderer
// hooks compile end-to-end; the mutating handlers fail closed with
// `wallets.feature_unavailable`. The DTO shapes ship now so the bridge
// surface is stable for the puzzle 05/10 UI work.
//
// Field names match the canonical refs vocabulary in `BUG-REPORTING.md §3`
// — `sessionId` is the canonical identifier, never `session_id` snake_case.
//
// `intent_id` is local-wallet only. Wallet side effects use hot wallets
// created or imported by the user during onboarding.

export const WALLET_INTENT_MAX_LIST = 16;

// Puzzle 5 phase 5C: per-session wallet selection is an explicit 1 EVM + 1
// Solana pair (immutable at session start), NOT an allow-list. `null` per
// family = unselected → wallet tools for that family fail closed.
export const selectedWalletDtoSchema = z
  .object({
    walletId: z.string().max(128),
    address: z.string().max(128),
    label: z.string().max(120),
  })
  .strict();
export type SelectedWalletDto = z.infer<typeof selectedWalletDtoSchema>;

export const sessionWalletScopeDtoSchema = z
  .object({
    sessionId: z.string().uuid(),
    evm: selectedWalletDtoSchema.nullable(),
    solana: selectedWalletDtoSchema.nullable(),
  })
  .strict();
export type SessionWalletScopeDto = z.infer<typeof sessionWalletScopeDtoSchema>;

export const walletsListSessionInputSchema = z
  .object({
    sessionId: z.string().uuid(),
  })
  .strict();
export type WalletsListSessionInput = z.infer<
  typeof walletsListSessionInputSchema
>;

// Renderer sends only wallet IDs; main resolves id → address from the engine
// inventory server-side (never trust a renderer-supplied address). `null` =
// leave that family unselected.
export const walletsSetScopeInputSchema = z
  .object({
    sessionId: z.string().uuid(),
    evmWalletId: z.string().max(128).nullable(),
    solanaWalletId: z.string().max(128).nullable(),
  })
  .strict();
export type WalletsSetScopeInput = z.infer<typeof walletsSetScopeInputSchema>;

// ── Available wallets (engine inventory, surfaced for the create picker) ──
// Read from config-backed inventory in main; addresses are public, keys never
// cross the boundary.
export const walletsListAvailableInputSchema = z.object({}).strict();
export type WalletsListAvailableInput = z.infer<typeof walletsListAvailableInputSchema>;

export const availableWalletDtoSchema = z
  .object({
    id: z.string().max(128),
    family: z.enum(["evm", "solana"]),
    address: z.string().max(128),
    label: z.string().max(120),
  })
  .strict();
export type AvailableWalletDto = z.infer<typeof availableWalletDtoSchema>;

export const availableWalletsDtoSchema = z
  .object({
    evm: z.array(availableWalletDtoSchema).max(WALLET_INTENT_MAX_LIST),
    solana: z.array(availableWalletDtoSchema).max(WALLET_INTENT_MAX_LIST),
  })
  .strict();
export type AvailableWalletsDto = z.infer<typeof availableWalletsDtoSchema>;

/**
 * Wallet intent shapes — puzzle 5 phase 4 (DB-backed durable intents).
 *
 * Mirrors the `wallet_intents` table CHECK enums from migration 025. The
 * status enum carries the full lifecycle (`audit_failed` distinguishes
 * "tx on-chain, audit row broken" from generic `failed`); the renderer
 * uses `txHash` + `status` together to render "broadcast failed" vs
 * "no broadcast" (Codex puzzle-5 phase-4 review v3).
 */
export const walletIntentNetworkSchema = z.enum(["eip155", "solana"]);
export type WalletIntentNetwork = z.infer<typeof walletIntentNetworkSchema>;

export const walletIntentStatusSchema = z.enum([
  "pending",
  "consuming",
  "executed",
  "failed",
  "audit_failed",
  "cancelled",
  "expired",
]);
export type WalletIntentStatus = z.infer<typeof walletIntentStatusSchema>;

/**
 * Allow-listed structured preview from `wallet_intents.preview_json`. The
 * main-side mapper Zod-safeparses incoming JSONB and drops malformed shapes
 * to null — raw blob never reaches the renderer.
 */
export const walletIntentPreviewSchema = z
  .object({
    label: z.string().max(200),
    criticalArgs: z.record(
      z.string(),
      z.union([z.string(), z.number(), z.boolean(), z.null()]),
    ),
  })
  .strict();
export type WalletIntentPreview = z.infer<typeof walletIntentPreviewSchema>;

/**
 * Renderer-facing intent DTO. `failure_reason` is intentionally NOT
 * surfaced (defense-in-depth — structural labels can still carry hashes
 * the renderer doesn't need; phase 7 audit UI can decide what to expose).
 */
export const preparedIntentDtoSchema = z
  .object({
    intentId: z.string().min(1),
    sessionId: z.string().uuid(),
    walletAddress: z.string().min(1),
    network: walletIntentNetworkSchema,
    chain: z.string().nullable(),
    to: z.string().min(1),
    amount: z.string().min(1),
    token: z.string().nullable(),
    status: walletIntentStatusSchema,
    createdAt: z.string().datetime({ offset: true }),
    expiresAt: z.string().datetime({ offset: true }),
    consumedAt: z.string().datetime({ offset: true }).nullable(),
    cancelledAt: z.string().datetime({ offset: true }).nullable(),
    txHash: z.string().nullable(),
    preview: walletIntentPreviewSchema.nullable(),
  })
  .strict();
export type PreparedIntentDto = z.infer<typeof preparedIntentDtoSchema>;

/**
 * `sessionId` is REQUIRED on get + cancel inputs (Codex puzzle-5 phase-4
 * review point 3 — cross-session lookup MUST miss). The DB CAS includes
 * `WHERE session_id = $2`; engine confirm validates `intent.sessionId ===
 * context.sessionId`.
 */
export const walletsGetPreparedIntentInputSchema = z
  .object({
    sessionId: z.string().uuid(),
    intentId: z.string().min(1),
  })
  .strict();
export type WalletsGetPreparedIntentInput = z.infer<
  typeof walletsGetPreparedIntentInputSchema
>;

export const walletsCancelPreparedIntentInputSchema =
  walletsGetPreparedIntentInputSchema;
export type WalletsCancelPreparedIntentInput = z.infer<
  typeof walletsCancelPreparedIntentInputSchema
>;

/**
 * `'cancelled'` joins the enum in phase 4 — cancel CAS won. Cross-session
 * cancel also maps to `'already_terminal'` (don't expose existence).
 * `'queued'` reserved for future async cancel paths; `'unavailable'` is
 * the legacy fail-closed status retained for back-compat.
 */
export const walletsActionResultSchema = z
  .object({
    intentId: z.string().min(1),
    status: z.enum([
      "queued",
      "cancelled",
      "already_terminal",
      "unavailable",
    ]),
    message: z.string(),
  })
  .strict();
export type WalletsActionResult = z.infer<typeof walletsActionResultSchema>;

export const walletsSetScopeResultSchema = z
  .object({
    sessionId: z.string().uuid(),
    status: z.enum(["updated", "unchanged", "unavailable"]),
    message: z.string(),
  })
  .strict();
export type WalletsSetScopeResult = z.infer<typeof walletsSetScopeResultSchema>;
