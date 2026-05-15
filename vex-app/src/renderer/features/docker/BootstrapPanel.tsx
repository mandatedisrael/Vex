/**
 * Docker bootstrap orchestrator — second user-facing surface in the
 * onboarding flow. Carries the same visual system as IntroScreen and
 * SystemCheck: full-bleed anime portrait background (`setup.png`),
 * right-side iOS Liquid Glass panel, electric-blue
 * `--dockerbootstrap-accent` scope.
 *
 * Branch dispatch lives here; the per-branch render is delegated to
 * the body components in `bootstrap/branches/`. Shared visual primitives
 * (status tile, primary button, docs link) live in `bootstrap/`.
 *
 * State machine:
 *   loading     — Docker probe in flight, OR engine missing + platform
 *                 still resolving (data wins when platform irrelevant).
 *   A           — engine + daemon running → ReadyBody + Continue.
 *   B           — engine present + daemon stopped → DaemonStoppedBody;
 *                 per-platform copy (Linux shows `sudo systemctl start`
 *                 because the main process only attempts the user-mode
 *                 Docker Desktop unit, never sudo).
 *   C-desktop   — mac/win, engine missing → DesktopInstallBody (in-app
 *                 installer download via LicenseNotice).
 *   C-linux     — linux, engine missing → LinuxInstallBody (auto-fetch
 *                 `linux_manual_instructions` IPC).
 *   D           — IPC/Result error OR endpoint rejected → FailureBody.
 *
 * Recheck (footer, always visible non-A) calls `dockerStatus.refetch()`
 * so the user never has to restart the app after fixing Docker.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { Docker } from "@thesvg/react";

import {
  useDockerInstall,
  useDockerStart,
  useDockerStatus,
} from "../../lib/api/docker.js";
import { useSystemHealth } from "../../lib/api/system.js";
import { useUiStore } from "../../stores/uiStore.js";
import { cn } from "../../lib/utils.js";
import { InstallProgressStrip } from "./InstallProgress.js";
import { LicenseNotice } from "./LicenseNotice.js";
import {
  DOCKER_BOOTSTRAP_STEP,
  TOTAL_ONBOARDING_STEPS,
} from "./bootstrap/constants.js";
import type {
  ActiveInstallMethod,
  Branch,
  ManualFetchState,
} from "./bootstrap/types.js";
import {
  ContinueButton,
  RecheckButton,
} from "../../components/onboarding/FooterButtons.js";
import { LoadingBody } from "./bootstrap/branches/LoadingBody.js";
import { ReadyBody } from "./bootstrap/branches/ReadyBody.js";
import { DaemonStoppedBody } from "./bootstrap/branches/DaemonStoppedBody.js";
import { DesktopInstallBody } from "./bootstrap/branches/DesktopInstallBody.js";
import { LinuxInstallBody } from "./bootstrap/branches/LinuxInstallBody.js";
import { FailureBody } from "./bootstrap/branches/FailureBody.js";

export function BootstrapPanel(): JSX.Element {
  const setCurrentView = useUiStore((s) => s.setCurrentView);
  const reducedMotion = useReducedMotion();
  const dockerStatus = useDockerStatus();
  const systemHealth = useSystemHealth();
  const installMutation = useDockerInstall();
  const startMutation = useDockerStart();

  const [licenseOpen, setLicenseOpen] = useState(false);
  const [activeInstallMethod, setActiveInstallMethod] =
    useState<ActiveInstallMethod>(null);
  const [manualFetchState, setManualFetchState] = useState<ManualFetchState>({
    kind: "idle",
  });
  const manualFetchRequestedRef = useRef(false);

  const platform = systemHealth.data?.ok
    ? systemHealth.data.data.os.platform
    : null;
  const branch = decideBranch(
    dockerStatus.data,
    platform,
    systemHealth.isPending,
  );

  // Single source of truth for the Linux manual-instructions IPC call.
  // Called both from the auto-fetch effect (on C-linux mount) and from
  // the explicit "Retry instructions fetch" handler (codex post-impl
  // SHOULD-FIX #1 — bare ref reset didn't re-trigger the effect because
  // neither `branch` nor `installMutation` changed).
  const fetchLinuxInstructions = useCallback(() => {
    manualFetchRequestedRef.current = true;
    setActiveInstallMethod("linux_manual_instructions");
    setManualFetchState({ kind: "loading" });
    installMutation.mutate(
      { method: "linux_manual_instructions" },
      {
        onSuccess: (data) => {
          if (data.ok && data.data.fallbackInstructions !== null) {
            setManualFetchState({
              kind: "ready",
              instructions: data.data.fallbackInstructions,
            });
          } else {
            setManualFetchState({
              kind: "error",
              message: data.ok
                ? "No instructions returned"
                : data.error.message,
            });
          }
        },
        onError: (err) => {
          setManualFetchState({
            kind: "error",
            message: err instanceof Error ? err.message : "Unknown error",
          });
        },
        onSettled: () => {
          setActiveInstallMethod(null);
        },
      },
    );
  }, [installMutation]);

  // Auto-fetch on entering C-linux. `manualFetchRequestedRef` guards
  // against effect re-runs while a fetch is in flight. Explicit retry
  // calls `fetchLinuxInstructions` directly so the effect deps don't
  // need to change.
  useEffect(() => {
    if (branch !== "C-linux") return;
    if (manualFetchRequestedRef.current) return;
    fetchLinuxInstructions();
  }, [branch, fetchLinuxInstructions]);

  const handleContinue = useCallback(() => {
    setCurrentView("composeBootstrap");
  }, [setCurrentView]);

  const handleStart = useCallback(() => {
    startMutation.mutate(undefined, {
      onSettled: () => {
        void dockerStatus.refetch();
      },
    });
  }, [startMutation, dockerStatus]);

  const handleDesktopInstall = useCallback(() => {
    setLicenseOpen(true);
  }, []);

  const handleLicenseAccepted = useCallback(() => {
    setLicenseOpen(false);
    setActiveInstallMethod("desktop_download");
    installMutation.mutate(
      { method: "desktop_download" },
      {
        onSettled: () => {
          setActiveInstallMethod(null);
          void dockerStatus.refetch();
        },
      },
    );
  }, [installMutation, dockerStatus]);

  const handleLicenseDismiss = useCallback(() => {
    setLicenseOpen(false);
  }, []);

  const handleRecheck = useCallback(() => {
    void dockerStatus.refetch();
  }, [dockerStatus]);

  const handleRetryInstructionsFetch = useCallback(() => {
    fetchLinuxInstructions();
  }, [fetchLinuxInstructions]);

  const showInstallProgress =
    activeInstallMethod === "desktop_download" && installMutation.isPending;
  // Disable Recheck while any probe/mutation is in flight, OR while the
  // branch is "loading" (which covers `systemHealth.isPending` cases
  // where dockerStatus may not be fetching but platform is still
  // resolving). Codex post-impl SHOULD-FIX #2.
  const recheckDisabled =
    installMutation.isPending ||
    startMutation.isPending ||
    dockerStatus.isFetching ||
    branch === "loading";

  return (
    <div
      data-vex-onboarding="true"
      data-vex-screen="dockerBootstrap"
      className="relative h-screen w-screen overflow-hidden bg-[var(--color-bg-primary)] text-[var(--color-text-primary)]"
    >
      <img
        src="/setup.png"
        alt=""
        aria-hidden
        draggable={false}
        className="absolute inset-0 h-full w-full object-cover object-center"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-gradient-to-r from-transparent via-transparent to-[rgba(5,8,22,0.6)]"
      />

      <div className="pointer-events-none absolute right-8 top-6">
        <img
          src="/logo_clean.png"
          alt=""
          aria-hidden
          draggable={false}
          className="h-10 w-10 object-contain drop-shadow-[0_2px_8px_rgba(50,117,248,0.35)]"
        />
      </div>

      <section
        aria-labelledby="dockerbootstrap-heading"
        className="relative ml-auto flex h-full w-[44%] min-w-[420px] max-w-[560px] flex-col items-center justify-center px-8"
      >
        <motion.div
          initial={reducedMotion ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: reducedMotion ? 0 : 0.45, ease: "easeOut" }}
          className={cn(
            "flex w-full max-h-[88vh] flex-col overflow-hidden rounded-3xl border border-white/[0.12] bg-white/[0.05] backdrop-blur-2xl",
            "shadow-[inset_0_1px_0_rgba(255,255,255,0.14),inset_0_-1px_0_rgba(0,0,0,0.2),0_18px_60px_rgba(0,0,0,0.45)]",
          )}
        >
          <header className="flex items-start gap-3 border-b border-white/[0.06] px-6 py-5">
            <span
              aria-hidden
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/[0.1] bg-[var(--dockerbootstrap-accent)]/15 text-[var(--dockerbootstrap-accent)]"
            >
              <Docker width={24} height={24} aria-hidden />
            </span>
            <div className="flex flex-col gap-1">
              <h1
                id="dockerbootstrap-heading"
                className="text-xl font-semibold tracking-tight text-[var(--color-text-primary)]"
              >
                Docker setup
              </h1>
              <p className="text-xs text-[var(--color-text-secondary)]">
                Vex runs Postgres + embeddings locally through Docker.
              </p>
            </div>
          </header>

          <div className="flex-1 overflow-y-auto px-5 py-5">
            {showInstallProgress ? (
              <InstallProgressStrip active />
            ) : branch === "loading" ? (
              <LoadingBody />
            ) : branch === "A" ? (
              <ReadyBody
                status={dockerStatus.data?.ok ? dockerStatus.data.data : null}
              />
            ) : branch === "B" ? (
              <DaemonStoppedBody
                platform={platform}
                starting={startMutation.isPending}
                startMessage={
                  startMutation.data?.ok
                    ? startMutation.data.data.message ?? null
                    : null
                }
                onStart={handleStart}
              />
            ) : branch === "C-desktop" ? (
              <DesktopInstallBody
                platform={platform}
                installing={installMutation.isPending}
                onInstall={handleDesktopInstall}
              />
            ) : branch === "C-linux" ? (
              <LinuxInstallBody
                state={manualFetchState}
                onRetryFetch={handleRetryInstructionsFetch}
              />
            ) : (
              <FailureBody status={dockerStatus.data} />
            )}
          </div>

          <div className="flex items-center justify-between gap-3 border-t border-white/[0.06] px-6 py-4">
            <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-[var(--color-text-muted)]">
              Step {DOCKER_BOOTSTRAP_STEP} of {TOTAL_ONBOARDING_STEPS}
            </span>
            {branch === "A" ? (
              <ContinueButton onClick={handleContinue} />
            ) : (
              <RecheckButton
                onClick={handleRecheck}
                disabled={recheckDisabled}
              />
            )}
          </div>
        </motion.div>
      </section>

      <LicenseNotice
        open={licenseOpen}
        onAccept={handleLicenseAccepted}
        onDismiss={handleLicenseDismiss}
      />
    </div>
  );
}

function decideBranch(
  result: ReturnType<typeof useDockerStatus>["data"],
  platform: string | null,
  platformPending: boolean,
): Branch {
  if (!result) return "loading";
  if (!result.ok) return "D";
  const status = result.data;
  if (!status.endpoint.accepted) return "D";

  // A — data wins when platform irrelevant; don't flicker to loading
  // while the health probe is pending (codex round 11 SHOULD-FIX #2).
  if (status.engine.present && status.daemon.running) return "A";

  // Below: platform matters (B copy varies by OS; C dispatches per OS).
  if (status.engine.present && !status.daemon.running) {
    if (platformPending) return "loading";
    return "B";
  }
  if (!status.engine.present) {
    if (platformPending) return "loading";
    if (platform === "darwin" || platform === "win32") return "C-desktop";
    if (platform === "linux") return "C-linux";
  }
  return "D";
}

