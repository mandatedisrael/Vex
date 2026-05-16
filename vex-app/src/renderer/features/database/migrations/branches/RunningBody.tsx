/**
 * Branch: running — `database.migrate()` is in flight. Hero dotmatrix
 * loader anchors the body; below it a big "Applying X of Y" counter
 * derived from the current progress event (index is zero-based in the
 * IPC schema — display `index + 1` for 1-based counting). A single
 * current-migration pill names the file/version being applied.
 *
 * No cancel button — the IPC surface intentionally does NOT expose a
 * cancel handle (mid-SQL aborts aren't safe).
 */

import type { MigrateProgress } from "@shared/schemas/database.js";
import { DotmCircular8 } from "../../../../components/ui/dotm-circular-8.js";
import { DotmSquare3 } from "../../../../components/ui/dotm-square-3.js";

interface RunningBodyProps {
  readonly current: MigrateProgress | null;
}

function progressLabel(progress: MigrateProgress | null): string {
  if (progress === null) {
    return "Checking for pending migrations…";
  }
  if (progress.phase === "planned") {
    const word = progress.total === 1 ? "migration" : "migrations";
    return `Planning ${progress.total} ${word}…`;
  }
  // index is zero-based in the IPC schema; show 1-based for users.
  return `Applying ${progress.index + 1} of ${progress.total}`;
}

export function RunningBody({ current }: RunningBodyProps): JSX.Element {
  const showCurrentPill =
    current !== null && current.phase !== "planned";

  return (
    <div className="flex flex-col items-center gap-6">
      <div className="relative mt-2 flex h-[72px] w-[72px] items-center justify-center sm:h-[64px] sm:w-[64px] xl:h-[80px] xl:w-[80px]">
        <DotmCircular8
          size={64}
          color="var(--vex-onboarding-accent)"
          ariaLabel="Applying migrations"
        />
      </div>

      <p className="text-center text-xs uppercase tracking-[0.3em] text-[var(--color-text-secondary)]">
        {progressLabel(current)}
      </p>

      {showCurrentPill && current !== null ? (
        <div
          className="flex w-full items-center gap-3 rounded-xl border border-[color-mix(in_oklab,var(--vex-onboarding-accent)_35%,transparent)] bg-[color-mix(in_oklab,var(--vex-onboarding-accent)_8%,transparent)] px-3 py-2.5 backdrop-blur-md shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]"
          data-migration-version={current.version}
        >
          <DotmSquare3
            size={22}
            dotSize={3}
            animated
            color="var(--vex-onboarding-accent)"
            ariaLabel={`Migration ${current.version} in progress`}
          />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="truncate text-sm font-semibold text-[var(--color-text-primary)]">
              Migration v{current.version}
            </span>
            <span className="truncate font-mono text-[11px] text-[var(--color-text-secondary)]">
              {current.file}
            </span>
          </div>
          <span className="shrink-0 font-mono text-[9px] uppercase tracking-[0.18em] text-[var(--vex-onboarding-accent)] opacity-80">
            {current.phase}
          </span>
        </div>
      ) : null}
    </div>
  );
}
