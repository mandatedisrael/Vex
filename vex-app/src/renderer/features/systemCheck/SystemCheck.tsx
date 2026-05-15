/**
 * System Check screen — second user-facing surface in the onboarding flow.
 *
 * Visual system mirrors IntroScreen.tsx: a full-bleed anime portrait
 * (`onboarding.png`) covers the viewport, the dark right portion of the
 * image hosts a frosted-glass card with the probe stack, and the Begin-
 * style accent (#3275f8 via `--systemcheck-accent`) carries the same
 * onboarding identity as the intro.
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
 * already in the bundle.
 */

import { useEffect, useMemo, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowRight01Icon,
  Radar02Icon,
  Settings02Icon,
  Wifi02Icon,
} from "@hugeicons/core-free-icons";
import { Apple, Docker, Linux, Windows } from "@thesvg/react";

import { useDockerStatus } from "../../lib/api/docker.js";
import { useEnvState } from "../../lib/api/onboarding.js";
import { useSystemHealth } from "../../lib/api/system.js";
import { useUiStore } from "../../stores/uiStore.js";
import { cn } from "../../lib/utils.js";
import { WIZARD_STEP_IDS } from "@shared/schemas/wizard.js";
import { StepRow, type StepStatus } from "./StepRow.js";

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

type Platform = "win32" | "darwin" | "linux" | "other";

function platformOf(platformRaw: string | undefined): Platform {
  switch (platformRaw) {
    case "win32":
    case "darwin":
    case "linux":
      return platformRaw;
    default:
      return "other";
  }
}

function OperatingSystemIcon({ platform }: { platform: Platform }): JSX.Element {
  const commonProps = { width: 22, height: 22, "aria-hidden": true } as const;
  switch (platform) {
    case "win32":
      return <Windows {...commonProps} />;
    case "darwin":
      return <Apple {...commonProps} />;
    case "linux":
      return <Linux {...commonProps} />;
    default:
      return (
        <HugeiconsIcon icon={Settings02Icon} size={22} aria-hidden />
      );
  }
}

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

  return (
    <div
      data-vex-onboarding="true"
      data-vex-screen="systemCheck"
      className="relative h-screen w-screen overflow-hidden bg-[var(--color-bg-primary)] text-[var(--color-text-primary)]"
    >
      {/* BACKGROUND — full-bleed 16:9 portrait, character left, dark right */}
      <img
        src="/onboarding.png"
        alt=""
        aria-hidden
        draggable={false}
        className="absolute inset-0 h-full w-full object-cover object-center"
      />
      {/* Right-side gradient — deepens the dark area for content legibility */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-gradient-to-r from-transparent via-transparent to-[rgba(5,8,22,0.6)]"
      />

      {/* TOP-RIGHT LOGO — matches the brand mark in IntroScreen */}
      <div className="pointer-events-none absolute right-8 top-6">
        <img
          src="/logo_clean.png"
          alt=""
          aria-hidden
          draggable={false}
          className="h-10 w-10 object-contain drop-shadow-[0_2px_8px_rgba(50,117,248,0.35)]"
        />
      </div>

      {/* CONTENT — right-aligned glass card, vertically centered */}
      <section
        aria-labelledby="systemcheck-heading"
        className="relative ml-auto flex h-full w-[44%] min-w-[420px] max-w-[560px] flex-col items-center justify-center px-8"
      >
        <motion.div
          initial={reducedMotion ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: reducedMotion ? 0 : 0.45, ease: "easeOut" }}
          className={cn(
            "w-full overflow-hidden rounded-3xl border border-white/[0.12] bg-white/[0.05] backdrop-blur-2xl",
            "shadow-[inset_0_1px_0_rgba(255,255,255,0.14),inset_0_-1px_0_rgba(0,0,0,0.2),0_18px_60px_rgba(0,0,0,0.45)]",
          )}
        >
          {/* HEADER */}
          <header className="flex items-start gap-3 border-b border-white/[0.06] px-6 py-5">
            <span
              aria-hidden
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/[0.1] bg-[var(--systemcheck-accent)]/15 text-[var(--systemcheck-accent)]"
            >
              <HugeiconsIcon icon={Radar02Icon} size={22} aria-hidden />
            </span>
            <div className="flex flex-col gap-1">
              <h1
                id="systemcheck-heading"
                className="text-xl font-semibold tracking-tight text-[var(--color-text-primary)]"
              >
                System Check
              </h1>
              <p className="text-xs text-[var(--color-text-secondary)]">
                Verifying your environment before bootstrap.
              </p>
            </div>
          </header>

          {/* ROWS */}
          <ol className="flex flex-col gap-2 px-5 py-5">
            {revealCount >= 1 ? (
              <StepRow
                label="Operating system"
                status={osStatus}
                icon={<OperatingSystemIcon platform={platform} />}
                detail={
                  health.data?.ok
                    ? `${formatPlatform(health.data.data.os.platform, health.data.data.os.distro)} · Electron ${health.data.data.os.electronVersion}`
                    : null
                }
              />
            ) : null}
            {revealCount >= 2 ? (
              <StepRow
                label="Network connectivity"
                status={networkStatus}
                icon={<HugeiconsIcon icon={Wifi02Icon} size={22} aria-hidden />}
                detail={
                  health.data?.ok
                    ? health.data.data.network.online
                      ? `online · ${health.data.data.network.latencyMs ?? "?"} ms`
                      : "offline — agent will run with limited capabilities"
                    : null
                }
              />
            ) : null}
            {revealCount >= 3 ? (
              <StepRow
                label="Docker Engine"
                status={dockerStatus}
                icon={<Docker width={22} height={22} aria-hidden />}
                // "READY" reads more accurately than "OK" for an engine
                // that's installed + daemon running + container available.
                // Other states fall back to StepRow defaults (CHECKING…/WARN/FAIL).
                badgeLabel={dockerStatus === "ok" ? "READY" : undefined}
                detail={
                  docker.data?.ok
                    ? formatDockerDetail(docker.data.data)
                    : null
                }
              />
            ) : null}
            {revealCount >= 4 ? (
              <StepRow
                label="Vex configuration"
                status={envStatus}
                icon={
                  <HugeiconsIcon icon={Settings02Icon} size={22} aria-hidden />
                }
                // First-run nudge: "SETUP" beats "WARN" for a warn state that
                // means "guided setup required" — the only warn cause for
                // env config currently. Other states use defaults.
                badgeLabel={envStatus === "warn" ? "SETUP" : undefined}
                detail={
                  env.data?.ok ? formatEnvDetail(env.data.data) : null
                }
              />
            ) : null}
          </ol>

          {/* FOOTER — step counter + Continue */}
          <div className="flex items-center justify-between border-t border-white/[0.06] px-6 py-4">
            <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-[var(--color-text-muted)]">
              Step {SYSTEM_CHECK_STEP} of {TOTAL_ONBOARDING_STEPS}
            </span>
          </div>
          <div className="px-5 pb-5">
            <button
              type="button"
              disabled={anyLoading}
              onClick={() => setCurrentView("dockerBootstrap")}
              aria-label="Continue to Docker bootstrap"
              className={cn(
                "group relative inline-flex w-full items-center justify-center gap-3",
                "rounded-2xl border border-white/[0.16] bg-[var(--systemcheck-accent)]/85 backdrop-blur-xl",
                "px-6 py-3.5 font-mono text-sm uppercase tracking-[0.22em] text-white",
                "shadow-[inset_0_1px_0_rgba(255,255,255,0.22),0_10px_40px_rgba(50,117,248,0.28)]",
                "transition-all duration-300 ease-out",
                "hover:bg-[var(--systemcheck-accent)] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.26),0_14px_50px_rgba(50,117,248,0.42)]",
                "active:scale-[0.98] active:duration-100",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--systemcheck-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-bg-primary)]",
                "disabled:cursor-not-allowed disabled:opacity-60",
              )}
            >
              <span>Continue</span>
              <HugeiconsIcon
                icon={ArrowRight01Icon}
                size={16}
                aria-hidden
                className="transition-transform duration-300 group-hover:translate-x-0.5"
              />
            </button>
          </div>
        </motion.div>
      </section>

    </div>
  );
}

function formatPlatform(
  platform: string,
  distro: string | null | undefined,
): string {
  const labelByPlatform: Record<string, string> = {
    win32: "Windows",
    darwin: "macOS",
    linux: "Linux",
  };
  const base = labelByPlatform[platform] ?? platform;
  return distro ? `${base} · ${distro}` : base;
}

function formatDockerDetail(
  status: import("@shared/schemas/docker.js").DockerStatus,
): string {
  if (!status.endpoint.accepted) {
    return status.endpoint.message ?? "Docker endpoint rejected.";
  }
  const engine = status.engine.present
    ? `Docker ${status.engine.version ?? "?"}`
    : "Docker not found";
  const daemon = status.daemon.running ? "daemon running" : "daemon stopped";
  const compose = status.compose.present
    ? `Compose ${status.compose.version ?? "?"}`
    : "Compose missing";
  return `${engine} · ${daemon} · ${compose}`;
}

function formatEnvDetail(
  state: import("@shared/schemas/onboarding.js").EnvState,
): string {
  if (state.setupCompleteFlag) return "Setup previously completed.";
  const parts: string[] = [];
  if (state.walletStatus.evm === "present") parts.push("EVM keystore present");
  if (state.walletStatus.solana === "present")
    parts.push("Solana keystore present");
  if (state.embeddings.configured) parts.push("Embeddings configured");
  return parts.length > 0
    ? `Partial config: ${parts.join(", ")}.`
    : "First run — guided setup required.";
}
