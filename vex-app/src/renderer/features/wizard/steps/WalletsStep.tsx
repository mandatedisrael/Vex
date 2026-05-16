/**
 * Wizard Step 2 — Wallets (M8; PR6 redesign — onboarding glass).
 *
 * Two chains (EVM + Solana), three actions per chain (Generate, Import,
 * Restore from backup). Layout: shadcn Tabs split. Tabs now carry their
 * matching brand glyphs (`Ethereum` and `Solana` from `@thesvg/react`)
 * next to the labels — the same brand vocabulary we use elsewhere in
 * the onboarding aesthetic, and they cost almost nothing visually.
 *
 * Skip-to-continue logic: when both chains have a wallet (either
 * persisted from a previous session via `envState.walletStatus.{evm,solana}`
 * being "present", OR set in-session via `lastGenerated`), render a
 * summary panel with both addresses and a Continue button. Otherwise
 * render the Tabs UI.
 *
 * Address display sources (in order):
 *  1. `lastGenerated[chain]`  — freshest (just generated/imported/restored
 *     in this session)
 *  2. `envState.walletAddresses[chain]` — cross-session (loaded from
 *     `config.json` by the env-state probe)
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
import {
  useStepAdvance,
  type WizardFlowMode,
} from "../../../lib/api/wizard.js";
import type { WizardStepId } from "@shared/schemas/wizard.js";
import type { WalletChain } from "@shared/schemas/wallets.js";
import { WIZARD_STEP_META } from "../wizard-icons.js";
import { WizardStepPanel } from "../WizardStepPanel.js";
import { ChainActions } from "./wallets/ChainActions.js";

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
  const stepAdvance = useStepAdvance();

  const [lastGenerated, setLastGenerated] = useState<ChainState>({});
  const [lastBackupDir, setLastBackupDir] = useState<ChainState>({});
  const [advanceError, setAdvanceError] = useState<string | null>(null);

  const envData = envQuery.data?.ok === true ? envQuery.data.data : null;
  const evmAddress =
    lastGenerated.evm ?? envData?.walletAddresses?.evm ?? null;
  const solanaAddress =
    lastGenerated.solana ?? envData?.walletAddresses?.solana ?? null;

  const evmReady =
    evmAddress !== null || envData?.walletStatus.evm === "present";
  const solanaReady =
    solanaAddress !== null || envData?.walletStatus.solana === "present";
  const bothReady = evmReady && solanaReady;

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

  if (envQuery.isLoading) {
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

  if (bothReady) {
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
      title="Set up wallets"
      description="Vex needs both an EVM wallet (Ethereum + L2s) and a Solana wallet. Generate fresh keys, import existing ones, or restore from a backup keystore file. Each chain is encrypted with the master password from Step 1."
      footer={null}
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
    </WizardStepPanel>
  );
}
