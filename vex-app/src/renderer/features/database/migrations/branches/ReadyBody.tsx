/**
 * Branch: ready — `database.migrate()` returned `kind: "applied"`.
 * Pairs a success StatusTile with a one-shot `dotm-hex-3` shimmer.
 *
 * Reduced-motion users skip the shimmer entirely — the check runs
 * synchronously in a lazy useState initializer so there's no
 * first-paint flash (codex Compose post-impl SHOULD-FIX #3 pattern
 * reused). The orchestrator passes `celebrate: true` explicitly when
 * setPhase flipped to ready, so the body doesn't need to mutate any
 * refs during render.
 */

import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { HugeiconsIcon } from "@hugeicons/react";
import { CheckmarkCircle01Icon } from "@hugeicons/core-free-icons";
import { StatusTile } from "../../../../components/onboarding/StatusTile.js";
import { DotmHex3 } from "../../../../components/ui/dotm-hex-3.js";

const COMPLETION_SHIMMER_MS = 800;

interface ReadyBodyProps {
  readonly appliedCount: number;
  readonly celebrate: boolean;
}

function reducedMotionAtMount(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function ReadyBody({
  appliedCount,
  celebrate,
}: ReadyBodyProps): JSX.Element {
  const [showShimmer, setShowShimmer] = useState(
    () => celebrate && !reducedMotionAtMount(),
  );
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!showShimmer) return;
    timerRef.current = window.setTimeout(
      () => setShowShimmer(false),
      COMPLETION_SHIMMER_MS,
    );
    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    };
  }, [showShimmer]);

  const word = appliedCount === 1 ? "migration" : "migrations";
  const detail = `${appliedCount} ${word} applied — schema is up to date.`;

  return (
    <div className="flex flex-col items-center gap-4">
      {showShimmer ? (
        <motion.div
          initial={{ opacity: 0, scale: 0.85 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.4, ease: "easeOut" }}
          aria-hidden
        >
          <DotmHex3 size={56} color="var(--vex-onboarding-accent)" />
        </motion.div>
      ) : null}

      <StatusTile
        tone="success"
        icon={
          <HugeiconsIcon icon={CheckmarkCircle01Icon} size={20} aria-hidden />
        }
        title="Schema updated"
        detail={detail}
      />
    </div>
  );
}
