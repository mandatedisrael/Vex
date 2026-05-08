/**
 * Phase 1 placeholder rendered after the splash dismisses. M2-M15 will
 * progressively replace this with: System Check → Docker bootstrap →
 * Compose lifecycle → DB migrations → 9-step setup wizard → welcome.
 *
 * Until then this surface tells the user (and team smoke-runs) where the
 * Phase 1 build is in the milestone sequence and that the engine
 * scaffold is healthy.
 */

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../components/ui/card.js";

interface RoadmapEntry {
  readonly id: string;
  readonly title: string;
  readonly status: "done" | "current" | "upcoming";
}

const ROADMAP: ReadonlyArray<RoadmapEntry> = [
  { id: "M0", title: "Security baseline", status: "done" },
  { id: "M1", title: "Brand splash + renderer infra", status: "current" },
  { id: "M2", title: "IPC bridge + system health", status: "upcoming" },
  { id: "M3", title: "System Check screen", status: "upcoming" },
  { id: "M4", title: "Docker bootstrap (cross-OS)", status: "upcoming" },
  { id: "M5", title: "Compose lifecycle + vex-shell migration", status: "upcoming" },
  { id: "M6", title: "Database migrations", status: "upcoming" },
  { id: "M7-M11", title: "Setup wizard (9 steps)", status: "upcoming" },
  { id: "M12", title: "Welcome / setup complete", status: "upcoming" },
  { id: "M13", title: "Updater check (manual only)", status: "upcoming" },
  { id: "M14", title: "Dev release pipeline", status: "upcoming" },
  { id: "M15", title: "Acceptance gates + polish", status: "upcoming" },
];

export function PlaceholderShell(): JSX.Element {
  return (
    <main
      className="flex min-h-screen flex-col items-center justify-center gap-8 bg-background p-8 text-foreground"
      data-vex-screen="placeholder"
    >
      <div className="flex flex-col items-center gap-4">
        <img
          src="/vex.jpg"
          alt="Vex avatar"
          draggable={false}
          className="h-24 w-24 rounded-full object-cover ring-2 ring-primary/40"
        />
        <div className="flex flex-col items-center gap-1">
          <h1 className="text-3xl font-semibold tracking-tight">Vex</h1>
          <p className="text-sm text-[var(--color-text-secondary)]">
            Setup experience arrives in M2 — engine scaffold is live and
            healthy.
          </p>
        </div>
      </div>

      <Card className="w-full max-w-xl">
        <CardHeader>
          <CardTitle>Phase 1 milestone roadmap</CardTitle>
          <CardDescription>
            What lands next, in order. Each milestone replaces this
            placeholder with a real surface.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ol className="flex flex-col gap-2">
            {ROADMAP.map((entry) => (
              <li
                key={entry.id}
                className="flex items-center gap-3 rounded-md border border-border bg-popover/40 px-3 py-2 text-sm"
              >
                <StatusDot status={entry.status} />
                <span className="font-mono text-xs text-muted-foreground">
                  {entry.id}
                </span>
                <span className="text-foreground">{entry.title}</span>
                {entry.status === "current" ? (
                  <span className="ml-auto rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary">
                    in progress
                  </span>
                ) : null}
                {entry.status === "done" ? (
                  <span className="ml-auto rounded-full bg-success/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-success">
                    done
                  </span>
                ) : null}
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>
    </main>
  );
}

function StatusDot({ status }: { readonly status: RoadmapEntry["status"] }): JSX.Element {
  const cls =
    status === "done"
      ? "bg-success"
      : status === "current"
        ? "bg-primary"
        : "bg-muted-foreground/40";
  return (
    <span
      aria-hidden
      className={`inline-block h-2 w-2 shrink-0 rounded-full ${cls}`}
    />
  );
}
