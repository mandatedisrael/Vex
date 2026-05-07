import { useEffect, useState } from "react";
import type { Capabilities } from "../shared/schemas/capabilities.js";
import type { HealthReport } from "../shared/schemas/system.js";

export function App(): JSX.Element {
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null);
  const [health, setHealth] = useState<HealthReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
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
  }, []);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
      <div className="flex flex-col items-center gap-3">
        <h1 className="text-4xl font-semibold tracking-tight text-[--color-text-primary]">
          Vex
        </h1>
        <p className="text-sm text-[--color-text-secondary]">
          M0 — Security baseline scaffold
        </p>
      </div>

      <div className="grid w-full max-w-xl gap-4">
        <Card title="Capabilities">
          {capabilities ? (
            <ul className="space-y-1 text-sm">
              <li>Phase: <span className="font-mono text-[--color-accent-primary]">{capabilities.phase}</span></li>
              <li>App version: <span className="font-mono">{capabilities.appVersion}</span></li>
              <li>Onboarding complete: <span className="font-mono">{String(capabilities.onboardingComplete)}</span></li>
            </ul>
          ) : (
            <p className="text-sm text-[--color-text-muted]">Loading…</p>
          )}
        </Card>

        <Card title="System health">
          {health ? (
            <ul className="space-y-1 text-sm">
              <li>Platform: <span className="font-mono">{health.os.platform} / {health.os.arch}</span></li>
              <li>Electron: <span className="font-mono">{health.os.electronVersion}</span></li>
              <li>Network: <span className="font-mono">{health.network.online ? "online" : "offline"}</span></li>
              <li>Overall: <span className="font-mono">{health.overall}</span></li>
            </ul>
          ) : (
            <p className="text-sm text-[--color-text-muted]">Probing…</p>
          )}
        </Card>

        {error ? (
          <Card title="Error">
            <p className="text-sm text-[--color-danger]">{error}</p>
          </Card>
        ) : null}

        <Card title="Security audit checklist (DevTools)">
          <ul className="space-y-1 text-sm">
            <li>
              <code>typeof window.require</code>:{" "}
              <span className="font-mono text-[--color-success]">
                {typeof (window as unknown as { require?: unknown }).require}
              </span>
            </li>
            <li>
              <code>typeof window.process</code>:{" "}
              <span className="font-mono text-[--color-success]">
                {typeof (window as unknown as { process?: unknown }).process}
              </span>
            </li>
            <li>
              <code>typeof window.Buffer</code>:{" "}
              <span className="font-mono text-[--color-success]">
                {typeof (window as unknown as { Buffer?: unknown }).Buffer}
              </span>
            </li>
            <li>
              <code>typeof window.vex</code>:{" "}
              <span className="font-mono text-[--color-success]">
                {typeof window.vex}
              </span>
            </li>
          </ul>
        </Card>
      </div>
    </main>
  );
}

function Card({
  title,
  children,
}: {
  readonly title: string;
  readonly children: React.ReactNode;
}): JSX.Element {
  return (
    <section className="rounded-lg border border-[--color-bg-overlay] bg-[--color-bg-elevated] p-4">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[--color-text-secondary]">
        {title}
      </h2>
      {children}
    </section>
  );
}
