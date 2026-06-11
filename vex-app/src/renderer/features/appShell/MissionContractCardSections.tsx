/**
 * Presentational pieces + pure formatters for `MissionContractCard`
 * (puzzle 04 phase 7 extract).
 *
 * Pulled out so the card module stays under the 350-LOC budget.
 * Every component here is purely presentational — no hooks, no
 * fetches, no event handlers other than the typed `onClick`s the
 * card threads through.
 */

import type { JSX } from "react";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import {
  CheckmarkCircle02Icon,
  InformationCircleIcon,
  Target02Icon,
} from "@hugeicons/core-free-icons";
import type { MissionDraftDto } from "@shared/schemas/mission.js";
import { Button } from "../../components/ui/button.js";
import { cn } from "../../lib/utils.js";

export type CardStateKind =
  | "setup-needed"
  | "awaiting-acceptance"
  | "accepted"
  | "dirty-acceptance";

export interface CardHeaderProps {
  readonly kind: CardStateKind;
  readonly title: string;
}

export function CardHeader({ kind, title }: CardHeaderProps): JSX.Element {
  const meta = headerMeta(kind);
  return (
    <header className="flex items-center justify-between gap-3 border-b border-[var(--vex-line)] px-4 py-3">
      <div className="flex min-w-0 items-center gap-2">
        <HugeiconsIcon
          icon={meta.icon}
          size={16}
          aria-hidden
          className={meta.iconClass}
        />
        <h2
          id="mission-contract-card-title"
          className="truncate text-sm font-semibold text-foreground"
        >
          {title}
        </h2>
      </div>
      {/* Status stamp — NOTARY grammar: hairline tone border, text in tone. */}
      <span
        className={cn(
          "shrink-0 rounded-[3px] border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em]",
          meta.badgeClass,
        )}
        data-vex-state={meta.dataState}
      >
        {meta.badge}
      </span>
    </header>
  );
}

interface HeaderMeta {
  readonly icon: IconSvgElement;
  readonly iconClass: string;
  readonly badge: string;
  readonly badgeClass: string;
  readonly dataState: string;
}

function headerMeta(kind: CardStateKind): HeaderMeta {
  switch (kind) {
    case "setup-needed":
      return {
        icon: Target02Icon,
        iconClass: "text-[var(--vex-accent-text)]",
        badge: "Setup needed",
        badgeClass: "border-[var(--vex-line-strong)] text-[var(--vex-text-3)]",
        dataState: "setup-needed",
      };
    case "awaiting-acceptance":
      return {
        icon: InformationCircleIcon,
        iconClass: "text-[var(--vex-accent-text)]",
        badge: "Awaiting acceptance",
        badgeClass:
          "border-[color-mix(in_oklab,var(--vex-accent)_40%,transparent)] text-[var(--vex-accent-text)]",
        dataState: "awaiting-acceptance",
      };
    case "accepted":
      return {
        icon: CheckmarkCircle02Icon,
        iconClass: "text-success",
        badge: "Accepted",
        badgeClass:
          "border-[color-mix(in_oklab,var(--color-success)_40%,transparent)] text-success",
        dataState: "accepted",
      };
    case "dirty-acceptance":
      return {
        icon: InformationCircleIcon,
        iconClass: "text-warning",
        badge: "Contract changed",
        badgeClass:
          "border-[color-mix(in_oklab,var(--color-warning)_40%,transparent)] text-warning",
        dataState: "dirty-acceptance",
      };
  }
}

export interface CardBodyProps {
  readonly draft: MissionDraftDto;
}

export function CardBody({ draft }: CardBodyProps): JSX.Element {
  const constraints = formatConstraints(draft);
  const restrictions = formatRestrictions(draft);
  return (
    <div className="space-y-3 px-4 py-3 text-[var(--vex-text-2)]">
      <Field label="Goal">
        <p className="text-foreground">
          {draft.goal?.trim() || (
            <span className="italic text-[var(--vex-text-3)]">
              (no goal yet — talk to Vex to outline one)
            </span>
          )}
        </p>
      </Field>
      {constraints.length > 0 ? (
        <Field label="Constraints">
          <ul className="space-y-0.5">
            {constraints.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </Field>
      ) : null}
      {restrictions.length > 0 ? (
        <Field label="Restrictions">
          <ChipList items={restrictions} />
        </Field>
      ) : null}
      {draft.successCriteria.length > 0 ? (
        <Field label="Success criteria">
          <BulletList items={draft.successCriteria} />
        </Field>
      ) : null}
      {draft.stopConditions.length > 0 ? (
        <Field
          label="Stop conditions"
          hint="Host-only — Vex cannot change these"
        >
          <BulletList items={draft.stopConditions} />
        </Field>
      ) : null}
      {draft.renewedFromMissionId !== null ? (
        <p className="text-xs italic text-[var(--vex-text-3)]">
          Renewed from mission{" "}
          <span className="font-mono">{draft.renewedFromMissionId}</span>
        </p>
      ) : null}
    </div>
  );
}

interface FieldProps {
  readonly label: string;
  readonly hint?: string;
  readonly children: JSX.Element | string;
}

function Field({ label, hint, children }: FieldProps): JSX.Element {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--vex-text-3)]">
        <span>{label}</span>
        {hint ? <span className="text-[10px] italic">· {hint}</span> : null}
      </div>
      <div className="text-sm">{children}</div>
    </div>
  );
}

function ChipList({ items }: { readonly items: readonly string[] }): JSX.Element {
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((item) => (
        <span
          key={item}
          className="rounded-[3px] border border-[var(--vex-line-strong)] px-1.5 py-0.5 font-mono text-[11px] text-foreground"
        >
          {item}
        </span>
      ))}
    </div>
  );
}

function BulletList({
  items,
}: {
  readonly items: readonly string[];
}): JSX.Element {
  return (
    <ul className="list-disc space-y-0.5 pl-5 text-foreground">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

function formatConstraints(draft: MissionDraftDto): string[] {
  const out: string[] = [];
  const c = draft.constraints;
  if (typeof c.maxSpendUsd === "number") out.push(`Max spend: $${c.maxSpendUsd}`);
  if (typeof c.maxLossUsd === "number") out.push(`Max loss: $${c.maxLossUsd}`);
  if (typeof c.maxIterations === "number") {
    out.push(`Max iterations: ${c.maxIterations}`);
  }
  if (typeof c.deadlineAt === "string") out.push(`Deadline: ${c.deadlineAt}`);
  if (typeof c.notes === "string" && c.notes.length > 0) {
    out.push(`Notes: ${c.notes}`);
  }
  if (typeof draft.riskProfile === "string" && draft.riskProfile.length > 0) {
    out.push(`Risk profile: ${draft.riskProfile}`);
  }
  return out;
}

function formatRestrictions(draft: MissionDraftDto): string[] {
  return [
    ...draft.allowedChains.map((c) => `chain:${c}`),
    ...draft.allowedProtocols.map((p) => `protocol:${p}`),
    ...draft.allowedWallets.map((w) => `wallet:${w}`),
  ];
}

export interface AutoRetrySectionProps {
  readonly enabled: boolean;
  readonly pending: boolean;
  readonly onToggle: (next: boolean) => void;
}

/**
 * Auto-retry opt-in toggle (phase 4d-5). Rendered by the card only for
 * autonomous-full sessions. CSP-safe (Tailwind classes only, no inline
 * styles); accessible `role="switch"` + `aria-checked`. The card owns
 * the mutation; this stays presentational.
 */
export function AutoRetrySection({
  enabled,
  pending,
  onToggle,
}: AutoRetrySectionProps): JSX.Element {
  return (
    <div className="border-t border-[var(--vex-line)] px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--vex-text-3)]">
            Auto-retry on error
          </div>
          <p className="text-xs text-[var(--vex-text-2)]">
            Re-attempt up to 5× after a provider or runtime error. Turns itself
            off once the run performs a wallet, signing, or other
            state-changing action.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label="Auto-retry on error"
          disabled={pending}
          onClick={() => onToggle(!enabled)}
          data-vex-action="toggle-auto-retry"
          className={cn(
            "relative mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--vex-accent)] disabled:cursor-not-allowed disabled:opacity-50",
            enabled
              ? "border-[var(--vex-accent-border-strong)] bg-[var(--vex-accent)]"
              : "border-white/[0.12] bg-white/[0.06]",
          )}
        >
          <span
            className={cn(
              "inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform",
              enabled ? "translate-x-[18px]" : "translate-x-[3px]",
            )}
          />
        </button>
      </div>
    </div>
  );
}

export interface CardFooterProps {
  readonly kind: CardStateKind;
  readonly currentHash: string | null;
  readonly pending: boolean;
  readonly onAccept: (hash: string) => void;
}

export function CardFooter({
  kind,
  currentHash,
  pending,
  onAccept,
}: CardFooterProps): JSX.Element | null {
  if (kind === "setup-needed") {
    return (
      <footer className="border-t border-[var(--vex-line)] px-4 py-3 text-xs text-[var(--vex-text-3)]">
        Add a goal, constraints, and stop conditions to enable Accept.
      </footer>
    );
  }
  if (kind === "accepted") {
    return (
      <footer className="border-t border-[var(--vex-line)] px-4 py-3 text-xs text-[var(--vex-text-3)]">
        Use the <span className="text-[var(--vex-accent-text)]">Start mission</span> button below to dispatch.
      </footer>
    );
  }
  if (currentHash === null) return null;
  const isDirty = kind === "dirty-acceptance";
  return (
    <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--vex-line)] px-4 py-3">
      <span className="text-xs text-[var(--vex-text-3)]">
        {isDirty
          ? "Re-accept to bring the runtime back in sync with the draft."
          : "Accepting locks the contract for this mission run."}
      </span>
      {/* Accent-hairline key — the signing action stays quiet until hovered. */}
      <Button
        type="button"
        onClick={() => onAccept(currentHash)}
        disabled={pending}
        data-vex-action="accept-contract"
        className="h-8 border border-[var(--vex-accent-border)] bg-transparent px-3 text-xs text-[var(--vex-accent-text)] hover:bg-[var(--vex-accent-fill-8)]"
      >
        {pending ? "Accepting…" : isDirty ? "Accept new contract" : "Accept contract"}
      </Button>
    </footer>
  );
}
