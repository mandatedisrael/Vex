import type { JSX } from "react";
import type { EnvState } from "@shared/schemas/onboarding.js";
import type { WalletChain } from "@shared/schemas/wallets.js";
import { AddressDisplay } from "../../../../../components/common/AddressDisplay.js";
import { Button } from "../../../../../components/ui/button.js";
import { SummaryCard } from "./SummaryCard.js";

export interface WalletsCardProps {
  readonly envState: EnvState;
  readonly onEdit: () => void;
  readonly editDisabled: boolean;
  /**
   * Wizard mode the card is rendered in. Export-private-key is gated to
   * `reconfigure` so the action is only ever offered to operators who
   * already finished setup and are intentionally managing existing
   * wallets.
   */
  readonly mode?: "setup" | "reconfigure";
  /**
   * Optional export trigger. When provided AND `mode === "reconfigure"`
   * AND the wallet for that chain is present, the card renders a
   * per-chain "Export private key" button that delegates the modal
   * lifecycle to the parent (ReviewStep).
   */
  readonly onExport?: (chain: WalletChain) => void;
}

export function WalletsCard({
  envState,
  onEdit,
  editDisabled,
  mode = "setup",
  onExport,
}: WalletsCardProps): JSX.Element {
  const evmOk = envState.walletStatus.evm === "present";
  const solOk = envState.walletStatus.solana === "present";
  // Optional-connections model: wallets never block finalize. No wallet at
  // all is a warning (no trading / on-chain activity), not a hard miss.
  const status = evmOk && solOk ? "ok" : evmOk || solOk ? "partial" : "warning";
  const evmAddr = envState.walletAddresses?.evm ?? null;
  const solAddr = envState.walletAddresses?.solana ?? null;

  const canExport = mode === "reconfigure" && onExport !== undefined;
  const evmExportShown = canExport && evmOk;
  const solExportShown = canExport && solOk;

  return (
    <SummaryCard
      title="Wallets"
      status={status}
      statusLabel={
        status === "ok"
          ? "Both chains"
          : status === "partial"
            ? "Partial"
            : "None — optional"
      }
      onEdit={onEdit}
      editDisabled={editDisabled}
      testId="wallets"
    >
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1.5">
            <span>EVM:</span>
            {evmOk && evmAddr !== null ? (
              <AddressDisplay
                address={evmAddr}
                appearance="inline"
                copyLabel="Copy EVM wallet address"
                copiedLabel="Address copied"
              />
            ) : (
              <span>{evmOk ? "—" : "missing"}</span>
            )}
          </div>
          {evmExportShown ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onExport?.("evm")}
              disabled={editDisabled}
              data-vex-wallets-export="evm"
              aria-label="Export EVM private key"
            >
              Export EVM key
            </Button>
          ) : null}
        </div>
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1.5">
            <span>Solana:</span>
            {solOk && solAddr !== null ? (
              <AddressDisplay
                address={solAddr}
                appearance="inline"
                copyLabel="Copy Solana wallet address"
                copiedLabel="Address copied"
              />
            ) : (
              <span>{solOk ? "—" : "missing"}</span>
            )}
          </div>
          {solExportShown ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onExport?.("solana")}
              disabled={editDisabled}
              data-vex-wallets-export="solana"
              aria-label="Export Solana private key"
            >
              Export Solana key
            </Button>
          ) : null}
        </div>
      </div>
    </SummaryCard>
  );
}
