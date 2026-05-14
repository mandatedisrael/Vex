import type { JSX } from "react";
import type { EnvState } from "@shared/schemas/onboarding.js";
import type { WalletChain } from "@shared/schemas/wallets.js";
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

function shortAddr(addr: string | null): string {
  if (!addr) return "—";
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
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
  const status = evmOk && solOk ? "ok" : evmOk || solOk ? "partial" : "missing";
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
        status === "ok" ? "Both chains" : status === "partial" ? "Partial" : "Missing"
      }
      onEdit={onEdit}
      editDisabled={editDisabled}
      testId="wallets"
    >
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <span>EVM: {evmOk ? shortAddr(evmAddr) : "missing"}</span>
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
          <span>Solana: {solOk ? shortAddr(solAddr) : "missing"}</span>
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
