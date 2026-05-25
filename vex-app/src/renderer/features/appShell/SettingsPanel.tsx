/**
 * Post-onboarding Settings screen (an AppShell sub-view).
 *
 * Lets the user return after setup to "create things they skipped":
 * manage wallets (generate/import EVM + Solana up to 3 per family, export
 * all) and run Polymarket auto-setup per EVM wallet. The full setup wizard
 * (master password, provider, embedding, …) is reachable via "Re-run setup
 * wizard".
 *
 * Reuse: the wallet + Polymarket UI are the SAME wizard-agnostic components
 * the onboarding `WalletsStep`/`ApiKeysStep` use (`ChainActions`,
 * `ExportAllWallets`, `PolymarketAutoSetupSection`). `ChainActions` already
 * renders the primary wallet + the additional-wallet panel, so no separate
 * primary row is needed here. Only the wizard step-advance orchestration is
 * dropped; the post-action "flip" reuses WalletsStep's local
 * `lastGenerated`/`lastBackupDir` pattern.
 *
 * Polymarket is EVM/Polygon-only — Solana wallets are not supported. The
 * section is rendered only when an EVM wallet exists (so the onboarding-only
 * "finish Step 2 first" copy never shows); otherwise the host shows a
 * Settings-appropriate hint. `useEnvState()` pending/error is handled before
 * deciding "no EVM wallet" so an unresolved probe never gates incorrectly.
 */

import { useCallback, useState, type JSX } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowLeft01Icon } from "@hugeicons/core-free-icons";
import { useQueryClient } from "@tanstack/react-query";
import type { WalletChain } from "@shared/schemas/wallets.js";
import { Button } from "../../components/ui/button.js";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "../../components/ui/tabs.js";
import { useAvailableWallets } from "../../lib/api/wallet-inventory.js";
import { useEnvState } from "../../lib/api/onboarding.js";
import { onboardingKeys } from "../../lib/api/queryKeys.js";
import { useUiStore } from "../../stores/uiStore.js";
import { ChainActions } from "../wizard/steps/wallets/ChainActions.js";
import { ExportAllWallets } from "../wizard/steps/wallets/ExportAllWallets.js";
import { PolymarketAutoSetupSection } from "../wizard/steps/polymarket-auto-setup/PolymarketAutoSetupSection.js";

interface ChainState {
  readonly evm?: string;
  readonly solana?: string;
}

export function SettingsPanel(): JSX.Element {
  const envQuery = useEnvState();
  const walletsQuery = useAvailableWallets();
  const queryClient = useQueryClient();
  const setAppShellView = useUiStore((s) => s.setAppShellView);
  const openWizard = useUiStore((s) => s.openWizard);

  // Local "flip" state — mirrors WalletsStep so a freshly
  // generated/imported/restored wallet shows immediately, before the
  // envState probe refetches. Raw keys never enter this state (only the
  // resulting public address + optional backup dir).
  const [lastGenerated, setLastGenerated] = useState<ChainState>({});
  const [lastBackupDir, setLastBackupDir] = useState<ChainState>({});

  const handleAddressSet = useCallback(
    (chain: WalletChain, address: string, backupDir: string | null): void => {
      setLastGenerated((prev) => ({ ...prev, [chain]: address }));
      if (backupDir !== null) {
        setLastBackupDir((prev) => ({ ...prev, [chain]: backupDir }));
      }
    },
    [],
  );

  const backToChat = useCallback((): void => {
    setAppShellView("session");
  }, [setAppShellView]);

  const reRunWizard = useCallback((): void => {
    openWizard("reconfigure");
  }, [openWizard]);

  const refreshAfterPolymarket = useCallback((): void => {
    void queryClient.invalidateQueries({ queryKey: onboardingKeys.envState() });
  }, [queryClient]);

  return (
    <div
      data-vex-screen="settings"
      className="flex h-full min-h-0 flex-col text-foreground"
    >
      <header className="flex h-16 shrink-0 items-center gap-3 border-b border-white/[0.045] px-6">
        <Button
          variant="ghost"
          size="sm"
          onClick={backToChat}
          aria-label="Back to chat"
          className="text-[var(--color-text-secondary)] hover:text-foreground"
        >
          <HugeiconsIcon icon={ArrowLeft01Icon} size={16} aria-hidden />
          <span>Back</span>
        </Button>
        <h1 className="text-sm font-semibold tracking-tight">Settings</h1>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
        <div className="mx-auto flex w-full max-w-[680px] flex-col gap-6">
          <SettingsBody
            envQuery={envQuery}
            walletsQuery={walletsQuery}
            lastGenerated={lastGenerated}
            lastBackupDir={lastBackupDir}
            onAddressSet={handleAddressSet}
            onPolymarketSuccess={refreshAfterPolymarket}
            onReRunWizard={reRunWizard}
          />
        </div>
      </div>
    </div>
  );
}

interface SettingsBodyProps {
  readonly envQuery: ReturnType<typeof useEnvState>;
  readonly walletsQuery: ReturnType<typeof useAvailableWallets>;
  readonly lastGenerated: ChainState;
  readonly lastBackupDir: ChainState;
  readonly onAddressSet: (
    chain: WalletChain,
    address: string,
    backupDir: string | null,
  ) => void;
  readonly onPolymarketSuccess: () => void;
  readonly onReRunWizard: () => void;
}

function SettingsBody({
  envQuery,
  walletsQuery,
  lastGenerated,
  lastBackupDir,
  onAddressSet,
  onPolymarketSuccess,
  onReRunWizard,
}: SettingsBodyProps): JSX.Element {
  if (envQuery.isLoading || walletsQuery.isLoading) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 py-3 text-sm text-[var(--color-text-secondary)]"
      >
        Loading settings…
      </div>
    );
  }

  const envData = envQuery.data?.ok === true ? envQuery.data.data : null;
  const walletsData =
    walletsQuery.data?.ok === true ? walletsQuery.data.data : null;
  if (envData === null || walletsData === null) {
    const message =
      walletsQuery.data && walletsQuery.data.ok === false
        ? walletsQuery.data.error.message
        : envQuery.data && envQuery.data.ok === false
          ? envQuery.data.error.message
          : "Unable to load settings. Verify the local runtime is running and retry.";
    return (
      <div
        role="alert"
        className="rounded-xl border border-destructive/35 bg-destructive/10 px-4 py-3 text-sm text-destructive"
      >
        {message}
      </div>
    );
  }

  // Wallet inventory is the source of truth: the legacy `walletAddresses`
  // env fields are NOT written in the multi-wallet config model, so a
  // present wallet can carry a null legacy address. `lastGenerated` only
  // overrides for the in-session "flip" before the inventory refetch lands.
  const evmInventory = walletsData.evm;
  const solanaInventory = walletsData.solana;
  const evmAddress = lastGenerated.evm ?? evmInventory[0]?.address ?? null;
  const solanaAddress =
    lastGenerated.solana ?? solanaInventory[0]?.address ?? null;
  const anyWallet = evmInventory.length > 0 || solanaInventory.length > 0;

  const evmWalletPresent = evmInventory.length > 0;
  const vaultUnlocked = envData.secrets.unlocked;
  const polymarketStatus = envData.apiKeys.polymarketStatus;

  return (
    <>
      <section
        data-vex-settings-section="wallets"
        className="flex flex-col gap-4 rounded-xl border border-white/[0.08] bg-white/[0.03] p-4"
      >
        <div>
          <h2 className="text-sm font-semibold">Wallets</h2>
          <p className="mt-1 text-xs text-[var(--color-text-muted)]">
            Manage your EVM and Solana wallets (up to 3 per chain). Generate,
            import, restore, or export.
          </p>
        </div>
        <Tabs defaultValue="evm">
          <TabsList>
            <TabsTrigger value="evm">EVM</TabsTrigger>
            <TabsTrigger value="solana">Solana</TabsTrigger>
          </TabsList>
          <TabsContent value="evm">
            <ChainActions
              chain="evm"
              address={evmAddress}
              backupDir={lastBackupDir.evm ?? null}
              onAddressSet={onAddressSet}
            />
          </TabsContent>
          <TabsContent value="solana">
            <ChainActions
              chain="solana"
              address={solanaAddress}
              backupDir={lastBackupDir.solana ?? null}
              onAddressSet={onAddressSet}
            />
          </TabsContent>
        </Tabs>
        {anyWallet ? (
          <div className="border-t border-white/[0.08] pt-4">
            <ExportAllWallets />
          </div>
        ) : null}
      </section>

      <section
        data-vex-settings-section="polymarket"
        className="flex flex-col gap-3 rounded-xl border border-white/[0.08] bg-white/[0.03] p-4"
      >
        <div>
          <h2 className="text-sm font-semibold">Polymarket</h2>
          <p className="mt-1 text-xs text-[var(--color-text-muted)]">
            Polymarket is EVM/Polygon-only — Solana wallets are not supported.
            Auto-setup derives API credentials from the selected EVM wallet and
            stores them in your local vault. No secret is shown on screen.
          </p>
        </div>
        {evmWalletPresent ? (
          <PolymarketAutoSetupSection
            status={polymarketStatus}
            evmWalletPresent
            vaultUnlocked={vaultUnlocked}
            disabled={false}
            onSuccess={onPolymarketSuccess}
          />
        ) : (
          <p
            data-vex-settings-polymarket="no-evm"
            className="text-xs text-[var(--color-text-secondary)]"
          >
            Add an EVM wallet above to set up Polymarket.
          </p>
        )}
      </section>

      <section
        data-vex-settings-section="setup"
        className="flex flex-col gap-3 rounded-xl border border-white/[0.08] bg-white/[0.03] p-4"
      >
        <div>
          <h2 className="text-sm font-semibold">Setup</h2>
          <p className="mt-1 text-xs text-[var(--color-text-muted)]">
            Re-run the full setup wizard to edit the master password, provider,
            embedding, and other infrastructure settings.
          </p>
        </div>
        <div>
          <Button variant="outline" size="sm" onClick={onReRunWizard}>
            Re-run setup wizard
          </Button>
        </div>
      </section>
    </>
  );
}
