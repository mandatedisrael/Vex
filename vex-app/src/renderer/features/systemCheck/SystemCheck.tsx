/**
 * System Check screen — second user-facing surface in the onboarding
 * flow, redesigned in the Countersign language ("NOTARY — page two of
 * the signed document").
 *
 * Visual system: the user just watched the Vex signature being written
 * and countersigned it with BEGIN; this screen is the same instrument
 * page getting notarized. Same near-black canvas as the intro
 * (--systemcheck-bg = --vex-onboarding-bg), the signature settled to a
 * 48px letterhead hallmark (no glow — the glow belonged to the act of
 * signing), a plinth hairline with a 24px accent tick, and four numbered
 * ledger rows that stamp themselves as probes resolve. The CONTINUE key
 * is dormant from frame one in the same 208×44 slot BEGIN occupied
 * (shared geometry module) and arms in place when the gate opens. No
 * photo, no glass, no card — hairlines and mono microtype carry the
 * material. Entrance is a hard cut: chrome stands on frame one, only
 * the ledger rows cascade.
 *
 * Data flow is unchanged: three TanStack Query hooks (`useSystemHealth`,
 * `useDockerStatus`, `useEnvState`) feed four probe rows, each row
 * computes its `StepStatus` from the Result envelope, and the cascade
 * reveal uses the existing `motion-cascade-row` CSS @keyframes (CSP-safe).
 *
 * M11.5.4 — DMR (Docker Model Runner) is no longer surfaced here.
 * vex-app ships its own bundled embeddings runtime via Compose
 * (`embeddings-runtime` service). The `dockerStatusSchema.modelRunner`
 * block is retained unchanged for backward compatibility — the probe
 * still runs but no rendered surface consumes it.
 *
 * CSP: brand icons come from `@thesvg/react` (typed React components,
 * no `dangerouslySetInnerHTML` — `scripts/check-build-artifacts.mjs`
 * rejects that pattern). Generic UI glyphs come from `@hugeicons/react`,
 * already in the bundle. All multi-step animation is stylesheet
 * @keyframes.
 */

import { useEffect, useMemo, useState } from "react";
import { useReducedMotion } from "motion/react";

import { useDockerStatus } from "../../lib/api/docker.js";
import { useEnvState } from "../../lib/api/onboarding.js";
import { useSystemHealth } from "../../lib/api/system.js";
import { useUiStore } from "../../stores/uiStore.js";
import { NotaryPage } from "../../components/onboarding/NotaryPage.js";
import { WIZARD_STEP_IDS } from "@shared/schemas/wizard.js";
import { type StepStatus } from "./StepRow.js";
import { platformOf, type Platform } from "./SystemCheck/OperatingSystemIcon.js";
import { ProbeRows } from "./SystemCheck/ProbeRows.js";
import { Footer } from "./SystemCheck/Footer.js";

/**
 * Total onboarding steps surfaced in the "Step X of N" indicator.
 *
 * Composition: 4 top-level views the user passes through after the
 * intro (systemCheck, dockerBootstrap, composeBootstrap, migrations)
 * plus the wizard setup substeps (`WIZARD_STEP_IDS` minus the trailing
 * `review` confirmation, which is not a setup step). Derived from
 * `WIZARD_STEP_IDS` so adding/removing a wizard step does not leave
 * the counter silently drifting (codex round 7 SHOULD-FIX #4).
 */
const SETUP_VIEWS_BEFORE_WIZARD = 4;
const TOTAL_ONBOARDING_STEPS =
  SETUP_VIEWS_BEFORE_WIZARD + (WIZARD_STEP_IDS.length - 1);
const SYSTEM_CHECK_STEP = 1;
const TOTAL_PROBES = 4;

export function SystemCheck(): JSX.Element {
  const setCurrentView = useUiStore((s) => s.setCurrentView);
  const reducedMotion = useReducedMotion();
  const health = useSystemHealth();
  const docker = useDockerStatus();
  const env = useEnvState();

  // Under reduced motion render all rows immediately; otherwise stagger
  // them every 80ms for the cascade reveal that pairs with the
  // `motion-cascade-row` CSS animation. If `useReducedMotion()` flips
  // mid-mount (matchMedia change), the effect handles the transition
  // by setting revealCount to 4 directly rather than relying on the
  // initial lazy state (codex round 7-post SHOULD-FIX #3).
  const [revealCount, setRevealCount] = useState(() =>
    reducedMotion ? 4 : 0,
  );

  useEffect(() => {
    if (reducedMotion) {
      setRevealCount(4);
      return;
    }
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (let i = 1; i <= 4; i += 1) {
      timers.push(setTimeout(() => setRevealCount(i), i * 80));
    }
    return () => {
      for (const t of timers) clearTimeout(t);
    };
  }, [reducedMotion]);

  const platform = useMemo<Platform>(
    () => platformOf(health.data?.ok ? health.data.data.os.platform : undefined),
    [health.data],
  );

  const osStatus: StepStatus = health.isPending
    ? "loading"
    : health.data?.ok
      ? "ok"
      : "fail";

  const networkStatus: StepStatus = health.isPending
    ? "loading"
    : health.data?.ok && health.data.data.network.online
      ? "ok"
      : "warn";

  const dockerStatus: StepStatus = docker.isPending
    ? "loading"
    : !docker.data?.ok
      ? "fail"
      : !docker.data.data.endpoint.accepted
        ? "fail"
        : !docker.data.data.engine.present || !docker.data.data.daemon.running
          ? "warn"
          : "ok";

  const envStatus: StepStatus = env.isPending
    ? "loading"
    : !env.data?.ok
      ? "fail"
      : env.data.data.setupCompleteFlag
        ? "ok"
        : "warn";

  const anyLoading = health.isPending || docker.isPending || env.isPending;
  const resolvedCount = [osStatus, networkStatus, dockerStatus, envStatus]
    .filter((s) => s !== "loading")
    .length;

  return (
    <NotaryPage
      screen="systemCheck"
      headingId="systemcheck-heading"
      title="System Check"
      subline="Four probes countersign this machine before bootstrap."
      stepNumber={SYSTEM_CHECK_STEP}
      totalSteps={TOTAL_ONBOARDING_STEPS}
    >
      {/* LEDGER — four numbered rows, cascade-revealed. */}
      <div className="mt-6">
        <ProbeRows
          revealCount={revealCount}
          platform={platform}
          osStatus={osStatus}
          networkStatus={networkStatus}
          dockerStatus={dockerStatus}
          envStatus={envStatus}
          health={health}
          docker={docker}
          env={env}
        />
      </div>

      {health.data?.ok && health.data.data.translocated ? (
        <div
          role="alert"
          className="mt-5 rounded-md border border-[color-mix(in_oklab,var(--color-danger)_40%,transparent)] bg-[color-mix(in_oklab,var(--color-danger)_10%,transparent)] px-4 py-3 text-sm text-[var(--color-danger)]"
        >
          Vex is running from a quarantined location (App Translocation). Move
          Vex.app to /Applications in Finder and relaunch.
        </div>
      ) : null}

      <Footer
        resolvedCount={resolvedCount}
        totalProbes={TOTAL_PROBES}
        disabled={anyLoading}
        onContinue={() => setCurrentView("dockerBootstrap")}
      />
    </NotaryPage>
  );
}
