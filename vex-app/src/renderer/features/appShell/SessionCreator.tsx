/**
 * "New Session" dialog. Owns the local form state and submits via
 * `useCreateSession()`. On success the new session is selected
 * automatically (`uiStore.setActiveSessionId`) so the panel opens
 * straight onto it.
 *
 * Form invariants mirror the IPC schema discriminated union:
 *   - mode + permission are immutable session axes
 *   - mission goal text is captured by the first chat submit, not here
 * The submit button stays disabled when the form is invalid.
 *
 * Presentational pieces (option catalogues, the `deriveSessionName` seed
 * helper, the `RadioCard`, and the form sections) live under
 * `./SessionCreator/` so this module keeps only the dialog shell + state
 * ownership.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { JSX } from "react";
import {
  type SessionCreateInput,
  type SessionMode,
  type SessionPermission,
} from "@shared/schemas/sessions.js";
import { Button } from "../../components/ui/button.js";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog.js";
import { useCreateSession } from "../../lib/api/sessions.js";
import { useAvailableWallets } from "../../lib/api/session-wallets.js";
import { useUiStore } from "../../stores/uiStore.js";
import { deriveSessionName } from "./SessionCreator/deriveSessionName.js";
import {
  ModeFieldset,
  NameField,
  PermissionFieldset,
  SubmitError,
  WalletFieldset,
} from "./SessionCreator/FormSections.js";

interface SessionCreatorProps {
  readonly open: boolean;
  readonly onOpenChange: (next: boolean) => void;
}

export function SessionCreator({
  open,
  onOpenChange,
}: SessionCreatorProps): JSX.Element {
  const setActiveSessionId = useUiStore((s) => s.setActiveSessionId);
  const createSessionInitialMessage = useUiStore(
    (s) => s.createSessionInitialMessage,
  );
  const setPendingFirstMessage = useUiStore((s) => s.setPendingFirstMessage);
  const setSigningState = useUiStore((s) => s.setSigningState);
  const createMutation = useCreateSession();
  const availableWallets = useAvailableWallets();
  const inventory =
    availableWallets.data?.ok === true
      ? availableWallets.data.data
      : { evm: [], solana: [] };

  const [name, setName] = useState<string>("");
  const [mode, setMode] = useState<SessionMode>("agent");
  const [permission, setPermission] = useState<SessionPermission>("restricted");
  const [selectedEvmWalletId, setSelectedEvmWalletId] = useState<string | null>(null);
  const [selectedSolanaWalletId, setSelectedSolanaWalletId] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement | null>(null);

  // Reset state on every (re)open so the next opening starts clean.
  useEffect(() => {
    if (open) {
      setName(
        createSessionInitialMessage !== null
          ? deriveSessionName(createSessionInitialMessage)
          : "",
      );
      setMode("agent");
      setPermission("restricted");
      setSelectedEvmWalletId(null);
      setSelectedSolanaWalletId(null);
      setSubmitError(null);
    }
  }, [open, createSessionInitialMessage]);

  // Focus the Name input first when the dialog opens — it is the only
  // text field in this modal. Mission goal capture happens in chat.
  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => {
      nameRef.current?.focus();
    });
    return () => cancelAnimationFrame(id);
  }, [open]);

  const trimmedName = name.trim();
  const nameInvalid = trimmedName.length === 0;
  const submitDisabled = nameInvalid || createMutation.isPending;

  const onSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
      event.preventDefault();
      if (submitDisabled) return;
      setSubmitError(null);
      const input: SessionCreateInput =
        mode === "mission"
          ? { mode: "mission", name: trimmedName, permission, selectedEvmWalletId, selectedSolanaWalletId }
          : { mode: "agent", name: trimmedName, permission, selectedEvmWalletId, selectedSolanaWalletId };
      // The sidebar's New-session key mirrors this mutation: ink loop while
      // in flight, one-shot glint on success (the glint's animationend
      // returns the state to idle). The try/catch exists only so an
      // unexpected mutateAsync throw can never leave the stroke looping
      // forever — IPC normally resolves with a Result, never throws.
      setSigningState("signing");
      try {
        const outcome = await createMutation.mutateAsync(input);
        if (!outcome.ok) {
          setSigningState("idle");
          setSubmitError(outcome.error.message);
          return;
        }
        setSigningState("signed");
        // Hand the welcome-typed first message to the new session's composer,
        // which owns the actual chat.submit (+ failure/preserve UX). Set the
        // hand-off BEFORE activating so the composer's consume-effect sees it on
        // mount; `closeCreateSession` (via onOpenChange) clears only modal state,
        // never this hand-off.
        if (createSessionInitialMessage !== null) {
          setPendingFirstMessage({
            sessionId: outcome.data.id,
            message: createSessionInitialMessage,
          });
        }
        setActiveSessionId(outcome.data.id);
        onOpenChange(false);
      } catch (error: unknown) {
        setSigningState("idle");
        throw error;
      }
    },
    [
      createMutation,
      createSessionInitialMessage,
      mode,
      onOpenChange,
      permission,
      selectedEvmWalletId,
      selectedSolanaWalletId,
      setActiveSessionId,
      setPendingFirstMessage,
      setSigningState,
      submitDisabled,
      trimmedName,
    ],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl rounded-xl border-[var(--vex-line-strong)] bg-[var(--vex-surface-2)] text-foreground shadow-none backdrop:bg-black/70 backdrop:backdrop-blur-none">
        <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col">
          <DialogHeader className="border-[var(--vex-line)]">
            <DialogTitle className="font-mono text-[13px] font-medium uppercase tracking-[0.3em]">
              New session
            </DialogTitle>
            {/* Ceremony subline — the retired welcome headline, read once
             * per new act (where ceremony belongs). */}
            <p className="text-xs text-[var(--vex-text-2)]">
              Your chain. Your rules. I execute.
            </p>
            <DialogDescription className="text-[var(--vex-text-3)]">
              Choose how the session behaves. Mode and permission are
              locked once the session is created.
            </DialogDescription>
          </DialogHeader>

          <DialogBody className="gap-5">
            <NameField name={name} onNameChange={setName} nameRef={nameRef} />

            <ModeFieldset mode={mode} onModeChange={setMode} />

            <PermissionFieldset
              permission={permission}
              onPermissionChange={setPermission}
            />

            <WalletFieldset
              selectedEvmWalletId={selectedEvmWalletId}
              selectedSolanaWalletId={selectedSolanaWalletId}
              evmOptions={inventory.evm}
              solanaOptions={inventory.solana}
              onEvmChange={setSelectedEvmWalletId}
              onSolanaChange={setSelectedSolanaWalletId}
            />

            <SubmitError submitError={submitError} />
          </DialogBody>

          <DialogFooter className="border-[var(--vex-line)]">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={createMutation.isPending}
              className="text-[var(--vex-text-2)] hover:bg-white/[0.06] hover:text-foreground"
            >
              Cancel
            </Button>
            {/* Key form, not a filled pill — disabled dimming rides the
             * tokens, never an opacity stack. */}
            <Button
              type="submit"
              disabled={submitDisabled}
              className="h-10 rounded-lg border border-[var(--vex-accent-border)] bg-transparent font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--vex-accent-text)] hover:border-[var(--vex-accent-border-strong)] hover:bg-[var(--vex-accent-fill-8)] disabled:border-[var(--vex-line-strong)] disabled:text-[var(--vex-text-3)] disabled:opacity-100"
            >
              {createMutation.isPending ? "Creating…" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
