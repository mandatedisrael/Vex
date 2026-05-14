import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "../../components/ui/button.js";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "../../components/ui/card.js";
import { Input } from "../../components/ui/input.js";
import { Label } from "../../components/ui/label.js";
import { useUiStore } from "../../stores/uiStore.js";
import { PASSWORD_MIN_LENGTH } from "@shared/schemas/secrets.js";
import { getErrorCopy } from "../../lib/errors/error-copy.js";

/**
 * Inline lock-icon SVG. `lucide-react` is not a vex-app dependency, so we
 * render the glyph directly — avoids pulling in a 200KB icon set for a
 * single screen and prevents the import-resolution failure that this fix
 * also addresses.
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

interface ThrottleState {
  readonly message: string;
  readonly retryAtMs: number;
}

export function UnlockScreen(): JSX.Element {
  const passwordRef = useRef<HTMLInputElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [throttle, setThrottle] = useState<ThrottleState | null>(null);
  const [now, setNow] = useState(() => Date.now());
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

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (throttleActive) return;
    const password = passwordRef.current?.value ?? "";
    if (password.length < PASSWORD_MIN_LENGTH) {
      setError(`Password must be at least ${PASSWORD_MIN_LENGTH} characters.`);
      return;
    }

    setPending(true);
    setError(null);
    try {
      const result = await window.vex.secrets.unlock({ password });
      if (!result.ok) {
        if (
          result.error.code === "secrets.unlock_throttled"
          && typeof result.error.retryAfterMs === "number"
          && result.error.retryAfterMs >= 0
        ) {
          // Workflow-specific UX (countdown banner) — message comes from
          // the shared copy helper so the wording stays consistent with
          // other throttle surfaces (export, polymarket).
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
        return;
      }
      if (passwordRef.current) passwordRef.current.value = "";
      setCurrentView(returnView);
    } finally {
      setPending(false);
    }
  }

  return (
    <main
      className="flex min-h-screen items-center justify-center bg-background p-8 text-foreground"
      data-vex-screen="unlock"
    >
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-md border border-border bg-popover">
            <LockIcon />
          </div>
          <CardTitle>Unlock Vex</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-4" onSubmit={onSubmit}>
            <div className="flex flex-col gap-2">
              <Label htmlFor="vex-unlock-password">Master password</Label>
              <Input
                id="vex-unlock-password"
                ref={passwordRef}
                type="password"
                autoComplete="current-password"
                autoFocus
                disabled={inputsDisabled}
              />
            </div>
            {throttleActive ? (
              <p
                className="text-sm text-destructive"
                role="alert"
                data-vex-unlock-throttle="active"
              >
                {throttle.message} ({throttleRemainingSeconds}s)
              </p>
            ) : error ? (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            ) : null}
            <Button type="submit" disabled={inputsDisabled}>
              {pending ? "Unlocking..." : "Unlock"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
