import type { TradeEntry } from "./types";

export interface TradePnlCardModel {
  headline: string;
  subtitle: string;
  pnlDisplay: string;
  pnlPercentDisplay: string;
  investedDisplay: string;
  positionDisplay: string;
  investedNote: string;
  positionNote: string;
  pnlNote: string;
  tone: "profit" | "loss";
  txLabel: string;
}

const STABLE_TOKENS = new Set([
  "USDC",
  "USDT",
  "DAI",
  "FDUSD",
  "USD",
]);

function parseAmount(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatUsd(value: number): string {
  return `${value >= 0 ? "+" : "-"}$${Math.abs(value).toFixed(2)}`;
}

function formatMetricUsd(value: number): string {
  return `$${value.toFixed(2)}`;
}

function formatPct(value: number): string {
  return `${value >= 0 ? "+" : "-"}${Math.abs(value).toFixed(2)}%`;
}

function formatTokenNote(amount: string, token: string): string {
  const parsed = parseAmount(amount);
  if (parsed == null) return token;
  return `${parsed.toFixed(parsed >= 100 ? 0 : parsed >= 10 ? 2 : 4)} ${token}`;
}

function compactHash(value: string): string {
  if (value.length <= 18) return value;
  return `${value.slice(0, 10)}...${value.slice(-6)}`;
}

function deriveHeadline(trade: TradeEntry): string {
  if (trade.type === "prediction") {
    const side = typeof trade.meta.side === "string" ? trade.meta.side.toUpperCase() : trade.output.token.toUpperCase();
    return side.startsWith("$") ? side : `$${side}`;
  }

  const inputToken = trade.input.token.toUpperCase();
  const outputToken = trade.output.token.toUpperCase();
  const preferred = STABLE_TOKENS.has(outputToken) && !STABLE_TOKENS.has(inputToken)
    ? inputToken
    : outputToken;

  return preferred.startsWith("$") ? preferred : `$${preferred}`;
}

function deriveSubtitle(trade: TradeEntry): string {
  if (trade.type === "prediction" && typeof trade.meta.marketTitle === "string" && trade.meta.marketTitle.trim()) {
    return `${trade.meta.marketTitle} · ${trade.chain.toUpperCase()}`;
  }
  return `${trade.input.token.toUpperCase()} → ${trade.output.token.toUpperCase()} · ${trade.chain.toUpperCase()}`;
}

function deriveInvestedAndPosition(trade: TradeEntry): { invested: number; position: number } | null {
  const pnl = trade.pnl?.amountUsd;
  let invested = trade.input.valueUsd ?? null;
  let position = trade.output.valueUsd ?? null;

  if (invested == null && position != null && pnl != null) {
    invested = position - pnl;
  }

  if (position == null && invested != null && pnl != null) {
    position = invested + pnl;
  }

  if ((invested == null || position == null) && pnl != null && trade.pnl?.percentChange) {
    const pct = trade.pnl.percentChange / 100;
    if (pct !== 0) {
      const inferredInvested = pnl / pct;
      if (Number.isFinite(inferredInvested)) {
        invested = invested ?? inferredInvested;
        position = position ?? inferredInvested + pnl;
      }
    }
  }

  if (invested == null || position == null) return null;
  return { invested, position };
}

export function canGenerateTradePnlCard(trade: TradeEntry): boolean {
  if (!trade.pnl) return false;
  if (trade.status === "open" || trade.status === "pending" || trade.status === "failed") return false;
  return deriveInvestedAndPosition(trade) != null;
}

export function buildTradePnlCardModel(trade: TradeEntry): TradePnlCardModel | null {
  if (!trade.pnl) return null;
  const values = deriveInvestedAndPosition(trade);
  if (!values) return null;

  const tone = trade.pnl.amountUsd >= 0 ? "profit" : "loss";
  const txSource = trade.signature ?? trade.explorerUrl ?? trade.id;

  return {
    headline: deriveHeadline(trade),
    subtitle: deriveSubtitle(trade),
    pnlDisplay: formatUsd(trade.pnl.amountUsd),
    pnlPercentDisplay: formatPct(trade.pnl.percentChange),
    investedDisplay: formatMetricUsd(values.invested),
    positionDisplay: formatMetricUsd(values.position),
    investedNote: formatTokenNote(trade.input.amount, trade.input.token),
    positionNote: formatTokenNote(trade.output.amount, trade.output.token),
    pnlNote: `${trade.pnl.realized ? "REALIZED" : "UNREALIZED"} · ${trade.status.toUpperCase()}`,
    tone,
    txLabel: compactHash(txSource),
  };
}

export function buildTradeShareText(trade: TradeEntry, model: TradePnlCardModel): string {
  const subject = trade.type === "prediction" && typeof trade.meta.marketTitle === "string" && trade.meta.marketTitle.trim()
    ? trade.meta.marketTitle
    : `${trade.input.token.toUpperCase()} → ${trade.output.token.toUpperCase()}`;
  const explorer = trade.explorerUrl ? ` ${trade.explorerUrl}` : "";

  return [
    `Closed ${subject} on ${trade.chain}.`,
    `${model.pnlDisplay} (${model.pnlPercentDisplay}).`,
    "Every action echoes.",
  ].join(" ") + explorer;
}
