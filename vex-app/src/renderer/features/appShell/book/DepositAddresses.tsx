/**
 * Deposit addresses — the session's wallet addresses directly under the
 * POSITION header, copy-ready so the owner can fund the session (owner
 * request: "adresy portfeli w sesji, gotowe do skopiowania").
 *
 * One row per wallet family the session actually holds: chain mark + terse
 * mono family caption + the reusable AddressDisplay chip (truncate + copy +
 * 1.5s checkmark). The EVM row wears the Ethereum mark but is captioned
 * "EVM" — the address is valid on every EVM network, and the caption keeps
 * that honest. Session scope only; the caller gates on a session id.
 *
 * Data: `useSessionWallets` → SessionWalletScopeDto (immutable 1 EVM + 1
 * Solana pair fixed at session start; either side nullable). Quiet on
 * loading/error — the addresses are a convenience row, not a panel state.
 */

import type { JSX } from "react";
import {
  ETHEREUM_CHAIN_ID,
  SOLANA_CHAIN_ID,
} from "@shared/chains/display.js";
import { useSessionWallets } from "../../../lib/api/session-wallets.js";
import { AddressDisplay } from "../../../components/common/AddressDisplay.js";
import { ChainIcon } from "../../../components/common/ChainIcon.js";

export function DepositAddresses({
  sessionId,
}: {
  readonly sessionId: string;
}): JSX.Element | null {
  const query = useSessionWallets(sessionId);
  const scope = query.data?.ok ? query.data.data : null;
  if (scope === null || (scope.evm === null && scope.solana === null)) {
    return null;
  }
  return (
    <div className="flex flex-col gap-1" data-vex-area="deposit-addresses">
      {scope.evm !== null ? (
        <AddressRow
          chainId={ETHEREUM_CHAIN_ID}
          caption="EVM"
          address={scope.evm.address}
        />
      ) : null}
      {scope.solana !== null ? (
        <AddressRow
          chainId={SOLANA_CHAIN_ID}
          caption="SOL"
          address={scope.solana.address}
        />
      ) : null}
    </div>
  );
}

function AddressRow({
  chainId,
  caption,
  address,
}: {
  readonly chainId: number;
  readonly caption: string;
  readonly address: string;
}): JSX.Element {
  return (
    <div className="flex items-center gap-2">
      <span className="flex w-11 shrink-0 items-center gap-1.5">
        <ChainIcon chainId={chainId} size={13} />
        <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-[var(--vex-text-3)]">
          {caption}
        </span>
      </span>
      <AddressDisplay
        address={address}
        className="min-w-0 flex-1 justify-between px-2 py-0.5"
      />
    </div>
  );
}
