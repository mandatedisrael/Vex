/**
 * Branch C-linux — engine missing on Linux. Orchestrator auto-fetches
 * the apt-repo bootstrap from `useDockerInstall({ method:
 * "linux_manual_instructions" })` and passes the resulting state in.
 *
 * Rendering matrix:
 *   loading — "Loading install instructions…" placeholder
 *   error   — message + "Retry instructions fetch" (separate from main
 *             footer Recheck; this retries the fetch only)
 *   ready   — `<LinuxManualInstructions>` with copy-paste block
 *
 * Always-present: docker-group privilege heads-up (joining the group
 * grants root-equivalent access — Vex supports the standard Engine +
 * Compose path; rootless mode is mentioned as an advanced, separate
 * path per codex review).
 */

import { HugeiconsIcon } from "@hugeicons/react";
import { TerminalIcon } from "@hugeicons/core-free-icons";
import { StatusTile } from "../../../../components/onboarding/StatusTile.js";
import { DocsLink } from "../../../../components/onboarding/DocsLink.js";
import { LinuxManualInstructions } from "../../LinuxManualInstructions.js";
import { cn } from "../../../../lib/utils.js";
import { OpenLogsLink } from "../../../../components/common/OpenLogsLink.js";
import {
  DOCKER_ENGINE_LINUX_URL,
  DOCKER_ROOTLESS_URL,
} from "../constants.js";
import type { ManualFetchState } from "../types.js";

interface LinuxInstallBodyProps {
  readonly state: ManualFetchState;
  readonly onRetryFetch: () => void;
}

export function LinuxInstallBody({
  state,
  onRetryFetch,
}: LinuxInstallBodyProps): JSX.Element {
  return (
    <div className="flex flex-col gap-4">
      <StatusTile
        tone="info"
        icon={<HugeiconsIcon icon={TerminalIcon} size={20} aria-hidden />}
        title="Docker Engine is not installed"
        detail="Linux — install via your package manager."
      />

      {state.kind === "loading" ? (
        <p className="text-xs text-[var(--color-text-secondary)]">
          Loading install instructions…
        </p>
      ) : state.kind === "error" ? (
        <div className="flex flex-col gap-2">
          <p className="text-xs leading-relaxed text-[var(--color-danger)]">
            Couldn&rsquo;t fetch install instructions: {state.message}
          </p>
          <button
            type="button"
            onClick={onRetryFetch}
            className={cn(
              "self-start rounded-full border border-white/[0.12] bg-transparent px-3.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-text-secondary)]",
              "hover:border-white/[0.2] hover:text-[var(--color-text-primary)]",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--dockerbootstrap-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--vex-onboarding-bg)]",
              "transition-colors duration-150",
            )}
          >
            Retry instructions fetch
          </button>
        </div>
      ) : state.kind === "ready" ? (
        <LinuxManualInstructions instructions={state.instructions} />
      ) : null}

      <div className="rounded-[3px] border border-[color-mix(in_oklab,var(--color-warning)_30%,transparent)] bg-[color-mix(in_oklab,var(--color-warning)_8%,transparent)] px-3 py-2 text-xs leading-relaxed">
        <strong className="font-semibold text-[var(--color-warning)]">
          Heads up:
        </strong>{" "}
        joining the <code className="font-mono">docker</code> group grants
        root-equivalent access on this machine. Vex&rsquo;s supported Linux
        path is the standard Docker Engine + Compose plugin (the commands
        above). Advanced users can review{" "}
        <a
          href={DOCKER_ROOTLESS_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[color-mix(in_oklab,var(--dockerbootstrap-accent)_55%,white)] underline-offset-4 hover:underline"
        >
          Docker&rsquo;s rootless mode
        </a>{" "}
        as a separate path.
      </div>

      <DocsLink
        href={DOCKER_ENGINE_LINUX_URL}
        label="View official Docker Engine docs"
      />
      <OpenLogsLink />
    </div>
  );
}
