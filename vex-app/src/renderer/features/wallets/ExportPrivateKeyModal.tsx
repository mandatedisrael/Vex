/**
 * Export private key modal (M-Reconfigure feature #6).
 *
 * High-risk operation: the user types the master password, main decrypts the
 * keystore, normalises the private-key material, and (per Stage 1-3 design)
 * writes the raw key to the OS clipboard then schedules a best-effort
 * clipboard scrub. The renderer NEVER sees the raw key — neither in props,
 * state, Zustand, TanStack cache, nor event payloads. The master password
 * is kept ONLY in the uncontrolled DOM input (`passwordRef`), read once on
 * submit, and the field is wiped immediately after. React state tracks only
 * whether the password meets the length threshold (a boolean, not the value).
 *
 * UX phases:
 *   - "idle":    form (password + ack checkbox)
 *   - "copied":  "copied — clipboard scrub in {N}s"
 *   - "cleared": "clipboard scrub attempted — closing"
 *   - "closing": transitional 0-frame state right before `onClose()`
 *
 * Error handling: domain-specific copy for the 5 expected error codes
 * (`wallet.password_invalid`, `wallet.export_throttled`,
 *  `wallet.keystore_locked`, `wallet.keystore_missing`, `wallet.keystore_corrupt`).
 * Unknown codes fall back to the public error message returned by main.
 *
 * Throttle handling reads `error.retryAfterMs` directly off the VexError
 * (set by Stage 3 main throttle policy — same pattern as the UnlockScreen
 * `secrets.unlock_throttled` flow).
 *
 * Session-lock path: when the wallet operation runs while the in-memory
 * vault is locked (e.g. inactivity timer fired between mount + submit),
 * main returns `wallet.keystore_locked`. We render the explanation and
 * auto-close so the user lands on the global unlock screen — the global
 * lock observer in `UnlockScreen` / `uiStore` then takes over.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type JSX,
} from "react";
import { PASSWORD_MIN_LENGTH } from "@shared/schemas/secrets.js";
import { getErrorCopy } from "../../lib/errors/error-copy.js";
import { Button } from "../../components/ui/button.js";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog.js";
import { Input } from "../../components/ui/input.js";
import { Label } from "../../components/ui/label.js";

type Chain = "evm" | "solana";

type Phase = "idle" | "copied" | "cleared" | "closing";

export interface ExportPrivateKeyModalProps {
  readonly chain: Chain;
  readonly walletAddress: string;
  readonly onClose: () => void;
}

/**
 * Inline lock SVG — same rationale as UnlockScreen.LockIcon: lucide-react is
 * not a vex-app dependency, and pulling a 200KB icon set for a single glyph
 * is not justified.
 */
function LockIcon(): JSX.Element {
  return (
    <svg
      aria-hidden
      className="h-5 w-5 text-destructive"
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

const CHAIN_LABEL: Record<Chain, string> = {
  evm: "EVM",
  solana: "Solana",
};

const ADDR_PREFIX_LEN = 6;
const ADDR_SUFFIX_LEN = 4;

function truncateAddress(addr: string): string {
  if (addr.length <= ADDR_PREFIX_LEN + ADDR_SUFFIX_LEN + 1) return addr;
  return `${addr.slice(0, ADDR_PREFIX_LEN)}…${addr.slice(-ADDR_SUFFIX_LEN)}`;
}

/**
 * Auto-close delay (ms) once the clipboard-scrub countdown has elapsed and
 * before invoking `onClose()`. Gives the user time to read the
 * confirmation banner.
 */
const POST_CLEAR_AUTOCLOSE_MS = 3000;
/**
 * Auto-close delay (ms) for session-lock recovery. Same idea as the
 * post-clear close — the user reads the explanation, then we close so the
 * global unlock observer can take over.
 */
const SESSION_LOCK_AUTOCLOSE_MS = 3000;

export function ExportPrivateKeyModal({
  chain,
  walletAddress,
  onClose,
}: ExportPrivateKeyModalProps): JSX.Element {
  // Password stays in the DOM (uncontrolled input). React state only tracks
  // the boolean "is current value long enough to enable submit" — the secret
  // value itself never lives in a React fiber.
  const passwordRef = useRef<HTMLInputElement | null>(null);
  const [passwordLongEnough, setPasswordLongEnough] = useState<boolean>(false);
  const [riskAcknowledged, setRiskAcknowledged] = useState<boolean>(false);
  const [pending, setPending] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [clearCountdown, setClearCountdown] = useState<number>(0);

  // Ref-based reentry guard so the auto-close `setTimeout` callbacks never
  // call `onClose` twice (StrictMode double-mount, fast user double-click).
  const closedRef = useRef<boolean>(false);
  // Track whether a session-lock auto-close is already scheduled so a
  // re-render or a re-submission can't queue a second close.
  const lockAutoCloseScheduledRef = useRef<boolean>(false);
  // Timer id for the session-lock auto-close, so we can cancel it on unmount.
  const lockAutoCloseTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);

  const wipePasswordField = useCallback((): void => {
    if (passwordRef.current !== null) passwordRef.current.value = "";
    setPasswordLongEnough(false);
  }, []);

  const safeClose = useCallback((): void => {
    if (closedRef.current) return;
    closedRef.current = true;
    onClose();
  }, [onClose]);

  // Countdown timer: ticks once per second while phase === "copied".
  // Stops when the countdown reaches 0 and transitions to "cleared".
  useEffect(() => {
    if (phase !== "copied") return;
    if (clearCountdown <= 0) {
      setPhase("cleared");
      return;
    }
    const id = window.setInterval(() => {
      setClearCountdown((prev) => {
        const next = prev - 1;
        if (next <= 0) {
          window.clearInterval(id);
          setPhase("cleared");
          return 0;
        }
        return next;
      });
    }, 1000);
    return () => {
      window.clearInterval(id);
    };
  }, [phase, clearCountdown]);

  // Post-clear auto-close: schedule the dialog dismiss once the scrub
  // banner has been on screen long enough to read.
  useEffect(() => {
    if (phase !== "cleared") return;
    const id = window.setTimeout(() => {
      setPhase("closing");
      safeClose();
    }, POST_CLEAR_AUTOCLOSE_MS);
    return () => {
      window.clearTimeout(id);
    };
  }, [phase, safeClose]);

  // Final cleanup — guarantees no late `onClose` fires after unmount and
  // cancels any in-flight session-lock auto-close timer.
  useEffect(() => {
    return () => {
      closedRef.current = true;
      if (lockAutoCloseTimerRef.current !== null) {
        window.clearTimeout(lockAutoCloseTimerRef.current);
        lockAutoCloseTimerRef.current = null;
      }
    };
  }, []);

  const scheduleSessionLockAutoClose = useCallback((): void => {
    if (lockAutoCloseScheduledRef.current) return;
    lockAutoCloseScheduledRef.current = true;
    lockAutoCloseTimerRef.current = window.setTimeout(() => {
      lockAutoCloseTimerRef.current = null;
      safeClose();
    }, SESSION_LOCK_AUTOCLOSE_MS);
  }, [safeClose]);

  const canSubmit =
    phase === "idle" && riskAcknowledged && passwordLongEnough && !pending;

  const onSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>): Promise<void> => {
      event.preventDefault();
      if (!canSubmit) return;

      setPending(true);
      setError(null);

      try {
        const result = await window.vex.wallet.exportPrivateKey({
          chain,
          password: passwordRef.current?.value ?? "",
          riskAcknowledged: true,
        });

        if (!result.ok) {
          // Always scrub the password input on a failed attempt: the user
          // will re-type, and we don't want even the briefest stale value
          // sitting in the DOM between attempts.
          wipePasswordField();

          const copy = getErrorCopy(result.error, { chain });
          setError(copy.message);
          // Helper signals that this error should auto-route the user back
          // to the global unlock screen — schedule the modal dismiss.
          if (copy.autoCloseMs !== undefined) {
            scheduleSessionLockAutoClose();
          }
          return;
        }

        // Success path — main has already copied the key to the OS
        // clipboard. We never see the secret. Render the scrub countdown.
        const clearMs = result.data.clearAfterMs;
        const clearSec = Math.max(1, Math.ceil(clearMs / 1000));
        wipePasswordField();
        setClearCountdown(clearSec);
        setPhase("copied");
      } catch (cause) {
        // contextBridge throws synchronously on unhandled invoke (e.g.
        // missing channel). Treat as an unknown internal failure — no
        // secret has been produced because main never replied successfully.
        const message =
          cause instanceof Error
            ? cause.message
            : "Unexpected error during private key export.";
        wipePasswordField();
        setError(message);
      } finally {
        setPending(false);
      }
    },
    [canSubmit, chain, scheduleSessionLockAutoClose, wipePasswordField],
  );

  const onCancel = useCallback((): void => {
    safeClose();
  }, [safeClose]);

  const dialogOpen = phase !== "closing";

  return (
    <Dialog open={dialogOpen} onOpenChange={(next) => {
      // Native dialog ESC / backdrop are disabled (closeOnBackdropClick=false)
      // but the dialog still fires onOpenChange(false) on programmatic close.
      // Only treat a true "open" intent as a no-op; we own the close path.
      if (!next) {
        safeClose();
      }
    }}>
      <DialogContent
        closeOnBackdropClick={false}
        data-vex-export-private-key={chain}
      >
        <DialogHeader>
          <div className="flex items-center gap-2">
            <LockIcon />
            <DialogTitle>
              Export private key — {CHAIN_LABEL[chain]}
            </DialogTitle>
          </div>
          <p className="text-xs text-muted-foreground">
            Exporting {CHAIN_LABEL[chain]} key for{" "}
            <code className="font-mono">{truncateAddress(walletAddress)}</code>
          </p>
        </DialogHeader>

        <DialogBody>
          {phase === "idle" ? (
            <form
              id="vex-export-private-key-form"
              onSubmit={(event) => {
                void onSubmit(event);
              }}
              className="flex flex-col gap-4"
            >
              <p
                className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"
                role="alert"
              >
                Your private key will be copied to the system clipboard. Vex{" "}
                <strong>will attempt</strong> to clear the clipboard after 10
                seconds, but this is best-effort — a crash or power loss may
                prevent cleanup. Anyone with access to this computer during
                that window can read the key. Do not paste it into untrusted
                applications. The key will NOT be shown on screen.
              </p>

              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={riskAcknowledged}
                  onChange={(event) => setRiskAcknowledged(event.target.checked)}
                  disabled={pending}
                  className="mt-0.5 h-4 w-4 rounded border-input"
                  data-vex-export-ack
                />
                <span>I understand and accept the risks</span>
              </label>

              <div className="flex flex-col gap-2">
                <Label htmlFor="vex-export-private-key-password">
                  Master password
                </Label>
                <Input
                  id="vex-export-private-key-password"
                  ref={passwordRef}
                  type="password"
                  autoComplete="current-password"
                  onChange={(event) =>
                    setPasswordLongEnough(
                      event.target.value.length >= PASSWORD_MIN_LENGTH,
                    )
                  }
                  disabled={pending}
                  data-vex-export-password
                />
              </div>

              {error !== null ? (
                <p
                  className="text-sm text-destructive"
                  role="alert"
                  data-vex-export-error
                >
                  {error}
                </p>
              ) : null}
            </form>
          ) : null}

          {phase === "copied" ? (
            <p
              className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm text-amber-700 dark:text-amber-400"
              role="status"
              data-vex-export-status="copied"
            >
              Copied. Clipboard will be scrubbed in {clearCountdown}s.
            </p>
          ) : null}

          {phase === "cleared" || phase === "closing" ? (
            <p
              className="rounded-md border border-emerald-500/40 bg-emerald-500/5 p-3 text-sm text-emerald-700 dark:text-emerald-400"
              role="status"
              data-vex-export-status="cleared"
            >
              Vex attempted to scrub the clipboard. This window will close shortly.
            </p>
          ) : null}
        </DialogBody>

        <DialogFooter>
          <Button
            type="button"
            variant="secondary"
            onClick={onCancel}
            disabled={pending}
            data-vex-export-cancel
          >
            Cancel
          </Button>
          {phase === "idle" ? (
            <Button
              type="submit"
              form="vex-export-private-key-form"
              disabled={!canSubmit}
              data-vex-export-submit
            >
              {pending ? "Copying…" : "Copy to clipboard"}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
