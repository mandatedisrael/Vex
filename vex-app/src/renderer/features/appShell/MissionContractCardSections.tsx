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
    <header className="flex items-center justify-between gap-3 border-b border-white/[0.06] px-4 py-3">
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
      <span
        className={cn(
          "rounded-md px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em]",
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
        iconClass: "text-[#8da5ff]",
        badge: "Setup needed",
        badgeClass: "text-[var(--color-text-muted)]",
        dataState: "setup-needed",
      };
    case "awaiting-acceptance":
      return {
        icon: InformationCircleIcon,
        iconClass: "text-[#8da5ff]",
        badge: "Awaiting acceptance",
        badgeClass: "text-[#8da5ff]",
        dataState: "awaiting-acceptance",
      };
    case "accepted":
      return {
        icon: CheckmarkCircle02Icon,
        iconClass: "text-emerald-400",
        badge: "Accepted",
        badgeClass: "text-emerald-300",
        dataState: "accepted",
      };
    case "dirty-acceptance":
      return {
        icon: InformationCircleIcon,
        iconClass: "text-amber-300",
        badge: "Contract changed",
        badgeClass: "text-amber-300",
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
    <div className="space-y-3 px-4 py-3 text-[var(--color-text-secondary)]">
      <Field label="Goal">
        <p className="text-foreground">
          {draft.goal?.trim() || (
            <span className="italic text-[var(--color-text-muted)]">
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
        <p className="text-xs italic text-[var(--color-text-muted)]">
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
      <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-text-muted)]">
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
          className="rounded-md border border-white/[0.06] px-2 py-0.5 font-mono text-[11px] text-foreground"
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
      <footer className="border-t border-white/[0.06] px-4 py-3 text-xs text-[var(--color-text-muted)]">
        Add a goal, constraints, and stop conditions to enable Accept.
      </footer>
    );
  }
  if (kind === "accepted") {
    return (
      <footer className="border-t border-white/[0.06] px-4 py-3 text-xs text-[var(--color-text-muted)]">
        Type <span className="font-mono text-[#8da5ff]">/mission start</span> to dispatch.
      </footer>
    );
  }
  if (currentHash === null) return null;
  const isDirty = kind === "dirty-acceptance";
  return (
    <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.06] px-4 py-3">
      <span className="text-xs text-[var(--color-text-muted)]">
        {isDirty
          ? "Re-accept to bring the runtime back in sync with the draft."
          : "Accepting locks the contract for this mission run."}
      </span>
      <Button
        type="button"
        onClick={() => onAccept(currentHash)}
        disabled={pending}
        data-vex-action="accept-contract"
        className="h-8 px-3 text-xs bg-[#3758ff] text-white hover:bg-[#4668ff]"
      >
        {pending ? "Accepting…" : isDirty ? "Accept new contract" : "Accept contract"}
      </Button>
    </footer>
  );
}
