/**
 * Branch: error.failed — Compose up itself failed (Docker daemon died
 * mid-run, image pull failed, lifecycle aborted, etc.). Shows the
 * error message + an expandable "Show recent logs" disclosure that
 * surfaces the last buffered log lines (capped at COMPOSE_LOG_BUFFER_MAX
 * — no full-log IPC yet per codex plan v2 SHOULD-FIX #10).
 */

import { useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { AlertCircleIcon, Refresh01Icon } from "@hugeicons/core-free-icons";
import { StatusTile } from "../../../../components/onboarding/StatusTile.js";
import { PrimaryButton } from "../../../../components/onboarding/PrimaryButton.js";
import { OpenLogsLink } from "../../../../components/common/OpenLogsLink.js";

interface FailedBodyProps {
  readonly message: string;
  readonly recentLogs: readonly string[];
  readonly onRetry: () => void;
}

export function FailedBody({
  message,
  recentLogs,
  onRetry,
}: FailedBodyProps): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="flex flex-col gap-4">
      <StatusTile
        tone="danger"
        icon={<HugeiconsIcon icon={AlertCircleIcon} size={20} aria-hidden />}
        title="Compose up failed"
        detail={message}
      />

      {recentLogs.length > 0 ? (
        expanded ? (
          <pre className="max-h-40 overflow-auto rounded-lg border border-white/[0.08] bg-black/40 p-3 font-mono text-[10px] leading-relaxed text-[var(--color-text-primary)]">
            <code>{recentLogs.join("\n")}</code>
          </pre>
        ) : (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="self-start font-mono text-[11px] text-[color-mix(in_oklab,var(--vex-onboarding-accent)_55%,white)] underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--vex-onboarding-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-bg-primary)]"
          >
            Show recent logs ({recentLogs.length} line
            {recentLogs.length === 1 ? "" : "s"})
          </button>
        )
      ) : null}

      <PrimaryButton icon={Refresh01Icon} label="Try again" onClick={onRetry} />
      <OpenLogsLink />
    </div>
  );
}
