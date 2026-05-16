/**
 * Database migrations orchestrator — 5th onboarding surface in the
 * Vex flow (intro → systemCheck → dockerBootstrap → composeBootstrap →
 * **migrations** → wizard). Visual system inherits the shared glass
 * aesthetic established by the four preceding screens
 * (`data-vex-onboarding="true"`, right-side iOS Liquid Glass panel,
 * full-bleed `setup.png` background, `--vex-onboarding-accent`).
 *
 * Flow:
 *   1. Subscribe to the progress bus BEFORE invoking `migrate()`. The
 *      bus replays the latest event to late subscribers, so the
 *      planned/total handshake survives StrictMode double-mount and
 *      single-flight join.
 *   2. Run `window.vex.database.migrate()`. On success, invalidate the
 *      onboarding envState query (migrate seeds embedding env defaults
 *      so the wizard sees fresh values).
 *   3. Dispatch to a per-kind branch body (Running / Noop / Ready /
 *      Error). Noop auto-advances to the wizard after
 *      NOOP_AUTO_ADVANCE_MS; Ready waits for Continue; Error offers
 *      Retry (no cancel — SQL aborts aren't safe, the IPC contract
 *      intentionally omits a cancel handle).
 *
 * StrictMode safety: cleanup uses a `cancelled` flag to suppress stale
 * promise resolutions, never calls a cancel handle (none exists).
 *
 * Progress regression guard: the progress callback updates `current`
 * via a functional setState that only mutates while `phase.kind ===
 * "running"`, so a late event cannot pull a terminal state back into
 * running (codex review v2 constraint #3).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { useQueryClient } from "@tanstack/react-query";
import { HugeiconsIcon } from "@hugeicons/react";
import { DatabaseSync01Icon } from "@hugeicons/core-free-icons";

import { useUiStore } from "../../stores/uiStore.js";
import { onboardingKeys } from "../../lib/api/queryKeys.js";
import { cn } from "../../lib/utils.js";
import { ContinueButton } from "../../components/onboarding/FooterButtons.js";
import {
  APPLIED_HISTORY_MAX,
  MIGRATIONS_STEP,
  NOOP_AUTO_ADVANCE_MS,
  TOTAL_ONBOARDING_STEPS,
} from "./migrations/constants.js";
import type { Phase } from "./migrations/types.js";
import { extractFailedAt } from "./migrations/extractFailedAt.js";
import { RunningBody } from "./migrations/branches/RunningBody.js";
import { NoopBody } from "./migrations/branches/NoopBody.js";
import { ReadyBody } from "./migrations/branches/ReadyBody.js";
import { ErrorBody } from "./migrations/branches/ErrorBody.js";

export function Migrations(): JSX.Element {
  const openWizard = useUiStore((s) => s.openWizard);
  const queryClient = useQueryClient();
  const reducedMotion = useReducedMotion();
  const [phase, setPhase] = useState<Phase>({ kind: "running", current: null });
  const [retryToken, setRetryToken] = useState(0);
  // History of `applied`-phase files, snapshot into ErrorBody on
  // failure. Stored in a ref (not state) so the migrate effect's
  // closure reads the latest value at the moment of error capture
  // without needing to re-run on every progress event (codex post-impl
  // SHOULD-FIX P2 — stale closure fix).
  const appliedHistoryRef = useRef<readonly string[]>([]);

  // Subscribe BEFORE invoking migrate so the bus's replay-on-subscribe
  // covers the early planned/start handshake even if the renderer
  // mounts a tick after main has emitted.
  useEffect(() => {
    const off = window.vex.database.onProgress((payload) => {
      if (payload.phase === "applied") {
        // Bounded buffer — codex post-impl SHOULD-FIX P3.
        appliedHistoryRef.current = [
          ...appliedHistoryRef.current,
          payload.file,
        ].slice(-APPLIED_HISTORY_MAX);
      }
      // Update `current` only while the phase is still running. A late
      // event must not pull a terminal phase back into running.
      setPhase((prev) =>
        prev.kind === "running" ? { kind: "running", current: payload } : prev,
      );
    });
    return () => off();
  }, []);

  useEffect(() => {
    let cancelled = false;
    setPhase({ kind: "running", current: null });

    void (async () => {
      try {
        const result = await window.vex.database.migrate();
        if (cancelled) return;
        if (!result.ok) {
          const failedAt = extractFailedAt(result.error.details);
          setPhase({
            kind: "error",
            message: result.error.message,
            failedAt,
            appliedBeforeFailure: appliedHistoryRef.current,
          });
          return;
        }
        // Migrate seeds embedding env defaults — invalidate the
        // envState query so the wizard sees fresh values without
        // waiting for the staleTime window.
        await queryClient.invalidateQueries({
          queryKey: onboardingKeys.envState(),
        });
        const data = result.data;
        if (data.kind === "applied") {
          setPhase({ kind: "ready", appliedCount: data.applied });
        } else {
          setPhase({ kind: "noop" });
        }
      } catch (err: unknown) {
        if (cancelled) return;
        setPhase({
          kind: "error",
          message: err instanceof Error ? err.message : "Unknown error",
          failedAt: null,
          appliedBeforeFailure: appliedHistoryRef.current,
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [retryToken, queryClient]);

  // Auto-advance the noop branch to the wizard after a short
  // confirmation flash. Effect scope keeps the timer cleanly scoped
  // (no timer ref smuggled into phase state — codex review v2 #4).
  useEffect(() => {
    if (phase.kind !== "noop") return;
    const timer = window.setTimeout(
      () => openWizard("setup"),
      NOOP_AUTO_ADVANCE_MS,
    );
    return () => window.clearTimeout(timer);
  }, [phase.kind, openWizard]);

  const handleRetry = useCallback((): void => {
    appliedHistoryRef.current = [];
    setRetryToken((n) => n + 1);
  }, []);

  const handleContinue = useCallback((): void => {
    openWizard("setup");
  }, [openWizard]);

  return (
    <div
      data-vex-onboarding="true"
      data-vex-screen="migrations"
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
        aria-labelledby="migrations-heading"
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
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/[0.1] bg-[var(--vex-onboarding-accent)]/15 text-[var(--vex-onboarding-accent)]"
            >
              <HugeiconsIcon icon={DatabaseSync01Icon} size={22} aria-hidden />
            </span>
            <div className="flex flex-col gap-1">
              <h1
                id="migrations-heading"
                className="text-xl font-semibold tracking-tight text-[var(--color-text-primary)]"
              >
                Database migrations
              </h1>
              <p className="text-xs text-[var(--color-text-secondary)]">
                Bringing your local schema up to date.
              </p>
            </div>
          </header>

          <div className="flex-1 overflow-y-auto px-5 py-5">
            {phase.kind === "running" ? (
              <RunningBody current={phase.current} />
            ) : phase.kind === "noop" ? (
              <NoopBody />
            ) : phase.kind === "ready" ? (
              <ReadyBody appliedCount={phase.appliedCount} celebrate={true} />
            ) : phase.kind === "error" ? (
              <ErrorBody
                message={phase.message}
                failedAt={phase.failedAt}
                appliedBeforeFailure={phase.appliedBeforeFailure}
                onRetry={handleRetry}
              />
            ) : null}
          </div>

          <div className="flex items-center justify-between gap-3 border-t border-white/[0.06] px-6 py-4">
            <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-[var(--color-text-muted)]">
              Step {MIGRATIONS_STEP} of {TOTAL_ONBOARDING_STEPS}
            </span>
            {phase.kind === "ready" ? (
              <ContinueButton onClick={handleContinue} />
            ) : null}
          </div>
        </motion.div>
      </section>
    </div>
  );
}
