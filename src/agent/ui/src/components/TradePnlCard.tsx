import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import type { TradeEntry } from "../types";
import { buildTradePnlCardModel, type TradePnlCardModel } from "../trade-pnl-card";
import { cn } from "../utils";

const CARD_WIDTH = 1200;
const CARD_HEIGHT = 800;

async function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Failed to load image: ${src}`));
    image.src = src;
  });
}

function drawLabel(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
): void {
  ctx.font = "500 28px system-ui, sans-serif";
  ctx.fillStyle = "rgba(229, 231, 235, 0.6)";
  ctx.fillText(text, x, y);
}

function drawValue(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  tone: "default" | "profit" | "loss" = "default",
): void {
  ctx.font = "700 48px system-ui, sans-serif";
  ctx.fillStyle = tone === "profit"
    ? "#48d18d"
    : tone === "loss"
      ? "#ff6b81"
      : "#ffffff";
  ctx.fillText(text, x, y);
}

function drawNote(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  tone: "default" | "profit" | "loss" = "default",
): void {
  ctx.font = "500 22px system-ui, sans-serif";
  ctx.fillStyle = tone === "profit"
    ? "rgba(72, 209, 141, 0.78)"
    : tone === "loss"
      ? "rgba(255, 107, 129, 0.78)"
      : "rgba(229, 231, 235, 0.58)";
  ctx.fillText(text, x, y);
}

function drawCard(
  ctx: CanvasRenderingContext2D,
  background: HTMLImageElement,
  model: TradePnlCardModel,
): void {
  ctx.clearRect(0, 0, CARD_WIDTH, CARD_HEIGHT);
  ctx.drawImage(background, 0, 0, CARD_WIDTH, CARD_HEIGHT);

  ctx.save();
  ctx.translate(32, 620);
  ctx.rotate(-Math.PI / 2);
  ctx.font = "500 18px system-ui, sans-serif";
  ctx.fillStyle = "rgba(229, 231, 235, 0.42)";
  ctx.fillText(model.txLabel, 0, 0);
  ctx.restore();

  ctx.shadowColor = model.tone === "profit" ? "rgba(72, 209, 141, 0.32)" : "rgba(255, 107, 129, 0.28)";
  ctx.shadowBlur = 24;
  ctx.font = "800 68px system-ui, sans-serif";
  ctx.fillStyle = "#ffffff";
  ctx.fillText(model.headline, 86, 354);

  ctx.shadowColor = model.tone === "profit" ? "rgba(72, 209, 141, 0.44)" : "rgba(255, 107, 129, 0.4)";
  ctx.shadowBlur = 28;
  ctx.font = "800 96px system-ui, sans-serif";
  ctx.fillStyle = model.tone === "profit" ? "#48d18d" : "#ff6b81";
  ctx.fillText(model.pnlDisplay, 82, 475);

  ctx.shadowBlur = 0;
  ctx.font = "500 26px system-ui, sans-serif";
  ctx.fillStyle = "rgba(229, 231, 235, 0.78)";
  ctx.fillText(model.subtitle, 88, 526);

  drawLabel(ctx, "Invested", 86, 614);
  drawLabel(ctx, "Position", 310, 614);
  drawLabel(ctx, "PNL", 532, 614);

  drawValue(ctx, model.investedDisplay, 86, 668);
  drawValue(ctx, model.positionDisplay, 310, 668);
  drawValue(ctx, model.pnlPercentDisplay, 532, 668, model.tone);

  drawNote(ctx, `(${model.investedNote})`, 86, 710);
  drawNote(ctx, `(${model.positionNote})`, 310, 710);
  drawNote(ctx, `(${model.pnlNote})`, 532, 710, model.tone);
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Failed to export trade card"));
    }, "image/png");
  });
}

export interface TradePnlCardHandle {
  copyImage: () => Promise<"copied" | "unsupported">;
  downloadImage: (filename?: string) => Promise<void>;
}

interface TradePnlCardProps {
  trade: TradeEntry;
  className?: string;
}

export const TradePnlCard = forwardRef<TradePnlCardHandle, TradePnlCardProps>(({ trade, className }, ref) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState<string | null>(null);
  const model = useMemo(() => buildTradePnlCardModel(trade), [trade]);

  const renderCanvas = useCallback(async () => {
    if (!model || !canvasRef.current) return;
    try {
      setError(null);
      const background = await loadImage("/pnl_card.png");
      const canvas = canvasRef.current;
      canvas.width = CARD_WIDTH;
      canvas.height = CARD_HEIGHT;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        setError("Canvas not available");
        return;
      }
      drawCard(ctx, background, model);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to render card");
    }
  }, [model]);

  useEffect(() => {
    void renderCanvas();
  }, [renderCanvas]);

  useImperativeHandle(ref, () => ({
    copyImage: async () => {
      const canvas = canvasRef.current;
      if (!canvas || typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) {
        return "unsupported";
      }
      const blob = await canvasToBlob(canvas);
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      return "copied";
    },
    downloadImage: async (filename = `${trade.id}-pnl-card.png`) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const blob = await canvasToBlob(canvas);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      link.click();
      URL.revokeObjectURL(url);
    },
  }), [trade.id]);

  if (!model) {
    return (
      <div className={cn("rounded-3xl border border-white/[0.08] bg-white/[0.03] p-6 text-sm text-muted-foreground", className)}>
        Trade card unavailable for this entry.
      </div>
    );
  }

  return (
    <div className={cn("space-y-3", className)}>
      <div className="overflow-hidden rounded-[28px] border border-white/[0.08] bg-black shadow-[0_22px_60px_rgba(0,0,0,0.45)]">
        <canvas ref={canvasRef} className="block h-auto w-full" />
      </div>
      {error && <div className="text-xs text-status-error">{error}</div>}
    </div>
  );
});

TradePnlCard.displayName = "TradePnlCard";
