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
