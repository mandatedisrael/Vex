/**
 * Sidebar button — opens the read-only Knowledge & Memory management panel
 * (stage 7-2a). Rendered ONLY when the `memory` capability is enabled, so the
 * affordance never appears before the feature is wired.
 */

import { useCallback, type JSX } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Knowledge01Icon } from "@hugeicons/core-free-icons";
import { Button } from "../../components/ui/button.js";
import { useUiStore } from "../../stores/uiStore.js";
import { useMemoryFeatureEnabled } from "../../lib/api/capabilities.js";

interface KnowledgeButtonProps {
  readonly compact?: boolean;
}

export function KnowledgeButton({
  compact = false,
}: KnowledgeButtonProps): JSX.Element | null {
  const setAppShellView = useUiStore((s) => s.setAppShellView);
  const memoryEnabled = useMemoryFeatureEnabled();
  const onClick = useCallback((): void => {
    setAppShellView("knowledge");
  }, [setAppShellView]);

  // Hooks above run unconditionally; gate the render after.
  if (!memoryEnabled) return null;

  return (
    <Button
      variant="ghost"
      size={compact ? "icon" : "sm"}
      onClick={onClick}
      aria-label="Open knowledge and memory"
      className="border border-white/[0.08] bg-white/[0.03] text-[var(--color-text-secondary)] hover:bg-white/[0.08] hover:text-foreground"
    >
      <HugeiconsIcon icon={Knowledge01Icon} size={16} aria-hidden />
      {compact ? null : <span>Knowledge</span>}
    </Button>
  );
}
