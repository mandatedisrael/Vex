/**
 * POSITION — the wallet portfolio block for the BOOK panel (stage 4).
 *
 * Dual-scope, driven purely by `activeSessionId`:
 *   - `null`     → GLOBAL inventory portfolio, titled "Portfolio".
 *   - non-null   → that session's wallet-scope portfolio, titled "Position".
 *
 * The renderer never supplies a wallet address; `usePortfolio` derives the
 * discriminated scope and main resolves the server-side allow-list. This
 * component only renders the resolved DTO.
 *
 * Surface shows: the live total USD (blue rationed to this one figure), the
 * most recent snapshot total + PnL when present, the resolved wallet COUNT,
 * and the top token holdings (capped, remainder noted). Loading / error /
 * empty (no wallets) states are boxless lines on the same register.
 *
 * Signal Tape language: surface/hairline/text trio; blue ONLY on the live
 * total, semantic up/down on the PnL; `tabular-nums` on every figure.
 */

import type { JSX } from "react";
import type {
  PortfolioDto,
  PositionTokenDto,
} from "@shared/schemas/portfolio.js";
import { usePortfolio } from "../../../lib/api/portfolio.js";
import { formatUsd, formatUsdDelta } from "../../../lib/format.js";
import { BookBlock } from "./BookBlock.js";

/** Visible token rows before the "+N more" tail. */
const TOKENS_VISIBLE = 8;

export function PositionBlock({
  activeSessionId,
}: {
  readonly activeSessionId: string | null;
}): JSX.Element {
  const isSession = activeSessionId !== null;
  const title = isSession ? "Position" : "Portfolio";

  const query = usePortfolio(activeSessionId);
  const result = query.data;
  const portfolio = result?.ok ? result.data : null;

  if (query.isLoading) {
    return (
      <BookBlock title={title}>
        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--vex-text-3)]">
          Loading…
        </p>
      </BookBlock>
    );
  }

  if ((result !== undefined && !result.ok) || query.isError) {
    return (
      <BookBlock title={title}>
        <p className="text-[11px] text-[var(--vex-warn-text)]">
          Couldn&apos;t load your portfolio.
        </p>
      </BookBlock>
    );
  }

  if (portfolio === null || portfolio.walletCount === 0) {
    return (
      <BookBlock title={title}>
        <p className="text-[11px] text-[var(--vex-text-3)]">
          {isSession
            ? "No wallets in this session."
            : "No wallets configured."}
        </p>
      </BookBlock>
    );
  }

  return (
    <BookBlock
      title={title}
      trailing={`${portfolio.walletCount} ${
        portfolio.walletCount === 1 ? "wallet" : "wallets"
      }`}
    >
      <PositionBody portfolio={portfolio} />
    </BookBlock>
  );
}

function PositionBody({
  portfolio,
}: {
  readonly portfolio: PortfolioDto;
}): JSX.Element {
  const { liveTotalUsd, snapshotTotalUsd, pnlVsPrev, tokens } = portfolio;
  const visible = tokens.slice(0, TOKENS_VISIBLE);
  const remainder = tokens.length - visible.length;

  return (
    <div className="flex flex-col gap-2.5">
      <TotalRow
        liveTotalUsd={liveTotalUsd}
        snapshotTotalUsd={snapshotTotalUsd}
        pnlVsPrev={pnlVsPrev}
      />
      {visible.length > 0 ? (
        <ul className="flex flex-col gap-1">
          {visible.map((token) => (
            <TokenRow key={tokenKey(token)} token={token} />
          ))}
        </ul>
      ) : (
        <p className="text-[11px] text-[var(--vex-text-3)]">
          No token balances.
        </p>
      )}
      {remainder > 0 ? (
        <p className="font-mono text-[10px] tracking-[0.14em] text-[var(--vex-text-3)]">
          +{remainder} more
        </p>
      ) : null}
    </div>
  );
}

function TotalRow({
  liveTotalUsd,
  snapshotTotalUsd,
  pnlVsPrev,
}: {
  readonly liveTotalUsd: number;
  readonly snapshotTotalUsd: number | null;
  readonly pnlVsPrev: number | null;
}): JSX.Element {
  // Blue is rationed to the single live-total figure — the one number the
  // panel is built around. Everything else stays on the muted text trio.
  return (
    <div className="flex flex-col gap-0.5">
      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--vex-text-3)]">
        Total
      </span>
      <span className="text-[17px] font-medium tabular-nums text-[var(--vex-accent-text)]">
        {formatUsd(liveTotalUsd)}
      </span>
      {snapshotTotalUsd !== null ? (
        <span className="flex items-baseline gap-1.5 text-[11px] text-[var(--vex-text-3)]">
          <span className="tabular-nums">
            snapshot {formatUsd(snapshotTotalUsd)}
          </span>
          {pnlVsPrev !== null ? (
            <span
              className={`tabular-nums ${pnlToneClass(pnlVsPrev)}`}
              aria-label={`Profit and loss versus previous snapshot ${formatUsdDelta(pnlVsPrev)}`}
            >
              {formatUsdDelta(pnlVsPrev)}
            </span>
          ) : null}
        </span>
      ) : null}
    </div>
  );
}

function TokenRow({ token }: { readonly token: PositionTokenDto }): JSX.Element {
  const symbol = token.symbol !== null && token.symbol.length > 0
    ? token.symbol
    : "—";
  return (
    <li className="flex items-baseline justify-between gap-3">
      <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-[var(--vex-text)]">
        {symbol}
      </span>
      <span className="shrink-0 tabular-nums text-[12px] text-[var(--vex-text-2)]">
        {formatUsd(token.balanceUsd)}
      </span>
    </li>
  );
}

/** Up = success, down = warn, flat/zero = muted. No glow, token colours only. */
function pnlToneClass(pnl: number): string {
  if (pnl > 0) return "text-[var(--color-success)]";
  if (pnl < 0) return "text-[var(--vex-warn-text)]";
  return "text-[var(--vex-text-3)]";
}

/**
 * Stable React key for a (chain, token) bucket. `chainId`/`symbol` can both
 * be `null`; the composite stays unique per aggregated line (the SQL groups
 * by `(chain_id, token_symbol)`, so no two rows share both).
 */
function tokenKey(token: PositionTokenDto): string {
  return `${token.chainId ?? "x"}:${token.symbol ?? "x"}`;
}
