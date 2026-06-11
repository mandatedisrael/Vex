/**
 * THE RUNTIME LEDGER LINE — runtime status moved from the AppShell footer
 * overlay (the desk rule's right side) into the sidebar registry's last
 * line, so the rail reads top-to-bottom as one continuous ledger. The dot
 * is flat (no glow); depth stays with the hairline above it.
 *
 * Label strings are a test contract (pinned by shell-sidebar.test.tsx via
 * findByText) — visual uppercase is CSS-only, never baked into the string.
 */

import type { JSX } from "react";
import { Docker, Postgresql } from "@thesvg/react";
import type { Result } from "@shared/ipc/result.js";
import type { HealthReport } from "@shared/schemas/system.js";
import { cn } from "../../lib/utils.js";
import { useSystemHealth } from "../../lib/api/system.js";

export function RuntimeLedger({
  sidebarOpen,
}: {
  readonly sidebarOpen: boolean;
}): JSX.Element {
  const healthQuery = useSystemHealth();
  const runtime = getRuntimeStatus({
    loading: healthQuery.isLoading,
    result: healthQuery.data,
  });

  if (!sidebarOpen) {
    // Collapsed rail: dot only; the title attribute keeps the status
    // reachable on hover without widening the 72px column.
    return (
      <div
        className="flex h-8 items-center justify-center border-t border-[var(--vex-line)]"
        title={runtime.label}
      >
        <span
          aria-hidden
          className={cn("h-1.5 w-1.5 rounded-full", runtime.dotClass)}
        />
      </div>
    );
  }

  return (
    <div className="flex h-8 items-center gap-2 border-t border-[var(--vex-line)] px-4">
      <span
        aria-hidden
        className={cn("h-1.5 w-1.5 shrink-0 rounded-full", runtime.dotClass)}
      />
      <span className="min-w-0 flex-1 truncate font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--vex-text-2)]">
        {runtime.label}
      </span>
      <span className="flex shrink-0 items-center gap-2 text-[var(--vex-text-3)]">
        <Docker width={12} height={12} aria-hidden focusable={false} />
        <Postgresql width={12} height={12} aria-hidden focusable={false} />
      </span>
    </div>
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
      dotClass: "bg-warning",
    };
  }
  if (!result.ok) {
    return {
      label: "Local runtime unavailable",
      dotClass: "bg-destructive",
    };
  }
  if (result.data.overall === "ok") {
    return {
      label: "Connected to local runtime",
      dotClass: "bg-success",
    };
  }
  return {
    label:
      result.data.overall === "degraded"
        ? "Local runtime degraded"
        : "Local runtime not ready",
    dotClass: "bg-warning",
  };
}
