import { useCallback, useState } from "react";
import type { JSX } from "react";
import { Docker, Postgresql } from "@thesvg/react";
import type { Result } from "@shared/ipc/result.js";
import type { HealthReport } from "@shared/schemas/system.js";
import { cn } from "../../lib/utils.js";
import { useSystemHealth } from "../../lib/api/system.js";
import { useUiStore } from "../../stores/uiStore.js";
import { SessionCreator } from "./SessionCreator.js";
import { SessionPanel } from "./SessionPanel.js";
import { SessionsLibrary } from "./SessionsLibrary.js";
import { SessionsList } from "./SessionsList.js";
import { SettingsPanel } from "./SettingsPanel.js";
import { KnowledgePanel } from "./KnowledgePanel.js";

export function AppShell(): JSX.Element {
  const [creatorOpen, setCreatorOpen] = useState<boolean>(false);
  const openCreator = useCallback(() => setCreatorOpen(true), []);
  const appShellView = useUiStore((s) => s.appShellView);
  const healthQuery = useSystemHealth();
  const runtime = getRuntimeStatus({
    loading: healthQuery.isLoading,
    result: healthQuery.data,
  });

  return (
    <main
      className="relative h-screen w-screen overflow-hidden bg-[var(--color-bg-primary)] text-foreground"
      data-vex-screen="appShell"
    >
      <img
        src="/runtime.png"
        alt=""
        aria-hidden
        draggable={false}
        className="pointer-events-none absolute inset-0 h-full w-full object-cover object-center"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_49%_42%,rgba(14,38,112,0.16),transparent_34%),linear-gradient(90deg,rgba(1,4,16,0.84)_0%,rgba(3,7,21,0.58)_30%,rgba(3,7,21,0.18)_63%,rgba(2,5,17,0.76)_100%)]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-36 bg-gradient-to-t from-[rgba(1,4,15,0.92)] to-transparent"
      />

      <div className="relative z-10 flex h-full min-h-0">
        <SessionsList onCreate={openCreator} />

        <section className="min-w-0 flex-1 pb-12">
          {appShellView === "sessionsLibrary" ? (
            <SessionsLibrary />
          ) : appShellView === "settings" ? (
            <SettingsPanel />
          ) : appShellView === "knowledge" ? (
            <KnowledgePanel />
          ) : (
            <SessionPanel />
          )}
        </section>
      </div>

      <footer className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex h-12 items-center justify-between px-6 text-xs text-[var(--color-text-secondary)]">
        <div className="pointer-events-auto flex min-w-0 items-center gap-3 drop-shadow-[0_1px_14px_rgba(0,0,0,0.86)]">
          <span
            className={cn(
              "inline-flex h-2.5 w-2.5 rounded-full shadow-[0_0_14px_currentColor]",
              runtime.dotClass,
            )}
            aria-hidden
          />
          <span className="truncate">{runtime.label}</span>
          <span
            aria-hidden
            className="hidden h-4 w-px bg-white/[0.08] sm:block"
          />
          <span className="hidden items-center gap-2 text-[var(--color-text-muted)] sm:inline-flex">
            <Docker width={14} height={14} aria-hidden focusable={false} />
            <Postgresql width={14} height={14} aria-hidden focusable={false} />
          </span>
        </div>
        <span className="pointer-events-auto font-mono text-[10px] uppercase tracking-[0.28em] text-[var(--color-text-muted)] drop-shadow-[0_1px_14px_rgba(0,0,0,0.86)]">
          v{__VEX_APP_VERSION__}
        </span>
      </footer>

      <SessionCreator open={creatorOpen} onOpenChange={setCreatorOpen} />
    </main>
  );
}

interface RuntimeStatusInput {
  readonly loading: boolean;
  readonly result: Result<HealthReport> | undefined;
}

function getRuntimeStatus({ loading, result }: RuntimeStatusInput): {
  readonly label: string;
  readonly dotClass: string;
} {
  if (loading || result === undefined) {
    return {
      label: "Connecting to local runtime",
      dotClass: "bg-warning text-warning",
    };
  }
  if (!result.ok) {
    return {
      label: "Local runtime unavailable",
      dotClass: "bg-destructive text-destructive",
    };
  }
  if (result.data.overall === "ok") {
    return {
      label: "Connected to local runtime",
      dotClass: "bg-success text-success",
    };
  }
  return {
    label:
      result.data.overall === "degraded"
        ? "Local runtime degraded"
        : "Local runtime not ready",
    dotClass: "bg-warning text-warning",
  };
}
