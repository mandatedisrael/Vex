import { type FC, useMemo, useRef, useState } from "react";
import type { TradeEntry } from "../types";
import { ActionModal } from "./ActionModal";
import { TradePnlCard, type TradePnlCardHandle } from "./TradePnlCard";
import { buildTradePnlCardModel, buildTradeShareText } from "../trade-pnl-card";
import { cn } from "../utils";

interface TradeShareModalProps {
  trade: TradeEntry | null;
  open: boolean;
  onClose: () => void;
}

export const TradeShareModal: FC<TradeShareModalProps> = ({ trade, open, onClose }) => {
  const cardRef = useRef<TradePnlCardHandle>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState<"copy-card" | "copy-caption" | "download" | null>(null);

  const model = useMemo(() => (trade ? buildTradePnlCardModel(trade) : null), [trade]);
  const shareText = trade && model ? buildTradeShareText(trade, model) : "";

  const copyCaption = async () => {
    if (!shareText) return;
    setBusy("copy-caption");
    try {
      await navigator.clipboard.writeText(shareText);
      setMessage("Caption copied.");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Failed to copy caption.");
    } finally {
      setBusy(null);
    }
  };

  const copyCard = async () => {
    if (!cardRef.current) return;
    setBusy("copy-card");
    try {
      const result = await cardRef.current.copyImage();
      if (result === "copied") {
        setMessage("Card copied to clipboard.");
      } else {
        setMessage("Image copy unsupported here. Use Download PNG.");
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Failed to copy card.");
    } finally {
      setBusy(null);
    }
  };

  const downloadCard = async () => {
    if (!cardRef.current || !trade) return;
    setBusy("download");
    try {
      await cardRef.current.downloadImage();
      setMessage("Card downloaded.");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Failed to download card.");
    } finally {
      setBusy(null);
    }
  };

  const shareOnX = () => {
    if (!shareText) return;
    const url = `https://x.com/intent/tweet?text=${encodeURIComponent(shareText)}`;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  if (!trade || !model) return null;

  return (
    <ActionModal
      open={open}
      onClose={onClose}
      title="Trade Card"
      className="max-w-6xl bg-[#030712]/98"
    >
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_340px]">
        <TradePnlCard ref={cardRef} trade={trade} />

        <div className="space-y-4">
          <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-4">
            <div className="text-[11px] uppercase tracking-[0.22em] text-zinc-500">Transaction</div>
            <div className="mt-2 text-lg font-semibold text-white">{trade.input.token} → {trade.output.token}</div>
            <div className="mt-1 text-sm text-zinc-400">{trade.chain.toUpperCase()} · {trade.status.toUpperCase()}</div>
            {trade.reasoning && (
              <div className="mt-4 text-sm leading-relaxed text-zinc-300">{trade.reasoning}</div>
            )}
          </div>

          <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-4">
            <div className="text-[11px] uppercase tracking-[0.22em] text-zinc-500">Share Text</div>
            <div className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-zinc-200">{shareText}</div>
          </div>

          <div className="grid gap-2">
            <button
              type="button"
              onClick={() => void copyCard()}
              disabled={busy !== null}
              className="rounded-2xl bg-white px-4 py-3 text-sm font-semibold text-black transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy === "copy-card" ? "Copying..." : "Copy Card"}
            </button>
            <button
              type="button"
              onClick={() => void copyCaption()}
              disabled={busy !== null}
              className="rounded-2xl border border-white/[0.12] bg-white/[0.03] px-4 py-3 text-sm font-medium text-white transition hover:bg-white/[0.07] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy === "copy-caption" ? "Copying..." : "Copy Caption"}
            </button>
            <button
              type="button"
              onClick={() => void downloadCard()}
              disabled={busy !== null}
              className="rounded-2xl border border-white/[0.12] bg-white/[0.03] px-4 py-3 text-sm font-medium text-white transition hover:bg-white/[0.07] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy === "download" ? "Preparing..." : "Download PNG"}
            </button>
            <button
              type="button"
              onClick={shareOnX}
              className={cn(
                "rounded-2xl border px-4 py-3 text-sm font-medium transition",
                model.tone === "profit"
                  ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300 hover:bg-emerald-400/16"
                  : "border-rose-400/30 bg-rose-400/10 text-rose-300 hover:bg-rose-400/16",
              )}
            >
              Share on X
            </button>
          </div>

          {message && (
            <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] px-4 py-3 text-xs text-zinc-300">
              {message}
            </div>
          )}
        </div>
      </div>
    </ActionModal>
  );
};
