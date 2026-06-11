/**
 * Sidebar button — opens the onboarding/setup wizard in reconfigure mode
 * (master password, wallets, provider, embedding, …). Wallet management
 * lives inside that wizard (Review → Wallets, which always shows the full
 * management UI in back-edit), so there is no separate in-app settings card.
 */

import { useCallback } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Settings02Icon } from "@hugeicons/core-free-icons";
import { Button } from "../../components/ui/button.js";
import { cn } from "../../lib/utils.js";
import { useUiStore } from "../../stores/uiStore.js";

interface SettingsButtonProps {
  readonly compact?: boolean;
}

export function SettingsButton({
  compact = false,
}: SettingsButtonProps): JSX.Element {
  const openWizard = useUiStore((s) => s.openWizard);
  const onClick = useCallback((): void => {
    openWizard("reconfigure");
  }, [openWizard]);
  return (
    // Quiet registry row: full-width, borderless, hairline-separated by the
    // footer — the Button size variants lose to these classes via cn/twMerge.
    <Button
      variant="ghost"
      size={compact ? "icon" : "sm"}
      onClick={onClick}
      aria-label="Open settings"
      className={cn(
        "h-9 w-full rounded-none border-0 bg-transparent text-xs text-[var(--vex-text-2)] hover:bg-white/[0.035] hover:text-foreground",
        compact ? "justify-center px-0" : "justify-start gap-2 px-4",
      )}
    >
      <HugeiconsIcon icon={Settings02Icon} size={15} aria-hidden />
      {compact ? null : <span>Settings</span>}
    </Button>
  );
}
