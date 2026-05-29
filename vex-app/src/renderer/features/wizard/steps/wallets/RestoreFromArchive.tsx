/**
 * "Restore from backup" panel (C3 — full-archive restore).
 *
 * Cross-family restore: rebuilds the ENTIRE local wallet inventory (+ vault +
 * .env) from a single backup archive, so — like `ExportAllWallets` — it lives
 * at the WalletsStep level rather than per-chain. It is rendered as an inline,
 * progressively-disclosed panel (collapsed trigger → expanded list + form),
 * matching the inline `ExportAllWallets` panel it sits beside. A modal was
 * deliberately NOT used: the dangerous, OS-level replace confirmation is owned
 * by MAIN (a native dialog shown during `restoreArchive`); the renderer's job
 * is only to pick an archive, collect the master password, and surface the
 * result.
 *
 * Secret discipline (codex turn 8 RED #1, mirrors ExportPrivateKeyModal):
 *  - The master password lives ONLY in the uncontrolled DOM input
 *    (`passwordRef`); it is read once on submit and wiped immediately after.
 *  - React state tracks only a boolean "is the field non-empty" to gate the
 *    Restore button — never the value itself.
 *  - The restore IPC is a bare async call (`restoreArchive`), NOT a
 *    `useMutation`, so the password never lands in mutation observer state.
 *  - The result carries NO key material (public addresses / labels only); we
 *    render counts + truncated addresses, never keys.
 *
 * `vaultLocked: true` means the restored vault was sealed with a DIFFERENT
 * master password (the backup's own password). We surface a prominent note
 * that the user must re-unlock Vex with that backup's password afterwards.
 */

import {
  useCallback,
  useRef,
  useState,
  type FormEvent,
  type JSX,
} from "react";
import type { VexErrorCode } from "@shared/ipc/result.js";
import type {
  WalletAvailableBackup,
  WalletRestoreArchiveResult,
} from "@shared/schemas/wallets.js";
import { Button } from "../../../../components/ui/button.js";
import { Label } from "../../../../components/ui/label.js";
import { PasswordField } from "../../../../components/common/PasswordField.js";
import { AddressDisplay } from "../../../../components/common/AddressDisplay.js";
import {
  restoreArchive,
  useInvalidateAfterArchiveRestore,
  useListBackups,
} from "../../../../lib/api/wallets.js";

/**
 * Friendly, user-actionable copy for the restore-specific error codes. The
 * restore flow has its own vocabulary (archive integrity, replace-cancel),
 * so it maps codes locally rather than reusing the export-oriented
 * `getErrorCopy` helper. Unknown codes fall back to the redacted main message.
 */
function restoreErrorMessage(code: VexErrorCode, fallback: string): string {
  switch (code) {
    case "wallet.password_invalid":
      return "Master password is incorrect for this backup.";
    case "wallet.signer_mismatch":
      return "This backup is inconsistent: a restored key does not match its recorded address. The archive may be tampered with or corrupt.";
    case "validation.archive_incomplete":
      return "This backup is incomplete and can't be restored. Choose a different backup.";
    case "validation.archive_manifest_malformed":
      return "This backup's manifest is malformed and can't be read. Choose a different backup.";
    case "wallet.cap_reached":
      return "Restoring this backup would exceed the wallet limit. Remove some wallets first, or choose a smaller backup.";
    case "wallet.user_rejected":
      return "Restore cancelled — the existing wallets were not replaced.";
    case "validation.invalid_input":
      return "That backup could not be selected. Refresh the list and try again.";
    case "onboarding.env_persist_failed":
      // In the archive-restore flow this code is AUTO_BACKUP_FAILED: C1 aborts
      // BEFORE any live write because it could not snapshot the current wallets
      // first. So NOTHING was changed — the copy must say so (not "restored").
      return "Couldn't snapshot your current wallets before restoring, so nothing was changed. Free up disk space (and check folder permissions), then try again.";
    case "wallet.keystore_locked":
      return "Vault session locked. Unlock Vex again, then retry the restore.";
    default:
      return fallback;
  }
}

function backupCardLabel(backup: WalletAvailableBackup): string {
  const date = new Date(backup.timestamp);
  const when = Number.isNaN(date.getTime())
    ? backup.timestamp
    : date.toLocaleString();
  const count =
    backup.walletCount === 1 ? "1 wallet" : `${backup.walletCount} wallets`;
  return `Backup from ${when}, ${count}`;
}

interface RestoreResultView {
  readonly result: WalletRestoreArchiveResult;
}

function RestoreSummary({ result }: RestoreResultView): JSX.Element {
  const walletWord =
    result.walletsRestored.length === 1 ? "wallet" : "wallets";
  return (
    <div
      className="flex flex-col gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/[0.06] p-3"
      role="status"
      aria-live="polite"
      data-vex-restore-success
    >
      <p className="text-sm text-emerald-700 dark:text-emerald-400">
        Restored {result.walletsRestored.length} {walletWord} and{" "}
        {result.filesRestored.length} file
        {result.filesRestored.length === 1 ? "" : "s"} from the backup.
      </p>
      {result.walletsRestored.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {result.walletsRestored.map((wallet) => (
            <li key={wallet.id} className="flex flex-col gap-1">
              <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-text-muted)]">
                {wallet.label}
                {wallet.legacy === true ? " · legacy" : ""}
              </span>
              <AddressDisplay address={wallet.address} />
            </li>
          ))}
        </ul>
      ) : null}
      {result.vaultLocked ? (
        <p
          className="rounded-md border border-amber-500/40 bg-amber-500/[0.08] p-3 text-sm text-amber-700 dark:text-amber-400"
          role="alert"
          data-vex-restore-vault-locked
        >
          This backup&apos;s vault uses a different master password. Vex is now
          locked — unlock it again using <strong>this backup&apos;s</strong>{" "}
          master password (not your previous one) to access the restored
          wallets.
        </p>
      ) : null}
    </div>
  );
}

export function RestoreFromArchive(): JSX.Element {
  const backupsQuery = useListBackups();
  const invalidate = useInvalidateAfterArchiveRestore();

  const [expanded, setExpanded] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [passwordPresent, setPasswordPresent] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [restored, setRestored] = useState<WalletRestoreArchiveResult | null>(
    null,
  );

  const passwordRef = useRef<HTMLInputElement | null>(null);

  const wipePassword = useCallback((): void => {
    if (passwordRef.current !== null) passwordRef.current.value = "";
    setPasswordPresent(false);
  }, []);

  const onSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>): Promise<void> => {
      event.preventDefault();
      if (selectedId === null || pending) return;

      // Read the secret from the DOM once, then wipe the field synchronously
      // before the IPC promise resolves — the password never enters React
      // state or any cache.
      const password = passwordRef.current?.value ?? "";
      if (password.length === 0) return;
      wipePassword();

      setPending(true);
      setError(null);
      setRestored(null);

      try {
        const result = await restoreArchive(selectedId, password);
        if (result.ok) {
          setRestored(result.data);
          invalidate();
        } else {
          setError(
            restoreErrorMessage(result.error.code, result.error.message),
          );
        }
      } catch (cause) {
        // contextBridge throws synchronously on an unhandled invoke (e.g.
        // a missing channel). No secret has been produced — main never
        // replied successfully.
        setError(
          cause instanceof Error
            ? cause.message
            : "Unexpected error during restore.",
        );
      } finally {
        setPending(false);
      }
    },
    [selectedId, pending, wipePassword, invalidate],
  );

  if (!expanded) {
    return (
      <div className="flex flex-col gap-1" data-vex-wallet-restore="collapsed">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setExpanded(true)}
          data-vex-restore-open
        >
          Restore a full backup
        </Button>
      </div>
    );
  }

  return (
    <div
      className="flex flex-col gap-3"
      data-vex-wallet-restore="expanded"
    >
      <div className="flex items-center justify-between">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-text-muted)]">
          Restore a full backup
        </p>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            wipePassword();
            setExpanded(false);
            setSelectedId(null);
            setError(null);
            setRestored(null);
          }}
          data-vex-restore-cancel
        >
          Close
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        Restoring replaces your current wallets with the ones in the selected
        backup. Vex will ask you to confirm before replacing anything.
      </p>

      {backupsQuery.isLoading ? (
        <div
          role="status"
          aria-live="polite"
          className="flex items-center gap-2"
          data-vex-restore-loading
        >
          <div
            aria-hidden
            className="h-1 w-32 overflow-hidden rounded-full bg-white/[0.07]"
          >
            <div className="h-full w-1/3 animate-pulse bg-[var(--vex-onboarding-accent)]" />
          </div>
          <span className="text-xs text-muted-foreground">Loading backups…</span>
        </div>
      ) : null}

      {!backupsQuery.isLoading &&
      backupsQuery.data !== undefined &&
      backupsQuery.data.ok === false ? (
        <div className="flex flex-col gap-2" data-vex-restore-list-error>
          <p className="text-sm text-[var(--color-danger)]" role="alert">
            Couldn&apos;t load your backups. {backupsQuery.data.error.message}
          </p>
          <div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                void backupsQuery.refetch();
              }}
              disabled={backupsQuery.isFetching}
              data-vex-restore-retry
            >
              {backupsQuery.isFetching ? "Retrying…" : "Retry"}
            </Button>
          </div>
        </div>
      ) : null}

      {!backupsQuery.isLoading &&
      backupsQuery.data?.ok === true &&
      backupsQuery.data.data.backups.length === 0 ? (
        <p
          className="text-sm text-muted-foreground"
          role="status"
          data-vex-restore-empty
        >
          No backups yet. Backups are created automatically when you generate,
          import, or export wallets.
        </p>
      ) : null}

      {!backupsQuery.isLoading &&
      backupsQuery.data?.ok === true &&
      backupsQuery.data.data.backups.length > 0 &&
      restored === null ? (
        <form onSubmit={(event) => void onSubmit(event)} className="flex flex-col gap-4">
          <fieldset className="flex flex-col gap-2" disabled={pending}>
            <legend className="sr-only">Select a backup to restore</legend>
            <ul
              className="flex flex-col gap-2"
              role="radiogroup"
              aria-label="Available backups"
              data-vex-restore-list
            >
              {backupsQuery.data.data.backups.map((backup) => {
                const checked = selectedId === backup.id;
                return (
                  <li key={backup.id}>
                    <label
                      className="flex cursor-pointer flex-col gap-2 rounded-xl border border-white/[0.08] bg-white/[0.03] p-3 has-[:checked]:border-[var(--vex-onboarding-accent)]"
                      data-vex-restore-backup={backup.id}
                    >
                      <div className="flex items-start gap-2">
                        <input
                          type="radio"
                          name="vex-restore-backup"
                          value={backup.id}
                          checked={checked}
                          onChange={() => setSelectedId(backup.id)}
                          className="mt-1 h-4 w-4"
                          aria-label={backupCardLabel(backup)}
                        />
                        <div className="flex flex-1 flex-col gap-1">
                          <span className="text-sm text-foreground">
                            {backupCardLabel(backup)}
                          </span>
                          <div className="flex flex-wrap gap-1">
                            {backup.vaultIncluded ? (
                              <span className="rounded-sm border border-white/[0.12] px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                                vault
                              </span>
                            ) : null}
                            {backup.envIncluded ? (
                              <span className="rounded-sm border border-white/[0.12] px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                                .env
                              </span>
                            ) : null}
                          </div>
                          {backup.addresses.length > 0 ? (
                            <div className="flex flex-wrap gap-1">
                              {backup.addresses.map((address) => (
                                <AddressDisplay
                                  key={address}
                                  address={address}
                                />
                              ))}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </label>
                  </li>
                );
              })}
            </ul>

            <div className="flex flex-col gap-2">
              <Label htmlFor="vex-restore-password">Master password</Label>
              <PasswordField
                id="vex-restore-password"
                ref={passwordRef}
                autoComplete="current-password"
                onChange={(event) =>
                  setPasswordPresent(event.target.value.length > 0)
                }
                data-vex-restore-password
              />
              <p className="text-xs text-muted-foreground">
                Enter the master password for the selected backup.
              </p>
            </div>
          </fieldset>

          {error !== null ? (
            <p
              className="text-sm text-destructive"
              role="alert"
              aria-live="assertive"
              data-vex-restore-error
            >
              {error}
            </p>
          ) : null}

          <div>
            <Button
              type="submit"
              size="sm"
              disabled={selectedId === null || !passwordPresent || pending}
              data-vex-restore-submit
            >
              {pending ? "Restoring…" : "Restore"}
            </Button>
          </div>
        </form>
      ) : null}

      {restored !== null ? <RestoreSummary result={restored} /> : null}
    </div>
  );
}
