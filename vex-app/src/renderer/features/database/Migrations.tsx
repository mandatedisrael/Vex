/**
 * Migrations bootstrap surface (M6) — runs `vex.database.migrate()`
 * after Compose reaches `running`/`reused` and before the placeholder
 * shell. Pattern mirrors ComposeBootstrap (StrictMode-safe direct
 * async + `cancelled` flag, no useMutation; main-side single-flight
 * dedup handles double-mount races).
 *
 * Subscribes to `onProgress` BEFORE invoking migrate so the bus's
 * replay-on-subscribe covers the early planned/start handshake even
 * if the renderer mounts a tick after main has emitted.
 */

import { useCallback, useEffect, useState } from "react";
import type { MigrateProgress } from "@shared/schemas/database.js";
import { useUiStore } from "../../stores/uiStore.js";
import { Button } from "../../components/ui/button.js";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "../../components/ui/card.js";

const MAX_LOG_LINES = 20;
const NOOP_AUTOADVANCE_MS = 500;

type Phase = "running" | "ready" | "noop" | "error";

interface PhaseState {
  readonly phase: Phase;
  readonly message: string | null;
}

function describeLatest(latest: MigrateProgress | null): string {
  if (latest === null) return "Initializing migrations…";
  if (latest.phase === "planned") {
    return latest.total === 0
      ? "Schema is up to date."
      : `Preparing to apply ${latest.total} migration${
          latest.total === 1 ? "" : "s"
        }…`;
  }
  const human = latest.phase === "start" ? "Applying" : "Applied";
  return `${human} ${latest.index + 1}/${latest.total}: ${latest.file}`;
}

export function Migrations(): JSX.Element {
  const setCurrentView = useUiStore((s) => s.setCurrentView);
  const [progress, setProgress] = useState<ReadonlyArray<MigrateProgress>>([]);
  const [latest, setLatest] = useState<MigrateProgress | null>(null);
  const [state, setState] = useState<PhaseState>({
    phase: "running",
    message: null,
  });
  const [retryToken, setRetryToken] = useState(0);

  // Subscribe BEFORE invoking migrate. The bus replays the latest event
  // to new subscribers so a late-mounted listener (StrictMode dev double
  // mount, or a joined single-flight call) still gets the planned/total
  // handshake. Codex turn 1 other-gaps.
  useEffect(() => {
    const off = window.vex.database.onProgress((payload) => {
      setLatest(payload);
      setProgress((prev) => [...prev, payload].slice(-MAX_LOG_LINES));
    });
    return () => off();
  }, []);

  useEffect(() => {
    let cancelled = false;
    setState({ phase: "running", message: null });

    void (async () => {
      try {
        const result = await window.vex.database.migrate();
        if (cancelled) return;
        if (!result.ok) {
          setState({ phase: "error", message: result.error.message });
          return;
        }
        const data = result.data;
        if (data.kind === "applied") {
          setState({ phase: "ready", message: data.message });
        } else {
          setState({ phase: "noop", message: data.message });
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
    };
  }, [retryToken]);

  // No migrations to apply → auto-advance to the wizard after a short
  // delay so the user sees the up-to-date message without needing to
  // click. The wizard itself decides whether to render Step 1 or
  // skip-to-app based on `wizard-state.json` + envState (M7).
  useEffect(() => {
    if (state.phase !== "noop") return;
    const timer = setTimeout(
      () => setCurrentView("wizard"),
      NOOP_AUTOADVANCE_MS
    );
    return () => clearTimeout(timer);
  }, [state.phase, setCurrentView]);

  const handleRetry = useCallback((): void => {
    setProgress([]);
    setLatest(null);
    setRetryToken((n) => n + 1);
  }, []);

  const isRunning = state.phase === "running";

  return (
    <main
      className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background p-8 text-foreground"
      data-vex-screen="migrations"
    >
      <Card className="w-full max-w-2xl">
        <CardHeader>
          <CardTitle>Applying database migrations</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">
            {state.phase === "running"
              ? describeLatest(latest)
              : state.phase === "ready"
                ? state.message ?? "Migrations applied."
                : state.phase === "noop"
                  ? state.message ?? "All migrations already applied."
                  : state.message ?? "Migration failed. See details below."}
          </p>
          {isRunning ? (
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-popover">
              <div className="h-full w-1/3 animate-pulse bg-primary" />
            </div>
          ) : null}
          {progress.length > 0 ? (
            <pre className="max-h-48 overflow-y-auto rounded-md border border-border bg-popover/40 p-3 text-xs leading-relaxed text-muted-foreground">
              {progress.map((p, idx) => (
                <div key={`${p.ts}-${idx}`}>
                  {p.phase === "planned"
                    ? `[planned] ${p.total} migration${
                        p.total === 1 ? "" : "s"
                      } pending`
                    : `[${p.phase}] ${p.index + 1}/${p.total} — ${p.file}`}
                </div>
              ))}
            </pre>
          ) : null}
          <div className="flex justify-end gap-2">
            {state.phase === "error" ? (
              <Button
                variant="outline"
                onClick={handleRetry}
                disabled={isRunning}
              >
                Retry
              </Button>
            ) : null}
            {state.phase === "ready" ? (
              <Button onClick={() => setCurrentView("wizard")}>
                Continue
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
