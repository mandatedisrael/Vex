/**
 * Branch: error — `database.migrate()` resolved to
 * `err({ code: "data.migration_failed", details: { failedAt? } })`.
 * Surfaces the message + the failed migration's version/file (if the
 * details payload contained the metadata, via the `extractFailedAt`
 * type guard). The "Show recent applied" disclosure exposes the
 * migrations that DID complete before the failure (from progress
 * event history captured by the orchestrator — bounded buffer).
 */

import { useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { AlertCircleIcon, Refresh01Icon } from "@hugeicons/core-free-icons";
import { StatusTile } from "../../../../components/onboarding/StatusTile.js";
import { PrimaryButton } from "../../../../components/onboarding/PrimaryButton.js";
import { OpenLogsLink } from "../../../../components/common/OpenLogsLink.js";
import type { FailedAt } from "../types.js";

interface ErrorBodyProps {
  readonly message: string;
  readonly failedAt: FailedAt | null;
  readonly appliedBeforeFailure: readonly string[];
  readonly onRetry: () => void;
}

export function ErrorBody({
  message,
  failedAt,
  appliedBeforeFailure,
  onRetry,
}: ErrorBodyProps): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="flex flex-col gap-4">
      <StatusTile
        tone="danger"
        icon={<HugeiconsIcon icon={AlertCircleIcon} size={20} aria-hidden />}
        title="Migration failed"
        detail={message}
      />

      {failedAt !== null ? (
        <p className="text-xs leading-relaxed text-[var(--color-text-secondary)]">
          Failed at migration{" "}
          <span className="font-mono text-[var(--color-text-primary)]">
            v{failedAt.version}
          </span>{" "}
          ·{" "}
          <code className="font-mono text-[var(--color-text-primary)]">
            {failedAt.file}
          </code>
        </p>
      ) : null}

      {appliedBeforeFailure.length > 0 ? (
        expanded ? (
          <pre className="max-h-40 overflow-auto rounded-lg border border-white/[0.08] bg-black/40 p-3 font-mono text-[10px] leading-relaxed text-[var(--color-text-primary)]">
            <code>{appliedBeforeFailure.join("\n")}</code>
          </pre>
        ) : (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="self-start font-mono text-[11px] text-[color-mix(in_oklab,var(--vex-onboarding-accent)_55%,white)] underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--vex-onboarding-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-bg-primary)]"
          >
            Show {appliedBeforeFailure.length} applied before failure
          </button>
        )
      ) : null}

      <PrimaryButton icon={Refresh01Icon} label="Retry" onClick={onRetry} />
      <OpenLogsLink />
    </div>
  );
}
