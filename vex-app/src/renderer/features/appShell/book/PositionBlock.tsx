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
 * most recent snapshot total + PnL when present, and the resolved wallet
 * COUNT. SESSION scope then renders the redesigned register — copy-ready
 * deposit addresses (DepositAddresses) + the per-chain holdings switcher
 * (PositionChains); GLOBAL keeps the legacy flat top-holdings list (capped,
 * remainder noted). Loading / error / empty (no wallets) states are boxless
 * lines on the same register.
 *
 * Token rows that would print `$0.00` (|USD| below formatUsd's 2-decimal
 * rounding threshold) are hidden — the cap and "+N more" count only rows
 * worth showing. Total/snapshot/PnL still reflect the FULL portfolio.
 *
 * `hero` = the BOOK column's single dominant section. The de-boxed column has
 * no tile chrome to strengthen, so hero presence lives in CONTENT: the total
 * figure scales up to the giant Archivo treatment (27px vs 22px).
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
import { useSessionWallets } from "../../../lib/api/session-wallets.js";
import { formatUsd, formatUsdDelta } from "../../../lib/format.js";
import { BookBlock } from "./BookBlock.js";
import { DepositAddresses } from "./DepositAddresses.js";
import { PositionChains } from "./PositionChains.js";

/** Visible token rows before the "+N more" tail. */
const TOKENS_VISIBLE = 8;

/**
 * Smallest |USD| that `formatUsd` still renders as a non-zero figure:
 * `(0.005).toFixed(2) === "0.01"` while anything smaller rounds to `"0.00"`.
 * Rows below this would print a meaningless `$0.00` line, so they are hidden.
 */
const MIN_DISPLAY_USD = 0.005;

/** True when the row's USD figure would display as something other than $0.00. */
function hasDisplayableBalance(token: PositionTokenDto): boolean {
  return Math.abs(token.balanceUsd) >= MIN_DISPLAY_USD;
}

export function PositionBlock({
  activeSessionId,
  hero = false,
}: {
  readonly activeSessionId: string | null;
  readonly hero?: boolean;
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
      {isSession && activeSessionId !== null ? (
        <SessionPositionBody
          portfolio={portfolio}
          sessionId={activeSessionId}
          hero={hero}
        />
      ) : (
        <PositionBody portfolio={portfolio} hero={hero} />
      )}
    </BookBlock>
  );
}

/**
 * Session-scope body — the redesigned register (owner request): the hero
 * total, the session's copy-ready deposit addresses, then the per-chain
 * holdings switcher (EVM default Ethereum + quick chains + "more" dialog,
 * Solana headed by its mark). The legacy flat token list stays GLOBAL-only.
 * `key={sessionId}` remounts the switcher per session so the selected chain
 * always resets to Ethereum.
 */
function SessionPositionBody({
  portfolio,
  sessionId,
  hero,
}: {
  readonly portfolio: PortfolioDto;
  readonly sessionId: string;
  readonly hero: boolean;
}): JSX.Element {
  const walletsQuery = useSessionWallets(sessionId);
  const scope = walletsQuery.data?.ok ? walletsQuery.data.data : null;
  return (
    <div className="flex flex-col gap-2.5">
      <TotalRow
        liveTotalUsd={portfolio.liveTotalUsd}
        snapshotTotalUsd={portfolio.snapshotTotalUsd}
        pnlVsPrev={portfolio.pnlVsPrev}
        hero={hero}
      />
      <DepositAddresses sessionId={sessionId} />
      <PositionChains
        key={sessionId}
        chains={portfolio.chains}
        hasEvmWallet={scope?.evm != null}
        hasSolanaWallet={scope?.solana != null}
      />
    </div>
  );
}

function PositionBody({
  portfolio,
  hero,
}: {
  readonly portfolio: PortfolioDto;
  readonly hero: boolean;
}): JSX.Element {
  const { liveTotalUsd, snapshotTotalUsd, pnlVsPrev, tokens } = portfolio;
  // Cap and "+N more" count only displayable rows; totals keep the full set.
  const displayable = tokens.filter(hasDisplayableBalance);
  const visible = displayable.slice(0, TOKENS_VISIBLE);
  const remainder = displayable.length - visible.length;

  return (
    <div className="flex flex-col gap-2.5">
      <TotalRow
        liveTotalUsd={liveTotalUsd}
        snapshotTotalUsd={snapshotTotalUsd}
        pnlVsPrev={pnlVsPrev}
        hero={hero}
      />
      {visible.length > 0 ? (
        // Landing .ws-stat rows: hairline-separated, key muted / value white.
        <ul className="flex flex-col">
          {visible.map((token) => (
            <TokenRow key={tokenKey(token)} token={token} />
          ))}
        </ul>
      ) : tokens.length > 0 ? (
        // Wallet HAS tokens but every row rounds to $0.00 — say so instead
        // of leaving an unexplained gap under the total.
        <p className="font-mono text-[11px] text-[var(--vex-text-3)]">
          No priced balances.
        </p>
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
  hero,
}: {
  readonly liveTotalUsd: number;
  readonly snapshotTotalUsd: number | null;
  readonly pnlVsPrev: number | null;
  readonly hero: boolean;
}): JSX.Element {
  // Blue is rationed to the single live-total figure — the one number the
  // panel is built around. Everything else stays on the muted text trio.
  // Hero = the landing display treatment: giant Archivo 800, tight-tracked.
  return (
    <div className="flex flex-col gap-0.5">
      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--vex-text-3)]">
        Total
      </span>
      <span
        className={`font-display font-extrabold leading-[1.05] tracking-[-0.02em] tabular-nums text-[var(--vex-accent-text)] ${
          hero ? "text-[27px]" : "text-[22px]"
        }`}
      >
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
    <li className="flex items-baseline justify-between gap-3 border-b border-[var(--vex-line)] py-1.5 last:border-b-0">
      <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-[var(--vex-text-2)]">
        {symbol}
      </span>
      <span className="shrink-0 font-mono text-[11px] tabular-nums text-[var(--vex-text)]">
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
