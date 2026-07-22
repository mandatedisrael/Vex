/**
 * Polymarket one-click auto-setup — master-password sudo modal (feature #7).
 *
 * Mirrors `features/wallets/ExportPrivateKeyModal` (Phase 2 feature #6):
 *  - Master password lives ONLY in the uncontrolled DOM input ref —
 *    never in React state, Zustand, TanStack cache, or props passed
 *    down. React state tracks just the boolean "is the typed value
 *    long enough to enable submit".
 *  - The IPC payload is read directly from `passwordRef.current?.value`
 *    at submit time. We wipe the input synchronously before clearing
 *    pending state so a re-render never leaves a stale secret in the
 *    DOM between attempts.
 *  - The dialog refuses backdrop dismissal (`closeOnBackdropClick={false}`)
 *    so a stray click can't cancel a destructive auth flow.
 *
 * Per the locked contract with the main process:
 *   window.vex.onboarding.polymarketAutoSetup({
 *     password, riskAcknowledged: true, overwriteConfirmed,
 *   }) → Result<PolymarketAutoSetupResult>
 *
 * Error-code mapping handled inline so this stays a single source of
 * truth for renderer copy (codex review #2 locked the strings).
 */

import {
  useCallback,
  useRef,
  useState,
  type FormEvent,
  type JSX,
} from "react";
import { PASSWORD_MIN_LENGTH } from "@shared/schemas/secrets.js";
import { getErrorCopy } from "../../../../lib/errors/error-copy.js";
import type { PolymarketAutoSetupResult } from "@shared/schemas/api-keys.js";
import { Button } from "../../../../components/ui/button.js";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../../../components/ui/dialog.js";
import { Input } from "../../../../components/ui/input.js";
import { Label } from "../../../../components/ui/label.js";

export interface PolymarketSudoModalProps {
  /**
   * EVM wallet to derive credentials for (puzzle 5 B-UI). Omitted = the
   * primary EVM wallet. Threaded straight into the IPC payload; the main
   * handler resolves it through the config inventory and is the authority.
   */
  readonly walletId?: string;
  readonly overwriteConfirmed: boolean;
  readonly onSuccess: (result: PolymarketAutoSetupResult) => void;
  readonly onClose: () => void;
  readonly onRiskConfirmationRequired: () => void;
}

/**
 * Inline lock-icon SVG — same rationale as UnlockScreen and the export
 * modal. lucide-react is not a vex-app dependency, and a single glyph
 * does not justify a 200KB icon set.
 */
function LockIcon(): JSX.Element {
  return (
    <svg
      aria-hidden
      className="h-5 w-5 text-primary"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

export function PolymarketSudoModal({
  walletId,
  overwriteConfirmed,
  onSuccess,
  onClose,
  onRiskConfirmationRequired,
}: PolymarketSudoModalProps): JSX.Element {
  // Password stays in DOM (uncontrolled). React state holds only the
  // boolean "value is long enough" — never the secret itself.
  const passwordRef = useRef<HTMLInputElement | null>(null);
  const [passwordLongEnough, setPasswordLongEnough] = useState<boolean>(false);
  const [riskAcknowledged, setRiskAcknowledged] = useState<boolean>(false);
  const [pending, setPending] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const wipePasswordField = useCallback((): void => {
    if (passwordRef.current !== null) passwordRef.current.value = "";
    setPasswordLongEnough(false);
  }, []);

  const canSubmit = riskAcknowledged && passwordLongEnough && !pending;

  const onSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>): Promise<void> => {
      event.preventDefault();
      if (!canSubmit) return;

      // Snapshot the secret out of the DOM and wipe synchronously so a
      // re-render between here and the await can never observe it.
      const password = passwordRef.current?.value ?? "";
      wipePasswordField();
      setPending(true);
      setError(null);

      try {
        const result = await window.vex.onboarding.polymarketAutoSetup({
          password,
          riskAcknowledged: true,
          overwriteConfirmed,
          // Only include `walletId` when a non-primary wallet is selected so
          // the primary path keeps the exact pre-B-UI payload shape.
          ...(walletId !== undefined ? { walletId } : {}),
        });

        if (!result.ok) {
          // Workflow-control branch: a race between the renderer's
          // overwriteConfirmed state and the main-side recheck can produce
          // this code. Bubble up to the parent so it re-opens the confirm
          // modal. We do NOT call onClose here — onRiskConfirmationRequired
          // moves the parent off the submitting phase, and calling both
          // would race-overwrite the new phase to idle.
          if (result.error.code === "wallet.risk_confirmation_required") {
            onRiskConfirmationRequired();
            return;
          }
          // Pure copy-mapping for every other code goes through the helper.
          // `wallet.keystore_missing` here is EVM-specific because the
          // Polymarket auto-setup signs with the EVM wallet keystore.
          const copy = getErrorCopy(result.error, { chain: "evm" });
          setError(copy.message);
          return;
        }

        onSuccess(result.data);
        onClose();
      } catch (cause) {
        // contextBridge synchronous throws (missing channel etc.) —
        // treat as unknown failure. No secret was produced because main
        // never returned successfully.
        const message =
          cause instanceof Error
            ? cause.message
            : "Unexpected error during Polymarket auto-setup.";
        setError(message);
      } finally {
        setPending(false);
      }
    },
    [
      canSubmit,
      onClose,
      onRiskConfirmationRequired,
      onSuccess,
      overwriteConfirmed,
      walletId,
      wipePasswordField,
    ],
  );

  const onCancel = useCallback((): void => {
    onClose();
  }, [onClose]);

  return (
    <Dialog
      open={true}
      onOpenChange={(next) => {
        // Native ESC still fires onOpenChange(false). Backdrop is
        // disabled via closeOnBackdropClick={false}. Programmatic
        // close (ESC) routes through onClose.
        if (!next) onClose();
      }}
    >
      <DialogContent
        closeOnBackdropClick={false}
        data-vex-polymarket-sudo="root"
      >
        <DialogHeader>
          <div className="flex items-center gap-2">
            <LockIcon />
            <DialogTitle>Configure Polymarket</DialogTitle>
          </div>
        </DialogHeader>

        <DialogBody>
          <form
            id="vex-polymarket-sudo-form"
            onSubmit={(event) => {
              void onSubmit(event);
            }}
            className="flex flex-col gap-4"
          >
            <p
              className="border-l-2 border-[color-mix(in_oklab,var(--color-warning)_45%,transparent)] py-1 pl-3 text-sm text-foreground"
              role="alert"
            >
              Vex will use your EVM wallet to sign a Polymarket
              authentication request, retrieve an API key, secret, and
              passphrase, and save them to the encrypted vault. The
              credentials will NOT be displayed on screen or copied to the
              clipboard. Enter your master password to authorize this
              operation.
            </p>

            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={riskAcknowledged}
                onChange={(event) => setRiskAcknowledged(event.target.checked)}
                disabled={pending}
                className="mt-0.5 h-4 w-4 rounded accent-[var(--color-accent-primary)]"
                data-vex-polymarket-sudo-ack
              />
              <span>I understand and accept the risks</span>
            </label>

            <div className="flex flex-col gap-2">
              <Label htmlFor="vex-polymarket-sudo-password">
                Master password
              </Label>
              <Input
                id="vex-polymarket-sudo-password"
                ref={passwordRef}
                type="password"
                autoComplete="current-password"
                onChange={(event) =>
                  setPasswordLongEnough(
                    event.target.value.length >= PASSWORD_MIN_LENGTH,
                  )
                }
                disabled={pending}
                data-vex-polymarket-sudo-password
              />
            </div>

            {error !== null ? (
              <p
                className="text-sm text-[var(--color-danger)]"
                role="alert"
                data-vex-polymarket-sudo-error
              >
                {error}
              </p>
            ) : null}
          </form>
        </DialogBody>

        <DialogFooter>
          <Button
            type="button"
            variant="secondary"
            onClick={onCancel}
            disabled={pending}
            data-vex-polymarket-sudo-cancel
          >
            Cancel
          </Button>
          <Button
            type="submit"
            form="vex-polymarket-sudo-form"
            disabled={!canSubmit}
            data-vex-polymarket-sudo-submit
          >
            {pending ? "Configuring…" : "Configure Polymarket"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
