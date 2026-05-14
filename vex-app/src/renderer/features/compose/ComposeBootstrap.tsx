/**
 * Compose bootstrap surface — runs the compose render + up flow once
 * Docker is verified ready, polls for health, then advances the state
 * machine to placeholder when the DB answers `pg_isready`.
 *
 * Logs streaming is not wired into this component yet — the
 * `vex.docker.onComposeLogs` event channel is reserved for a richer
 * log viewer that lands when the wizard does (M11 has its own log
 * panel needs).
 *
 * PR3: user-cancellable bootstrap. The Cancel button calls into
 * `composeUpAbortable`'s `cancel` handle, which fires a `vex:cancel`
 * IPC for THIS request's correlationId. Main aborts the corresponding
 * handler's signal; spawn-runner SIGTERMs the in-flight subprocess;
 * the original `composeUp` IPC then resolves to
 * `Result<E:internal.cancelled>`. While the cancel request is in
 * flight we show a transient "Cancelling…" state — once the response
 * lands we fall back into the regular error UI (with retry).
 *
 * IMPORTANT: we do NOT call `cancel()` from the useEffect cleanup
 * function. React StrictMode dev mode mounts + cleans up + remounts
 * every effect on initial load, which would race the cancel call
 * against the joined single-flight in main and leave the renderer in
 * a flaky state. The cleanup `cancelled` flag only suppresses stale
 * promise resolutions; user-initiated cancellation goes through the
 * button click.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { ComposeLog, ComposeUpResult } from "@shared/schemas/docker.js";
import { useUiStore } from "../../stores/uiStore.js";
import { Button } from "../../components/ui/button.js";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card.js";

const MAX_LOG_LINES = 20;

type Phase = "running" | "cancelling" | "ready" | "reused" | "error";

interface PhaseState {
  readonly phase: Phase;
  readonly message: string | null;
}

export function ComposeBootstrap(): JSX.Element {
  const setCurrentView = useUiStore((s) => s.setCurrentView);
  const [logs, setLogs] = useState<ReadonlyArray<ComposeLog>>([]);
  const [state, setState] = useState<PhaseState>({ phase: "running", message: null });
  const [retryToken, setRetryToken] = useState(0);
  const cancelRef = useRef<(() => void) | null>(null);

  // Direct IPC call instead of useMutation. We deliberately NO LONGER
  // guard with `startedRef` — React 18 dev StrictMode runs effects
  // twice (mount → cleanup → mount) and a startedRef guard combined
  // with a cancelled flag would let mount1's promise be cancelled while
  // mount2 short-circuits without starting a new one, leaving state
  // stuck at "running" forever. Main-process composeUp is single-flight
  // (see `vex-app/src/main/ipc/docker.ts`) so a second concurrent IPC
  // call joins the in-flight one — no duplicate Docker work either way.
  useEffect(() => {
    let cancelled = false;
    setState({ phase: "running", message: null });

    const invocation = window.vex.docker.composeUpAbortable({});
    cancelRef.current = invocation.cancel;

    void (async () => {
      try {
        const result = await invocation.promise;
        if (cancelled) return;
        if (!result.ok) {
          // `internal.cancelled` flows through the same error path; the
          // copy is surfaced through error-copy.ts in the renderer (or
          // a local override if we want a surface-specific phrase like
          // "Startup cancelled."). For now the canonical message stays.
          const message =
            result.error.code === "internal.cancelled"
              ? "Startup cancelled."
              : result.error.message;
          setState({ phase: "error", message });
          return;
        }
        const data: ComposeUpResult = result.data;
        if (data.kind === "running") {
          setState({ phase: "ready", message: data.message });
        } else if (data.kind === "reused") {
          setState({ phase: "reused", message: data.message });
        } else {
          setState({ phase: "error", message: data.message });
        }
      } catch (err: unknown) {
        if (cancelled) return;
        setState({
          phase: "error",
          message: err instanceof Error ? err.message : "Unknown error",
        });
      }
    })();

    return () => {
      cancelled = true;
      // Intentionally NOT calling invocation.cancel() — see file
      // header comment. StrictMode dev double-mount would otherwise
      // cancel mount-1's request while mount-2 re-fires; main's
      // single-flight would join mount-2 onto mount-1's already-
      // cancelled work and we'd get a permanent "cancelled" state on
      // first render.
      cancelRef.current = null;
    };
  }, [retryToken]);

  // Subscribe to compose log stream — bounded buffer per skill §11.
  useEffect(() => {
    const off = window.vex.docker.onComposeLog((payload) => {
      setLogs((prev) => [...prev, payload].slice(-MAX_LOG_LINES));
    });
    return () => off();
  }, []);

  const handleRetry = useCallback((): void => {
    setLogs([]);
    setRetryToken((n) => n + 1);
  }, []);

  const handleCancel = useCallback((): void => {
    const cancel = cancelRef.current;
    if (cancel === null) return;
    // Transient phase — the cancel IPC + main's abort handling +
    // spawn-runner's SIGTERM are not instant. Disabling the button
    // and showing "Cancelling…" prevents repeat clicks and gives the
    // user feedback that the action was registered. Once the original
    // `composeUp` promise resolves (to internal.cancelled), the state
    // flips to "error" with the cancelled message.
    setState({ phase: "cancelling", message: "Cancelling…" });
    cancel();
  }, []);

  const status = state.phase;
  const lastLog = logs[logs.length - 1] ?? null;

  return (
    <main
      className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background p-8 text-foreground"
      data-vex-screen="composeBootstrap"
    >
      <Card className="w-full max-w-2xl">
        <CardHeader>
          <CardTitle>Starting Vex services</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">
            {status === "running"
              ? lastLog
                ? lastLog.line
                : "Checking Docker daemon…"
              : status === "cancelling"
                ? "Cancelling…"
                : status === "ready"
                  ? state.message ?? "Postgres is healthy on the configured port."
                  : status === "reused"
                    ? state.message ??
                      "Reusing the existing Vex compose project that is already running."
                    : status === "error"
                      ? state.message ?? "Failed to bring services up. See logs for details."
                      : "Initializing…"}
          </p>
          {status === "running" || status === "cancelling" ? (
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-popover">
              <div className="h-full w-1/3 animate-pulse bg-primary" />
            </div>
          ) : null}
          {logs.length > 0 ? (
            <pre className="max-h-48 overflow-y-auto rounded-md border border-border bg-popover/40 p-3 text-xs leading-relaxed text-muted-foreground">
              {logs.map((log, idx) => (
                <div
                  key={`${log.ts}-${idx}`}
                  className={
                    log.stream === "stderr" ? "text-warning" : undefined
                  }
                >
                  {log.line}
                </div>
              ))}
            </pre>
          ) : null}
          <div className="flex justify-end gap-2">
            {status === "running" ? (
              <Button
                variant="outline"
                onClick={handleCancel}
                data-vex-compose-cancel
              >
                Cancel
              </Button>
            ) : null}
            {status === "cancelling" ? (
              <Button variant="outline" disabled data-vex-compose-cancelling>
                Cancelling…
              </Button>
            ) : null}
            {status === "error" ? (
              <Button variant="outline" onClick={handleRetry}>
                Retry
              </Button>
            ) : null}
            {status === "ready" || status === "reused" ? (
              <Button onClick={() => setCurrentView("migrations")}>
                Continue
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
