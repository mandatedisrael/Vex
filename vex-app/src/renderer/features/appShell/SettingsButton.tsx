/**
 * Sidebar button — opens the in-app Settings screen (wallet management +
 * Polymarket auto-setup). The full setup wizard (master password,
 * provider, embedding, etc.) is reachable from INSIDE Settings via
 * "Re-run setup wizard"; this entry no longer jumps straight into the
 * wizard, so the sidebar has a single Settings affordance.
 */

import { useCallback } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Settings02Icon } from "@hugeicons/core-free-icons";
import { Button } from "../../components/ui/button.js";
import { useUiStore } from "../../stores/uiStore.js";

interface SettingsButtonProps {
  readonly compact?: boolean;
}

export function SettingsButton({
  compact = false,
}: SettingsButtonProps): JSX.Element {
  const setAppShellView = useUiStore((s) => s.setAppShellView);
  const onClick = useCallback((): void => {
    setAppShellView("settings");
  }, [setAppShellView]);
  return (
    <Button
      variant="ghost"
      size={compact ? "icon" : "sm"}
      onClick={onClick}
      aria-label="Open settings"
      className="border border-white/[0.08] bg-white/[0.03] text-[var(--color-text-secondary)] hover:bg-white/[0.08] hover:text-foreground"
    >
      <HugeiconsIcon icon={Settings02Icon} size={16} aria-hidden />
      {compact ? null : <span>Settings</span>}
    </Button>
  );
}
