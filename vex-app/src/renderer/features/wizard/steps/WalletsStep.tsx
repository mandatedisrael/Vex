/**
 * Wizard Step 2 — Wallets (M8; PR6 redesign — onboarding glass).
 *
 * Two chains (EVM + Solana), three actions per chain (Generate, Import,
 * Restore from backup). Layout: shadcn Tabs split. Tabs now carry their
 * matching brand glyphs (`Ethereum` and `Solana` from `@thesvg/react`)
 * next to the labels — the same brand vocabulary we use elsewhere in
 * the onboarding aesthetic, and they cost almost nothing visually.
 *
 * Skip-to-continue logic: in the forward setup flow, when both chains have a
 * wallet, render a summary panel + Continue. Otherwise render the Tabs
 * management UI. In `back-edit` (reconfigure from Review) the Tabs UI is
 * ALWAYS shown — even when both wallets exist — so the user can
 * add/import/manage wallets post-onboarding, with a "Return to review" button.
 *
 * Address source: `lastGenerated[chain]` (in-session
 * flip) → wallet inventory primary (`useAvailableWallets`) → legacy
 * `envState.walletAddresses[chain]` fallback. The inventory is authoritative;
 * legacy addresses are NOT written in the multi-wallet config model.
 *
 * Per codex turn 8 RED #1, raw private keys never enter React state /
 * Zustand / TanStack cache. The import flow is implemented inside
 * `ChainActions` with a direct async call.
 *
 * Chrome lives in `WizardStepPanel` — `data-vex-wizard-wallets="loading"`,
 * `"ready"`, `"setup"` forwarded onto the panel root via typed
 * `panelDataAttr`.
 */

import { useCallback, useState, type JSX } from "react";
import { Ethereum, Solana } from "@thesvg/react";

import { Button } from "../../../components/ui/button.js";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "../../../components/ui/tabs.js";
import { AddressDisplay } from "../../../components/common/AddressDisplay.js";
import { useEnvState } from "../../../lib/api/onboarding.js";
import { useAvailableWallets } from "../../../lib/api/wallet-inventory.js";
import {
  useStepAdvance,
  type WizardFlowMode,
} from "../../../lib/api/wizard.js";
import type { WizardStepId } from "@shared/schemas/wizard.js";
import type { WalletChain } from "@shared/schemas/wallets.js";
import { WIZARD_STEP_META } from "../wizard-icons.js";
import { WizardStepPanel } from "../WizardStepPanel.js";
import { ChainActions } from "./wallets/ChainActions.js";
import { ExportAllWallets } from "./wallets/ExportAllWallets.js";

interface ChainState {
  readonly evm?: string;
  readonly solana?: string;
}

export interface WalletsStepProps {
  readonly completedSteps: ReadonlyArray<WizardStepId>;
  readonly onAdvance: (next: WizardStepId) => void;
  readonly flowMode: WizardFlowMode;
}

export function WalletsStep({
  completedSteps,
  onAdvance,
  flowMode,
}: WalletsStepProps): JSX.Element {
  const envQuery = useEnvState();
  const availableWallets = useAvailableWallets();
  const stepAdvance = useStepAdvance();

  const [lastGenerated, setLastGenerated] = useState<ChainState>({});
  const [lastBackupDir, setLastBackupDir] = useState<ChainState>({});
  const [advanceError, setAdvanceError] = useState<string | null>(null);

  const envData = envQuery.data?.ok === true ? envQuery.data.data : null;
  const inventory =
    availableWallets.data?.ok === true
      ? availableWallets.data.data
      : { evm: [], solana: [] };
  const evmAddress =
    lastGenerated.evm ??
    inventory.evm[0]?.address ??
    envData?.walletAddresses?.evm ??
    null;
  const solanaAddress =
    lastGenerated.solana ??
    inventory.solana[0]?.address ??
    envData?.walletAddresses?.solana ??
    null;

  const evmReady =
    evmAddress !== null || envData?.walletStatus.evm === "present";
  const solanaReady =
    solanaAddress !== null || envData?.walletStatus.solana === "present";
  const bothReady = evmReady && solanaReady;
  // Export is cross-family — offer it as soon as ANY wallet exists.
  const anyWallet = evmReady || solanaReady;

  const advanceToApiKeys = useCallback(async (): Promise<void> => {
    setAdvanceError(null);
    const result = await stepAdvance.advance({
      flowMode,
      completedSteps,
      current: "wallets",
      forwardNext: "apiKeys",
      onAdvance,
    });
    if (!result.ok) setAdvanceError(result.message);
  }, [stepAdvance, flowMode, completedSteps, onAdvance]);

  const handleAddressSet = useCallback(
    (chain: WalletChain, address: string, backupDir: string | null): void => {
      setLastGenerated((prev) => ({ ...prev, [chain]: address }));
      if (backupDir !== null) {
        setLastBackupDir((prev) => ({ ...prev, [chain]: backupDir }));
      }
    },
    [],
  );

  const meta = WIZARD_STEP_META.wallets;

  if (envQuery.isLoading || availableWallets.isLoading) {
    return (
      <WizardStepPanel
        panelDataAttr={{ kind: "wallets", value: "loading" }}
        icon={meta.icon}
        title="Set up wallets"
        description="Loading wallet status…"
        footer={null}
      >
        <div role="status" aria-live="polite" className="flex items-center gap-2">
          <div
            aria-hidden
            className="h-1 w-32 overflow-hidden rounded-full bg-white/[0.07]"
          >
            <div className="h-full w-1/3 animate-pulse bg-[var(--vex-onboarding-accent)]" />
          </div>
          <span className="sr-only">Loading wallet status…</span>
        </div>
      </WizardStepPanel>
    );
  }

  // Inventory failed to load but wallets are known to exist (walletStatus
  // present) and we have no address from any source → do NOT fall through to
  // the empty setup menu (which would hide existing wallets). Surface an error.
  const inventoryFailed =
    availableWallets.data !== undefined && availableWallets.data.ok === false;
  const walletsExist =
    envData?.walletStatus.evm === "present" ||
    envData?.walletStatus.solana === "present";
  if (
    inventoryFailed &&
    walletsExist &&
    evmAddress === null &&
    solanaAddress === null
  ) {
    return (
      <WizardStepPanel
        panelDataAttr={{ kind: "wallets", value: "setup" }}
        icon={meta.icon}
        title="Couldn't load wallets"
        description="Your wallets exist but couldn't be loaded right now."
        footer={
          flowMode === "back-edit" ? (
            <Button
              onClick={() => {
                void advanceToApiKeys();
              }}
              disabled={stepAdvance.isPending}
            >
              Return to review
            </Button>
          ) : null
        }
      >
        <p className="text-sm text-[var(--color-danger)]" role="alert">
          Couldn&apos;t load your wallets. Close and reopen settings, or retry.
        </p>
      </WizardStepPanel>
    );
  }

  if (bothReady && flowMode !== "back-edit") {
    return (
      <WizardStepPanel
        panelDataAttr={{ kind: "wallets", value: "ready" }}
        icon={meta.icon}
        title="Wallets configured"
        description="Both wallets are set up. Continue to configure API keys."
        footer={
          <Button
            onClick={() => {
              void advanceToApiKeys();
            }}
            disabled={stepAdvance.isPending}
          >
            {stepAdvance.isPending
              ? "Continuing…"
              : flowMode === "back-edit"
                ? "Return to review"
                : "Continue"}
          </Button>
        }
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-3">
            <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-3">
              <div className="flex items-center gap-2">
                <Ethereum width={14} height={14} aria-hidden />
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-text-muted)]">
                  EVM
                </p>
              </div>
              {evmAddress !== null ? (
                <AddressDisplay address={evmAddress} className="mt-1" />
              ) : (
                <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
                  Wallet present (address loaded from config).
                </p>
              )}
            </div>
            <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-3">
              <div className="flex items-center gap-2">
                <Solana width={14} height={14} aria-hidden />
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-text-muted)]">
                  Solana
                </p>
              </div>
              {solanaAddress !== null ? (
                <AddressDisplay address={solanaAddress} className="mt-1" />
              ) : (
                <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
                  Wallet present (address loaded from config).
                </p>
              )}
            </div>
          </div>
          <ExportAllWallets />
          {advanceError !== null ? (
            <p className="text-sm text-[var(--color-danger)]" role="alert">
              {advanceError}
            </p>
          ) : null}
        </div>
      </WizardStepPanel>
    );
  }

  return (
    <WizardStepPanel
      panelDataAttr={{ kind: "wallets", value: "setup" }}
      icon={meta.icon}
      title={flowMode === "back-edit" ? "Manage wallets" : "Set up wallets"}
      description="Vex needs both an EVM wallet (Ethereum + L2s) and a Solana wallet. Generate fresh keys, import existing ones, or restore from a backup keystore file. Each chain is encrypted with the master password from Step 1."
      footer={
        flowMode === "back-edit" ? (
          <Button
            onClick={() => {
              void advanceToApiKeys();
            }}
            disabled={stepAdvance.isPending}
          >
            {stepAdvance.isPending ? "Returning…" : "Return to review"}
          </Button>
        ) : null
      }
    >
      <Tabs defaultValue="evm">
        <TabsList>
          <TabsTrigger value="evm" className="flex items-center gap-2">
            <Ethereum width={14} height={14} aria-hidden />
            EVM
          </TabsTrigger>
          <TabsTrigger value="solana" className="flex items-center gap-2">
            <Solana width={14} height={14} aria-hidden />
            Solana
          </TabsTrigger>
        </TabsList>
        <TabsContent value="evm">
          <ChainActions
            chain="evm"
            address={evmAddress}
            backupDir={lastBackupDir.evm ?? null}
            onAddressSet={handleAddressSet}
          />
        </TabsContent>
        <TabsContent value="solana">
          <ChainActions
            chain="solana"
            address={solanaAddress}
            backupDir={lastBackupDir.solana ?? null}
            onAddressSet={handleAddressSet}
          />
        </TabsContent>
      </Tabs>
      {anyWallet ? (
        <div className="mt-4 border-t border-white/[0.08] pt-4">
          <ExportAllWallets />
        </div>
      ) : null}
      {advanceError !== null ? (
        <p className="mt-3 text-sm text-[var(--color-danger)]" role="alert">
          {advanceError}
        </p>
      ) : null}
    </WizardStepPanel>
  );
}
