/**
 * UnlockScreen — THE GATE. Master-password re-prompt shown when the
 * vault is configured but locked (typical cause: app restart after
 * onboarding).
 *
 * Redesigned as a full-canvas hero-dark moment in the landing register
 * (projectvex.ai): no floating card — the whole viewport is the gate.
 *   - Canvas: onboarding ink + a faint deep-cobalt dawn scrim at the top
 *     edge (the landing hero scrim, whisper strength), the landing hero's
 *     64px hairline grid under a radial mask, then the machine artifacts
 *     (.vex-scanlines + .vex-noise) — all aria-hidden paint layers.
 *   - Center column: white wordmark → centered eyebrow "MASTER VAULT ·
 *     SEALED" → Archivo display headline → one-line subline → the form.
 *   - Form: mono micro-label (landing .wl-form grammar), wide h-11
 *     password field with show/hide, a signature rail under the field
 *     that runs the .vex-sign-stroke ink loop ONLY while the unlock IPC
 *     is in flight, then a full-width filled cobalt pill.
 *   - Corner chrome: hallmark + VEX/UNLOCK (top-left), live gate status
 *     readout (top-right — pulses only while pending), brand tetrad +
 *     barcode (bottom-left), version (bottom-right).
 *
 * Functional logic (unchanged from the previous version):
 *   - password ref is uncontrolled (skill §14 — secret never lands in
 *     observable React state),
 *   - PASSWORD_MIN_LENGTH client-side gate before IPC,
 *   - `secrets.unlock_throttled` surfaces an alert + 1s setInterval
 *     countdown; cleaned up on every state change,
 *   - on success the password input is cleared and `setCurrentView`
 *     routes back to `unlockReturnView` ("wizard" | "appShell").
 *
 * Test selectors preserved verbatim:
 *   - `data-vex-screen="unlock"` + `data-vex-onboarding="true"` (root),
 *   - `data-vex-unlock-throttle="active"` (throttle alert),
 *   - `<label htmlFor="vex-unlock-password">Master password</label>`,
 *   - button text "Unlock" / "Unlocking…",
 *   - `img[src="/logo_clean.png"]` hallmark.
 */

import { useEffect, useRef, useState, type FormEvent, type JSX } from "react";
import { Button } from "../../components/ui/button.js";
import { Label } from "../../components/ui/label.js";
import { PasswordField } from "../../components/common/PasswordField.js";
import { useUiStore } from "../../stores/uiStore.js";
import { PASSWORD_MIN_LENGTH } from "@shared/schemas/secrets.js";
import { getErrorCopy } from "../../lib/errors/error-copy.js";
import { cn } from "../../lib/utils.js";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog.js";
import { OpenLogsLink } from "../../components/common/OpenLogsLink.js";

interface ThrottleState {
  readonly message: string;
  readonly retryAtMs: number;
}

export function UnlockScreen(): JSX.Element {
  const passwordRef = useRef<HTMLInputElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorFromBridge, setErrorFromBridge] = useState(false);
  const [pending, setPending] = useState(false);
  const [throttle, setThrottle] = useState<ThrottleState | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [resetOpen, setResetOpen] = useState(false);
  const [resetAcknowledged, setResetAcknowledged] = useState(false);
  const [resetPending, setResetPending] = useState(false);
  const [resetRestarting, setResetRestarting] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const returnView = useUiStore((s) => s.unlockReturnView);
  const setCurrentView = useUiStore((s) => s.setCurrentView);

  // Tick once a second while a throttle window is active so the countdown
  // re-renders. Cleared on every state change — no leaked intervals.
  useEffect(() => {
    if (throttle === null) return;
    if (throttle.retryAtMs <= Date.now()) {
      setThrottle(null);
      return;
    }
    const id = window.setInterval(() => {
      const current = Date.now();
      setNow(current);
      if (current >= throttle.retryAtMs) {
        window.clearInterval(id);
        setThrottle(null);
      }
    }, 1000);
    return () => {
      window.clearInterval(id);
    };
  }, [throttle]);

  const throttleRemainingMs =
    throttle !== null ? Math.max(0, throttle.retryAtMs - now) : 0;
  const throttleRemainingSeconds = Math.ceil(throttleRemainingMs / 1000);
  const throttleActive = throttle !== null && throttleRemainingMs > 0;
  const inputsDisabled = pending || throttleActive;

  // Gate readout for the top-right corner — bound to real state only:
  // OPENING while the unlock IPC is in flight, HELD during a throttle
  // window, SEALED at rest.
  const gateStatus = pending ? "Opening" : throttleActive ? "Held" : "Sealed";

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (throttleActive) return;
    const password = passwordRef.current?.value ?? "";
    if (password.length < PASSWORD_MIN_LENGTH) {
      setError(`Password must be at least ${PASSWORD_MIN_LENGTH} characters.`);
      setErrorFromBridge(false);
      return;
    }

    setPending(true);
    setError(null);
    setErrorFromBridge(false);
    try {
      const result = await window.vex.secrets.unlock({ password });
      if (!result.ok) {
        if (
          result.error.code === "secrets.unlock_throttled"
          && typeof result.error.retryAfterMs === "number"
          && result.error.retryAfterMs >= 0
        ) {
          // Workflow-specific UX (countdown banner) — message comes
          // from the shared copy helper so the wording stays
          // consistent with other throttle surfaces (export,
          // polymarket).
          const copy = getErrorCopy(result.error);
          setThrottle({
            message: copy.message,
            retryAtMs: Date.now() + result.error.retryAfterMs,
          });
          setNow(Date.now());
          setError(null);
          return;
        }
        setError(getErrorCopy(result.error).message);
        setErrorFromBridge(true);
        return;
      }
      if (passwordRef.current) passwordRef.current.value = "";
      setCurrentView(returnView);
    } finally {
      setPending(false);
    }
  }

  function setResetDialogOpen(open: boolean): void {
    if (resetPending || resetRestarting) return;
    setResetOpen(open);
    if (!open) {
      setResetAcknowledged(false);
      setResetError(null);
    }
  }

  async function requestFreshVault(): Promise<void> {
    if (!resetAcknowledged || resetPending) return;
    setResetPending(true);
    setResetError(null);
    try {
      const result = await window.vex.secrets.resetToFreshVault({ confirm: true });
      if (!result.ok) {
        if (result.error.code !== "internal.cancelled") {
          setResetError(getErrorCopy(result.error).message);
        }
        return;
      }
      setResetRestarting(true);
    } finally {
      setResetPending(false);
    }
  }

  return (
    <main
      data-vex-onboarding="true"
      data-vex-screen="unlock"
      className="relative flex h-screen w-screen items-center justify-center overflow-hidden bg-[var(--vex-onboarding-bg)] px-6 py-16 text-[var(--color-text-primary)]"
    >
      {/* CANVAS — hero-dark register, back to front: a deep-cobalt dawn
        scrim on the top edge (the landing hero scrim at whisper
        strength), the hero's 64px hairline grid dissolved by a radial
        mask, then scanlines + grain. Paint layers only. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(90%_60%_at_50%_-12%,color-mix(in_oklab,var(--color-accent-deep)_35%,transparent),transparent_70%)]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[repeating-linear-gradient(0deg,rgba(255,255,255,0.06)_0_1px,transparent_1px_64px),repeating-linear-gradient(90deg,rgba(255,255,255,0.06)_0_1px,transparent_1px_64px)] opacity-70 [mask-image:radial-gradient(120%_90%_at_50%_38%,black_0%,transparent_74%)]"
      />
      <div aria-hidden className="vex-scanlines absolute inset-0" />
      <div aria-hidden className="vex-noise absolute inset-0" />

      {/* CORNER CHROME — four quiet instruments framing the gate.
        Top-left: hallmark + wordmark tag (shared onboarding voice). */}
      <div className="pointer-events-none absolute left-6 top-6 z-10 flex items-center gap-3">
        <img
          src="/logo_clean.png"
          alt=""
          aria-hidden
          draggable={false}
          className="h-9 w-9 object-contain opacity-90"
        />
        <div className="flex flex-col leading-tight">
          <span className="font-mono text-sm font-semibold tracking-[0.3em] text-[var(--color-text-primary)]">
            VEX
          </span>
          <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-[var(--color-text-muted)]">
            Unlock
          </span>
        </div>
      </div>

      {/* Top-right: live gate readout. The dot pulses ONLY while the
        unlock IPC is in flight (motion law: loops bind to real work). */}
      <div className="pointer-events-none absolute right-6 top-8 z-10 flex items-center gap-2.5">
        <span
          aria-hidden
          className={cn(
            "h-1.5 w-1.5 rounded-full",
            pending
              ? "vex-pulse-dot bg-[var(--color-accent-primary)]"
              : throttleActive
                ? "bg-[var(--color-warning)]"
                : "bg-[var(--color-text-muted)]",
          )}
        />
        <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-[var(--color-text-muted)]">
          Gate · {gateStatus}
        </span>
      </div>

      {/* Bottom-left: barcode artifact + brand tetrad. */}
      <div className="pointer-events-none absolute bottom-7 left-10 z-10 flex flex-col gap-2 text-[var(--color-text-muted)]">
        <span aria-hidden className="vex-barcode h-2.5 w-16 opacity-30" />
        <span className="font-mono text-[10px] uppercase tracking-[0.4em] opacity-60">
          Clarity · Focus · Understand · Evolve
        </span>
      </div>

      {/* Bottom-right: version. */}
      <span className="pointer-events-none absolute bottom-7 right-10 z-10 font-mono text-[10px] uppercase tracking-[0.3em] text-[var(--color-text-muted)] opacity-60">
        v{__VEX_APP_VERSION__}
      </span>

      {/* THE GATE COLUMN — wordmark, sealed eyebrow, display headline,
        subline, form. No panel: the canvas itself is the surface. */}
      <section
        aria-labelledby="vex-unlock-title"
        className="relative z-10 flex w-full max-w-[440px] flex-col"
      >
        <img
          src="/vex-wordmark.png"
          alt=""
          aria-hidden
          draggable={false}
          className="mx-auto h-11 w-auto object-contain"
        />

        {/* Eyebrow — .vex-eyebrow carries the leading rule; a mirrored
          trailing dash (inherits currentColor + the class's 10px gap)
          keeps the centered composition symmetric. */}
        <div className="mt-8 flex justify-center">
          <span className="vex-eyebrow">
            Master Vault · Sealed
            <span aria-hidden className="h-px w-7 bg-current opacity-70" />
          </span>
        </div>

        <h1
          id="vex-unlock-title"
          className="mt-5 text-center font-display text-[30px] font-bold leading-none tracking-[-0.02em] text-[var(--color-text-primary)]"
        >
          Unlock Vex
        </h1>
        <p className="mt-3 text-center text-[13px] leading-relaxed text-[var(--color-text-secondary)]">
          Your master password decrypts the local vault on this machine.
        </p>

        <form
          onSubmit={(event) => {
            void onSubmit(event);
          }}
          className="mt-9 flex flex-col gap-4"
        >
          <div className="flex flex-col gap-2.5">
            <Label
              htmlFor="vex-unlock-password"
              className="font-mono text-[10px] font-medium uppercase tracking-[0.22em] text-[var(--color-text-muted)]"
            >
              Master password
            </Label>
            <PasswordField
              id="vex-unlock-password"
              ref={passwordRef}
              autoComplete="current-password"
              autoFocus
              disabled={inputsDisabled}
              className="[&_input]:h-11"
            />
            {/* SIGNATURE RAIL — resting hairline under the field; while
              the unlock IPC is in flight the cobalt ink travels it
              (.vex-sign-stroke--signing, the shell's signing loop). */}
            <div
              aria-hidden
              className="relative h-px w-full overflow-hidden bg-white/[0.06]"
            >
              <span
                className={cn(
                  "vex-sign-stroke absolute inset-0 bg-[var(--vex-onboarding-accent)]",
                  pending && "vex-sign-stroke--signing",
                )}
              />
            </div>
          </div>

          {throttleActive ? (
            <div className="flex flex-col gap-2">
              <p
                role="alert"
                data-vex-unlock-throttle="active"
                className="rounded-md border border-[color-mix(in_oklab,var(--color-warning)_35%,transparent)] bg-[color-mix(in_oklab,var(--color-warning)_10%,transparent)] px-3.5 py-2.5 text-[13px] text-[color-mix(in_oklab,var(--color-warning)_70%,white)]"
              >
                {throttle.message}{" "}
                <span className="font-mono text-xs tabular-nums">
                  ({throttleRemainingSeconds}s)
                </span>
              </p>
              <OpenLogsLink />
            </div>
          ) : error ? (
            <div className="flex flex-col gap-2">
              <p
                role="alert"
                className="rounded-md border border-[color-mix(in_oklab,var(--color-danger)_35%,transparent)] bg-[color-mix(in_oklab,var(--color-danger)_10%,transparent)] px-3.5 py-2.5 text-[13px] text-[color-mix(in_oklab,var(--color-danger)_70%,white)]"
              >
                {error}
              </p>
              {errorFromBridge ? <OpenLogsLink /> : null}
            </div>
          ) : null}

          <Button
            type="submit"
            size="lg"
            disabled={inputsDisabled}
            className="w-full"
          >
            {pending ? (
              "Unlocking…"
            ) : (
              <>
                Unlock
                <span aria-hidden>→</span>
              </>
            )}
          </Button>
        </form>

        <Button
          type="button"
          variant="ghost"
          disabled={inputsDisabled}
          onClick={() => setResetDialogOpen(true)}
          className="mt-4 w-full text-[var(--color-text-muted)]"
        >
          I forgot my password — set up a new vault
        </Button>

        {/* SPEC LINE — hairline meta row, landing hero-meta grammar.
          Right side reads the real return route (wizard vs desk). */}
        <div className="mt-7 flex items-center justify-between border-t border-white/[0.06] pt-3 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-text-muted)]">
          <span>Store · Local vault</span>
          <span>Resumes · {returnView === "wizard" ? "Setup" : "Desk"}</span>
        </div>
      </section>
      <Dialog open={resetOpen} onOpenChange={setResetDialogOpen}>
        <DialogContent closeOnBackdropClick={false}>
          <DialogHeader>
            <DialogTitle>Set up a new vault?</DialogTitle>
            <DialogDescription>
              This does not recover or decrypt the current vault.
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            {resetRestarting ? (
              <p role="status">Restarting Vex…</p>
            ) : (
              <>
                <p>
                  Your wallets stay encrypted with the forgotten password in the
                  backup folder and are kept until you deliberately delete them.
                  They remain unusable without that password.
                </p>
                <p>
                  On-chain funds can be recovered only from an existing backup or
                  seed phrase. Local history remains on this machine. Any
                  in-progress or persisted mission work will be abandoned, and
                  pending approvals will remain unanswered.
                </p>
                <label className="flex items-start gap-3 text-sm">
                  <input
                    type="checkbox"
                    checked={resetAcknowledged}
                    onChange={(event) => setResetAcknowledged(event.currentTarget.checked)}
                  />
                  <span>I understand that the forgotten password cannot be recovered.</span>
                </label>
                {resetError ? (
                  <div className="flex flex-col gap-2">
                    <p role="alert">{resetError}</p>
                    <OpenLogsLink />
                  </div>
                ) : null}
              </>
            )}
          </DialogBody>
          {!resetRestarting ? (
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                autoFocus
                disabled={resetPending}
                onClick={() => setResetDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
                disabled={!resetAcknowledged || resetPending}
                onClick={() => void requestFreshVault()}
              >
                {resetPending ? "Requesting…" : "Set up new vault"}
              </Button>
            </DialogFooter>
          ) : null}
        </DialogContent>
      </Dialog>
    </main>
  );
}
