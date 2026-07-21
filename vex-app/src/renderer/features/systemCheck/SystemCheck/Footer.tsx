/**
 * System Check footer (NOTARY) — the gate counter and the CONTINUE key.
 *
 * The key itself is the shared onboarding `KeyButton` (dormant from frame
 * one in the same 208×44 slot the intro's BEGIN occupied; arms in place
 * with one glint + focus when the gate opens). This module owns only the
 * SystemCheck-specific attestation counter and the gate wiring.
 *
 * Pure presentation: the disabled state and the advance handler stay
 * owned by the parent component, so the state-machine transition lives
 * in one place.
 */

import { KeyButton } from "../../../components/onboarding/KeyButton.js";
import { OpenLogsLink } from "../../../components/common/OpenLogsLink.js";

interface FooterProps {
  /** Probes resolved so far (0–4) — drives the ATTESTING/ATTESTED line. */
  readonly resolvedCount: number;
  readonly totalProbes: number;
  readonly disabled: boolean;
  readonly onContinue: () => void;
}

export function Footer({
  resolvedCount,
  totalProbes,
  disabled,
  onContinue,
}: FooterProps): JSX.Element {
  const armed = !disabled;
  return (
    <>
      {/* GATE COUNTER — quiet attestation progress, left-aligned. The
       * status dot is a still color mark (owner decree: no pulsing dots
       * anywhere) — armed vs. attesting differ by color alone, because
       * "attested" covers warn/fail stamps too. */}
      <div className="mt-5 flex w-full items-center gap-2.5">
        <span
          aria-hidden
          className={
            armed
              ? "h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-text-muted)]"
              : "h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-accent-secondary)]"
          }
        />
        <span
          aria-live="polite"
          className="font-mono text-[10px] uppercase tracking-[0.3em] text-[var(--color-text-muted)]"
        >
          {armed ? "Attested" : "Attesting"} ·{" "}
          <span className="tabular-nums">
            {String(resolvedCount).padStart(2, "0")} /{" "}
            {String(totalProbes).padStart(2, "0")}
          </span>
        </span>
      </div>

      <div className="mt-9">
        <KeyButton
          armed={armed}
          onClick={onContinue}
          ariaLabel="Continue to Docker bootstrap"
        />
      </div>
      <OpenLogsLink className="mt-4" />
    </>
  );
}
