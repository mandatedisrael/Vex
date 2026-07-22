import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { DotMatrixPhase } from "./dotmatrix-core.js";

export function usePrefersReducedMotion(): boolean {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    // Guard for non-browser environments (e.g. jsdom tests without the
    // matchMedia polyfill installed).
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");

    const update = () => {
      setPrefersReducedMotion(query.matches);
    };

    update();
    query.addEventListener("change", update);

    return () => {
      query.removeEventListener("change", update);
    };
  }, []);

  return prefersReducedMotion;
}

export interface UseCyclePhaseOptions {
  active: boolean;
  cycleMsBase: number;
  speed?: number;
}

export function useCyclePhase({ active, cycleMsBase, speed = 1 }: UseCyclePhaseOptions): number {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    if (!active) {
      setPhase(0);
      return;
    }

    const safeSpeed = speed > 0 ? speed : 1;
    const raw = cycleMsBase / safeSpeed;
    const cycleMs = raw > 0 && Number.isFinite(raw) ? raw : 1000;
    const start = performance.now();
    let rafId = 0;

    const tick = (now: number) => {
      const elapsed = ((now - start) % cycleMs + cycleMs) % cycleMs;
      setPhase(elapsed / cycleMs);
      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [active, cycleMsBase, speed]);

  return phase;
}


interface UseDotMatrixPhasesOptions {
  animated?: boolean;
  hoverAnimated?: boolean;
  speed?: number;
}

interface DotMatrixPhasesResult {
  phase: DotMatrixPhase;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}

export function useDotMatrixPhases({
  animated = false,
  hoverAnimated = false,
  speed = 1
}: UseDotMatrixPhasesOptions): DotMatrixPhasesResult {
  const safeSpeed = speed > 0 ? speed : 1;
  const autoRun = Boolean(animated && !hoverAnimated);
  const [hoverPhase, setHoverPhase] = useState<DotMatrixPhase>("idle");
  const timeouts = useRef<number[]>([]);
  const hoverGen = useRef(0);

  const clearTimers = useCallback(() => {
    for (let i = 0; i < timeouts.current.length; i += 1) {
      window.clearTimeout(timeouts.current[i]!);
    }
    timeouts.current = [];
  }, []);

  useEffect(() => {
    hoverGen.current += 1;
    clearTimers();
    return clearTimers;
  }, [autoRun, hoverAnimated, clearTimers]);

  const onMouseEnter = useCallback(() => {
    if (!hoverAnimated || autoRun) {
      return;
    }
    clearTimers();
    const gen = ++hoverGen.current;
    setHoverPhase("collapse");
    const collapseMs = Math.max(1, Math.round(300 / safeSpeed));
    const id = window.setTimeout(() => {
      if (hoverGen.current !== gen) {
        return;
      }
      setHoverPhase("hoverRipple");
    }, collapseMs);
    timeouts.current.push(id);
  }, [hoverAnimated, autoRun, safeSpeed, clearTimers]);

  const onMouseLeave = useCallback(() => {
    if (!hoverAnimated || autoRun) {
      return;
    }
    hoverGen.current += 1;
    clearTimers();
    setHoverPhase("idle");
  }, [hoverAnimated, autoRun, clearTimers]);

  const phase: DotMatrixPhase = autoRun ? "loadingRipple" : hoverAnimated ? hoverPhase : "idle";

  return useMemo(
    () => ({
      phase,
      onMouseEnter,
      onMouseLeave
    }),
    [phase, onMouseEnter, onMouseLeave]
  );
}
