import { type FC, useState } from "react";
import type { TradeEntry } from "../types";
import { TradePnlCard } from "../components/TradePnlCard";
import { TradeShareModal } from "../components/TradeShareModal";

const DEMO_TRADE: TradeEntry = {
  id: "demo-trade-sol-usdc",
  timestamp: new Date().toISOString(),
  type: "swap",
  chain: "solana",
  status: "closed",
  input: {
    token: "SOL",
    amount: "0.7600",
    valueUsd: 100,
  },
  output: {
    token: "USDC",
    amount: "150.0000",
    valueUsd: 150,
  },
  pnl: {
    amountUsd: 50,
    percentChange: 50,
    realized: true,
  },
  meta: {
    dex: "jupiter",
  },
  reasoning: "Momentum exit into strength after confirmation candle and target hit.",
  signature: "9333534516c37890demo8f3f87f1ae5b6a5af2",
  explorerUrl: "https://solscan.io/tx/9333534516c37890demo8f3f87f1ae5b6a5af2",
};

export const PnlCardDemoPage: FC = () => {
  const [open, setOpen] = useState(false);

  return (
    <div className="dark min-h-screen bg-[#02050c] px-6 py-10 text-white">
      <div className="mx-auto max-w-6xl space-y-8">
        <div>
          <div className="text-[11px] uppercase tracking-[0.24em] text-zinc-500">Demo</div>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">PnL Card Preview</h1>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-zinc-400">
            Uses the production trade card renderer on top of <code>/pnl_card.png</code>.
          </p>
        </div>

        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
          <TradePnlCard trade={DEMO_TRADE} />

          <div className="rounded-3xl border border-white/[0.08] bg-white/[0.03] p-5">
            <div className="text-[11px] uppercase tracking-[0.22em] text-zinc-500">Demo Trade</div>
            <div className="mt-3 text-xl font-semibold">$SOL</div>
            <div className="mt-1 text-sm text-zinc-400">Closed swap · Solana</div>
            <div className="mt-6 grid gap-3 text-sm text-zinc-300">
              <div>Invested: $100.00</div>
              <div>Position: $150.00</div>
              <div>PnL: +$50.00 (+50.00%)</div>
            </div>
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="mt-8 w-full rounded-2xl bg-white px-4 py-3 text-sm font-semibold text-black transition hover:bg-zinc-200"
            >
              Open Share Modal
            </button>
          </div>
        </div>
      </div>

      <TradeShareModal trade={DEMO_TRADE} open={open} onClose={() => setOpen(false)} />
    </div>
  );
};
