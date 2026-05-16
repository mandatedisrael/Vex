/**
 * Glass panel chrome for each wizard step — matches the onboarding
 * aesthetic shared with SystemCheck, BootstrapPanel, ComposeBootstrap,
 * and Migrations.
 *
 * Three important contracts:
 *
 *   1. `panelDataAttr` carries the exact `data-vex-wizard-${kind}={value}`
 *      attribute that the step's tests rely on (grep
 *      `vex-app/src/renderer/features/wizard/steps/**\/__tests__/`).
 *      It is a discriminated union so a typo in either the key or
 *      the value fails at compile time (codex round 2 BLOCKED #1).
 *
 *   2. When the step needs a `<form>` (KeystoreStep, ApiKeysStep,
 *      EmbeddingStep, AgentCoreStep, ProviderStep), the form wraps
 *      BOTH the scrollable body AND the footer so the submit button
 *      stays a descendant of `<form>` — preserves Enter-submit and the
 *      existing testing-library form selectors (codex round 1 BLOCKED #2).
 *
 *   3. The footer chip ("Step X / 7 · Your data stays yours →") is
 *      derived from `panelDataAttr.kind` via a typed `PANEL_KIND_TO_STEP_ID`
 *      map. Each step does NOT pass `stepIndex` / `totalSteps` props —
 *      one source of truth, fewer mistakes (codex review V2 #3).
 *
 * Motion is NOT applied here — the outer `WizardShell` owns
 * `AnimatePresence` keyed by the current step id; the panel itself
 * is a plain `<div>` so transitions are not double-wrapped.
 */

import type { FormEvent, ReactNode } from "react";

import { HugeiconsIcon } from "@hugeicons/react";
import type { HugeiconsIconProps } from "@hugeicons/react";
import { ArrowUpRight01Icon } from "@hugeicons/core-free-icons";
import {
  WIZARD_STEP_IDS,
  type WizardStepId,
} from "@shared/schemas/wizard.js";

import { cn } from "../../lib/utils.js";

type IconDescriptor = HugeiconsIconProps["icon"];

export type WizardPanelDataAttr =
  | { readonly kind: "keystore"; readonly value: "form" | "skip" }
  | { readonly kind: "wallets"; readonly value: "loading" | "ready" | "setup" }
  | { readonly kind: "apikeys"; readonly value: "form" | "skip" }
  | { readonly kind: "embedding"; readonly value: "form" | "skip" }
  | { readonly kind: "agentcore"; readonly value: "form" }
  | { readonly kind: "provider"; readonly value: "form" | "skip" }
  | { readonly kind: "review"; readonly value: "loading" | "form" };

export interface WizardStepPanelFormProps {
  readonly onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  readonly noValidate?: boolean;
  /**
   * Some steps (currently only ProviderStep) carry an additional
   * `data-vex-wizard-provider-form="openrouter"` attribute on their
   * `<form>`. Forwarded verbatim onto the form element when present.
   */
  readonly providerFormAttr?: "openrouter";
}

export interface WizardStepPanelProps {
  readonly icon: IconDescriptor;
  readonly title: string;
  readonly description: ReactNode;
  readonly panelDataAttr: WizardPanelDataAttr;
  readonly footer: ReactNode;
  readonly children: ReactNode;
  readonly formProps?: WizardStepPanelFormProps;
}

type PanelKind = WizardPanelDataAttr["kind"];

/**
 * Typed map from `WizardPanelDataAttr.kind` (lowercase / kebab-ish
 * naming used in the test attrs) to the canonical `WizardStepId`
 * (camelCase, from `WIZARD_STEP_IDS`). Keeping both forms in one
 * place avoids ad-hoc string mangling at the call site.
 */
const PANEL_KIND_TO_STEP_ID: Readonly<Record<PanelKind, WizardStepId>> = {
  keystore: "keystore",
  wallets: "wallets",
  apikeys: "apiKeys",
  embedding: "embedding",
  agentcore: "agentCore",
  provider: "provider",
  review: "review",
};

const TOTAL_WIZARD_STEPS = WIZARD_STEP_IDS.length;

function stepIndexFor(kind: PanelKind): number {
  return WIZARD_STEP_IDS.indexOf(PANEL_KIND_TO_STEP_ID[kind]);
}

/*
 * `max-h-[calc(100vh-13rem)]` derives from the shell layout: pt-24
 * (96px) + stepper (~56px) + gap-6 (24px) + pb-8 (32px) ≈ 208px =
 * 13rem of fixed chrome around the panel. Keeps the body scrollable
 * inside the 1024×720 BrowserWindow floor (codex final review V2 P1).
 */
const PANEL_CHROME = cn(
  "flex w-full max-h-[calc(100vh-13rem)] flex-col overflow-hidden rounded-3xl",
  "border border-white/[0.12] bg-white/[0.05] backdrop-blur-2xl",
  "shadow-[inset_0_1px_0_rgba(255,255,255,0.14),inset_0_-1px_0_rgba(0,0,0,0.2),0_18px_60px_rgba(0,0,0,0.45)]",
);

const HEADER_CHROME = cn(
  "flex shrink-0 items-start gap-3 border-b border-white/[0.06] px-6 py-5",
);

const ICON_TILE_CHROME = cn(
  "flex h-10 w-10 shrink-0 items-center justify-center",
  "rounded-xl border border-white/[0.1]",
  "bg-[var(--vex-onboarding-accent)]/15 text-[var(--vex-onboarding-accent)]",
);

const BODY_CHROME = cn("flex-1 overflow-y-auto px-5 py-5");
const FOOTER_CHROME = cn(
  "flex shrink-0 items-center justify-between gap-3 border-t border-white/[0.06] px-6 py-4",
);
const FOOTER_META_CHROME = cn(
  "flex items-center gap-3 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-text-muted)]",
);

function FooterMeta({ kind }: { kind: PanelKind }): JSX.Element {
  const stepIndex = stepIndexFor(kind);
  return (
    <div className={FOOTER_META_CHROME}>
      <span>
        Step {stepIndex + 1} / {TOTAL_WIZARD_STEPS}
      </span>
      <span aria-hidden>·</span>
      <a
        href="https://docs.vex.ai/security/local-vault"
        target="_blank"
        rel="noopener noreferrer"
        className={cn(
          "inline-flex items-center gap-1 text-[var(--color-text-secondary)] transition-colors",
          "hover:text-[var(--vex-onboarding-accent)]",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--vex-onboarding-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-bg-primary)]",
        )}
      >
        Your data stays yours
        <HugeiconsIcon icon={ArrowUpRight01Icon} size={10} aria-hidden />
      </a>
    </div>
  );
}

export function WizardStepPanel({
  icon,
  title,
  description,
  panelDataAttr,
  footer,
  children,
  formProps,
}: WizardStepPanelProps): JSX.Element {
  const dataAttrKey = `data-vex-wizard-${panelDataAttr.kind}` as const;
  // Mapping the discriminated union to a single dynamic-key spread keeps
  // the rest of the component identical between the seven steps; the
  // type system guarantees the (kind, value) pair is valid.
  const dataAttrs = { [dataAttrKey]: panelDataAttr.value };

  const headerNode = (
    <header className={HEADER_CHROME}>
      <span aria-hidden className={ICON_TILE_CHROME}>
        <HugeiconsIcon icon={icon} size={22} aria-hidden />
      </span>
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight text-[var(--color-text-primary)]">
          {title}
        </h1>
        <p className="text-xs text-[var(--color-text-secondary)]">
          {description}
        </p>
      </div>
    </header>
  );

  const footerNode = (
    <div className={FOOTER_CHROME}>
      <FooterMeta kind={panelDataAttr.kind} />
      <div className="flex items-center gap-3">{footer}</div>
    </div>
  );

  if (formProps) {
    const { onSubmit, noValidate, providerFormAttr } = formProps;
    const formExtraAttrs = providerFormAttr
      ? { "data-vex-wizard-provider-form": providerFormAttr }
      : {};
    return (
      <div {...dataAttrs} className={PANEL_CHROME}>
        {headerNode}
        {/*
          `min-h-0` allows the inner overflow body to actually shrink
          inside the flex column (without it the scroll container grows
          past the panel's max-h on long forms).
        */}
        <form
          onSubmit={onSubmit}
          noValidate={noValidate ?? false}
          {...formExtraAttrs}
          className="flex min-h-0 flex-1 flex-col"
        >
          <div className={BODY_CHROME}>{children}</div>
          {footerNode}
        </form>
      </div>
    );
  }

  return (
    <div {...dataAttrs} className={PANEL_CHROME}>
      {headerNode}
      <div className={BODY_CHROME}>{children}</div>
      {footerNode}
    </div>
  );
}
