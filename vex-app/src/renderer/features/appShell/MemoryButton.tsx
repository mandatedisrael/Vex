/**
 * Sidebar button — opens the read-only Memory management panel
 * (stage 7-2a, S9 rewire). Rendered ONLY when the `memory` capability is
 * enabled, so the affordance never appears before the feature is wired.
 */

import { useCallback, type JSX } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Brain01Icon } from "@hugeicons/core-free-icons";
import { Button } from "../../components/ui/button.js";
import { cn } from "../../lib/utils.js";
import { useUiStore } from "../../stores/uiStore.js";
import { useMemoryFeatureEnabled } from "../../lib/api/capabilities.js";

interface MemoryButtonProps {
  readonly compact?: boolean;
}

export function MemoryButton({
  compact = false,
}: MemoryButtonProps): JSX.Element | null {
  const setAppShellView = useUiStore((s) => s.setAppShellView);
  const memoryEnabled = useMemoryFeatureEnabled();
  const onClick = useCallback((): void => {
    setAppShellView("memory");
  }, [setAppShellView]);

  // Hooks above run unconditionally; gate the render after.
  if (!memoryEnabled) return null;

  return (
    // Quiet registry row: full-width, borderless, hairline-separated by the
    // footer — the Button size variants lose to these classes via cn/twMerge.
    <Button
      variant="ghost"
      size={compact ? "icon" : "sm"}
      onClick={onClick}
      aria-label="Open memory"
      className={cn(
        "h-9 w-full rounded-none border-0 bg-transparent text-xs text-[var(--vex-text-2)] hover:bg-white/[0.035] hover:text-foreground",
        compact ? "justify-center px-0" : "justify-start gap-2 px-4",
      )}
    >
      <HugeiconsIcon icon={Brain01Icon} size={15} aria-hidden />
      {compact ? null : <span>Memory</span>}
    </Button>
  );
}
