/**
 * Wallet API hooks (M8) — TanStack Query wrappers over `vex.onboarding.wallet*`.
 *
 * IMPORTANT secret-handling rule (codex turn 8 RED #1):
 * - Generate, restore, and openBackupFolder use TanStack `useMutation`
 *   because their inputs carry NO secrets (empty / chain enum / public path).
 * - Import does NOT use useMutation. Mutation observers retain the last
 *   `variables` (`{ rawKey }`) in cache state for staleness/devtools/etc.,
 *   which conflicts with SKILL §14 "no secrets in renderer state/query
 *   cache". Import is exposed as a plain async function. Caller drives
 *   pending state via local `useState` and clears the source DOM input
 *   synchronously before the await resolves.
 */

import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import type { Result } from "@shared/ipc/result.js";
import type {
  WalletAddInput,
  WalletAddResult,
  WalletChain,
  WalletExportAllResult,
  WalletGenerateEvmResult,
  WalletGenerateSolanaResult,
  WalletImportEvmResult,
  WalletImportSolanaResult,
  WalletListBackupsResult,
  WalletOpenBackupFolderInput,
  WalletOpenBackupFolderResult,
  WalletRestoreArchiveResult,
  WalletRestoreInput,
  WalletRestoreResult,
} from "@shared/schemas/wallets.js";
import { onboardingKeys, walletsKeys } from "./queryKeys.js";

type GenerateMutationResult<T> = UseMutationResult<Result<T>, Error, void>;

/**
 * After any wallet write (generate / import / add / restore) both the
 * onboarding env-state badge AND the global inventory list
 * (`walletsKeys.available()`, consumed by the multi-wallet onboarding UI +
 * the session-create picker) must refetch (Codex 5D wiring review).
 */
function invalidateWalletQueries(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: onboardingKeys.envState() });
  void queryClient.invalidateQueries({ queryKey: walletsKeys.available() });
}

/**
 * Generate a new wallet for the given chain. Per-chain hook so the
 * EVM tab and Solana tab maintain independent `isPending` state.
 * Invalidates `envState` on success so the skip badge updates after
 * the next mount.
 */
export function useWalletGenerate(
  chain: WalletChain
): GenerateMutationResult<WalletGenerateEvmResult | WalletGenerateSolanaResult> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      chain === "evm"
        ? window.vex.onboarding.walletGenerateEvm()
        : window.vex.onboarding.walletGenerateSolana(),
    onSuccess: (result) => {
      if (result.ok) invalidateWalletQueries(queryClient);
    },
  });
}

/**
 * Restore a wallet from a backup keystore file. Main triggers the file
 * picker on this call; renderer never sees the local path. Per-chain
 * hook for symmetric isPending state with generate.
 */
export function useWalletRestore(
  chain: WalletChain
): UseMutationResult<Result<WalletRestoreResult>, Error, void> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => {
      const input: WalletRestoreInput = { chain };
      return window.vex.onboarding.walletRestoreFromBackup(input);
    },
    onSuccess: (result) => {
      if (result.ok) invalidateWalletQueries(queryClient);
    },
  });
}

/**
 * Open a backup folder in the OS file manager. Main validates the path
 * stays inside `${CONFIG_DIR}/backups/` (realpath-safe) before opening.
 */
export function useOpenBackupFolder(): UseMutationResult<
  Result<WalletOpenBackupFolderResult>,
  Error,
  WalletOpenBackupFolderInput
> {
  return useMutation({
    mutationFn: (input: WalletOpenBackupFolderInput) =>
      window.vex.onboarding.walletOpenBackupFolder(input),
  });
}

/**
 * Import a wallet — direct async function, NOT a hook. The `rawKey` is
 * a secret; routing it through `useMutation` would park the variables
 * in observer state (codex turn 8 RED #1). Callers MUST:
 *  - read rawKey from an uncontrolled DOM ref at submit time,
 *  - clear `inputRef.current.value = ""` immediately after kicking off
 *    the import (synchronously, before the IPC promise resolves),
 *  - call `invalidateEnvStateAfterWalletWrite(queryClient)` on success.
 */
export async function importWalletEvm(
  rawKey: string
): Promise<Result<WalletImportEvmResult>> {
  return window.vex.onboarding.walletImportEvm({ rawKey });
}

export async function importWalletSolana(
  rawKey: string
): Promise<Result<WalletImportSolanaResult>> {
  return window.vex.onboarding.walletImportSolana({ rawKey });
}

// ── Multi-wallet inventory (puzzle 5 phase 5D) ───────────────────────────────
// After the FIRST wallet per family (legacy generate/import/restore above),
// these append additional wallets (≤3 per family). Generate-add carries no
// secret → useMutation. Import-add carries a raw key → bare async (same rule
// as importWalletEvm: caller clears the DOM input synchronously before await).

type AddMutationResult = UseMutationResult<
  Result<WalletAddResult>,
  Error,
  WalletAddInput
>;

/**
 * Append a freshly-generated wallet to the given family's inventory. Per-chain
 * hook so each tab keeps independent `isPending`. Invalidates env-state +
 * the global inventory list on success.
 */
export function useWalletAdd(chain: WalletChain): AddMutationResult {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: WalletAddInput) =>
      chain === "evm"
        ? window.vex.onboarding.walletAddEvm(input)
        : window.vex.onboarding.walletAddSolana(input),
    onSuccess: (result) => {
      if (result.ok) invalidateWalletQueries(queryClient);
    },
  });
}

/**
 * Import-add — direct async, NOT a hook. `rawKey` is a secret (see
 * `importWalletEvm`). Caller reads it from an uncontrolled DOM ref, clears the
 * input synchronously before the await, and calls
 * `useInvalidateEnvStateAfterWalletWrite()` on success.
 */
export async function importAddWalletEvm(
  rawKey: string,
  label?: string
): Promise<Result<WalletAddResult>> {
  return window.vex.onboarding.walletImportAddEvm({ rawKey, label });
}

export async function importAddWalletSolana(
  rawKey: string,
  label?: string
): Promise<Result<WalletAddResult>> {
  return window.vex.onboarding.walletImportAddSolana({ rawKey, label });
}

/**
 * Export every wallet (both families) to a user-chosen directory. Main owns
 * the directory picker; renderer never sees the path — the result carries
 * filenames only (no secrets, no absolute path). No secret input → useMutation.
 */
export function useExportAllWallets(): UseMutationResult<
  Result<WalletExportAllResult>,
  Error,
  void
> {
  return useMutation({
    mutationFn: () => window.vex.onboarding.walletExportAll({}),
  });
}

/**
 * Helper for the bare-async import paths to invalidate env-state + the global
 * inventory list — pulls the QueryClient via a hook indirection so callers
 * don't have to wire one manually.
 */
export function useInvalidateEnvStateAfterWalletWrite(): () => void {
  const queryClient = useQueryClient();
  return () => invalidateWalletQueries(queryClient);
}

// ── Full-archive restore (C3) ────────────────────────────────────────────────
// `listBackups` is metadata-only (opaque backup `id`s, public addresses — NO
// secrets, NO absolute paths). `restoreArchive` takes that opaque `id` + the
// master password and rebuilds the entire local inventory + vault + .env in
// main, then refreshes the process runtime. The renderer NEVER receives key
// material; the password lives only in the uncontrolled DOM input at the call
// site and is cleared immediately after submit (never in state / cache / logs).

const BACKUPS_STALE_MS = 30_000;

export function backupsListOptions() {
  return queryOptions({
    queryKey: onboardingKeys.backups(),
    queryFn: () => window.vex.onboarding.listBackups(),
    staleTime: BACKUPS_STALE_MS,
  });
}

/**
 * Available backup archives for the restore screen. Returns the `Result`
 * un-unwrapped (same convention as `useEnvState` / `useAvailableWallets`):
 * the component branches on `.ok` to render the metadata-only success state
 * vs. the redacted error. Enabled by default.
 */
export function useListBackups(): UseQueryResult<Result<WalletListBackupsResult>> {
  return useQuery(backupsListOptions());
}

/**
 * Restore a full backup archive — direct async function, NOT a `useMutation`
 * hook. The `password` is a secret: routing it through `useMutation` would
 * park it in the mutation observer's retained `variables` (devtools / staleness
 * / re-render), which violates the repo's hard secret rule (codex turn 8 RED
 * #1, same reason `importWalletEvm` and `wallet.exportPrivateKey` are bare
 * async). The caller therefore:
 *  - reads `password` from an uncontrolled DOM ref at submit time,
 *  - clears that input synchronously before the IPC promise resolves,
 *  - drives pending state via a local `useState`,
 *  - calls `useInvalidateAfterArchiveRestore()` on a successful result.
 *
 * This is a dangerous, non-idempotent operation: it replaces the existing
 * wallet set (main shows a native replace-confirm dialog) — so it must never
 * be silently retried, which the bare-async shape also guarantees (no
 * `retry` machinery).
 */
export async function restoreArchive(
  id: string,
  password: string
): Promise<Result<WalletRestoreArchiveResult>> {
  return window.vex.onboarding.restoreArchive(id, password);
}

/**
 * Invalidate everything a successful archive restore changes: the global
 * wallet inventory + onboarding env-state badge (`invalidateWalletQueries`),
 * the wizard state (the rebuilt config may flip step completion), and the
 * backups listing itself (the archive set may have changed). Hook indirection
 * so the bare-async caller doesn't wire a QueryClient manually.
 */
export function useInvalidateAfterArchiveRestore(): () => void {
  const queryClient = useQueryClient();
  return () => {
    invalidateWalletQueries(queryClient);
    void queryClient.invalidateQueries({
      queryKey: onboardingKeys.wizardState(),
    });
    void queryClient.invalidateQueries({ queryKey: onboardingKeys.backups() });
  };
}
