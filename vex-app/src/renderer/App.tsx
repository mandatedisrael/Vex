/**
 * Top-level renderer state machine for Phase 1.
 *
 * Flow: splash → placeholder. Splash owns its own min-duration timer and
 * calls back into `uiStore.setCurrentView('placeholder')` when ready.
 * M2+ will introduce additional view kinds (system-check, docker, wizard)
 * and stop hardcoding the splash → placeholder transition here.
 *
 * The legacy M0 capability/health/security cards are gated behind
 * `import.meta.env.DEV` and are reachable via a dev-only side panel —
 * they are not part of the user-facing flow.
 */

import { useCallback, useEffect, useState } from "react";
import { Splash } from "./features/splash/Splash.js";
import { PlaceholderShell } from "./features/placeholder/PlaceholderShell.js";
import { useUiStore } from "./stores/uiStore.js";
import type { Capabilities } from "../shared/schemas/capabilities.js";
import type { HealthReport } from "../shared/schemas/system.js";

export function App(): JSX.Element {
  const currentView = useUiStore((s) => s.currentView);
  const setCurrentView = useUiStore((s) => s.setCurrentView);

  const handleSplashComplete = useCallback(() => {
    setCurrentView("placeholder");
  }, [setCurrentView]);

  return (
    <>
      {currentView === "splash" ? (
        <Splash onComplete={handleSplashComplete} />
      ) : (
        <PlaceholderShell />
      )}
      {import.meta.env.DEV ? <DevDiagnostics /> : null}
    </>
  );
}

/**
 * Dev-only floating panel that surfaces the M0 IPC health probes. Hidden
 * in production builds via `import.meta.env.DEV`, which Vite tree-shakes
 * out of the bundle.
 */
function DevDiagnostics(): JSX.Element | null {
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null);
  const [health, setHealth] = useState<HealthReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      try {
        const [capsResult, healthResult] = await Promise.all([
          window.vex.capabilities.get(),
          window.vex.system.health(),
        ]);
        if (cancelled) return;
        if (capsResult.ok) setCapabilities(capsResult.data);
        else setError(`capabilities: ${capsResult.error.message}`);
        if (healthResult.ok) setHealth(healthResult.data);
        else setError(`health: ${healthResult.error.message}`);
      } catch (e: unknown) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Unknown error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  return (
    <div className="fixed bottom-4 right-4 z-50">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="rounded-md border border-border bg-card px-2 py-1 text-[10px] font-mono uppercase tracking-wider text-[var(--color-text-secondary)] hover:text-foreground"
      >
        dev · {open ? "hide" : "diagnostics"}
      </button>
      {open ? (
        <section className="mt-2 w-72 rounded-md border border-border bg-card p-3 text-xs">
          <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-secondary)]">
            M0 diagnostics
          </h2>
          {capabilities ? (
            <ul className="mb-2 space-y-0.5 font-mono">
              <li>phase: {capabilities.phase}</li>
              <li>app: {capabilities.appVersion}</li>
              <li>onboarded: {String(capabilities.onboardingComplete)}</li>
            </ul>
          ) : null}
          {health ? (
            <ul className="mb-2 space-y-0.5 font-mono">
              <li>os: {health.os.platform}/{health.os.arch}</li>
              <li>electron: {health.os.electronVersion}</li>
              <li>net: {health.network.online ? "online" : "offline"}</li>
              <li>overall: {health.overall}</li>
            </ul>
          ) : null}
          <ul className="space-y-0.5 font-mono">
            <li>require: {typeof (window as unknown as { require?: unknown }).require}</li>
            <li>process: {typeof (window as unknown as { process?: unknown }).process}</li>
            <li>vex: {typeof window.vex}</li>
          </ul>
          {error ? <p className="mt-2 text-destructive">{error}</p> : null}
        </section>
      ) : null}
    </div>
  );
}
