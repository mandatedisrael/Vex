/**
 * Sidebar footer key — opens the Mission History ledger sub-view
 * (mission-results-ledger, WP-J). Mirrors `MemoryButton`: a quiet
 * full-width registry row carrying its own border-t hairline so the footer
 * stack stays separated.
 */

import { useCallback, type JSX } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { AnalyticsUpIcon } from "@hugeicons/core-free-icons";
import { Button } from "../../components/ui/button.js";
import { cn } from "../../lib/utils.js";
import { useUiStore } from "../../stores/uiStore.js";

interface MissionsButtonProps {
  readonly compact?: boolean;
}

export function MissionsButton({ compact = false }: MissionsButtonProps): JSX.Element {
  const setAppShellView = useUiStore((s) => s.setAppShellView);
  const onClick = useCallback((): void => {
    setAppShellView("missionHistory");
  }, [setAppShellView]);

  return (
    <Button
      variant="ghost"
      size={compact ? "icon" : "sm"}
      onClick={onClick}
      aria-label="Open mission history"
      className={cn(
        "h-9 w-full rounded-none border-0 border-t border-[var(--vex-line)] bg-transparent text-[10px] tracking-[0.18em] text-[var(--vex-text-2)] hover:bg-white/[0.035] hover:text-foreground",
        compact ? "justify-center px-0" : "justify-start gap-2 px-4",
      )}
    >
      <HugeiconsIcon icon={AnalyticsUpIcon} size={15} aria-hidden />
      {compact ? null : <span>Missions</span>}
    </Button>
  );
}
