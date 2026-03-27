/**
 * Polymarket Market WebSocket — real-time orderbook, prices, trades.
 *
 * Public channel. Subscribe by asset IDs (token IDs).
 * Events: book, price_change, last_trade_price, tick_size_change, best_bid_ask, new_market, market_resolved.
 * Ping/pong every 10 seconds.
 */

import { EventEmitter } from "node:events";
import logger from "../../../utils/logger.js";

const WS_URL = "wss://ws-subscriptions-clob.polymarket.com/ws/market";
const PING_INTERVAL_MS = 10_000;
const INITIAL_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30_000;
const BACKOFF_MULTIPLIER = 2;

export interface MarketSubscribeOptions {
  assetIds: string[];
  initialDump?: boolean;
  level?: 1 | 2 | 3;
  customFeatureEnabled?: boolean;
}

/**
 * PolyMarketStream — EventEmitter WebSocket client for Market channel.
 *
 * Events:
 * - "book" (data: { event_type, asset_id, market, bids, asks, timestamp, hash })
 * - "price_change" (data: { event_type, market, price_changes[], timestamp })
 * - "last_trade_price" (data: { event_type, asset_id, market, price, size, side, timestamp })
 * - "tick_size_change" (data: { event_type, asset_id, market, old_tick_size, new_tick_size })
 * - "best_bid_ask" (data: { event_type, asset_id, market, best_bid, best_ask, spread })
 * - "new_market" (data: { event_type, id, question, market, assets_ids, outcomes, ... })
 * - "market_resolved" (data: { event_type, id, market, winning_asset_id, winning_outcome, ... })
 * - "connected" ()
 * - "disconnected" (reason: string)
 * - "error" (err: Error)
 */
export class PolyMarketStream extends EventEmitter {
  private ws: WebSocket | null = null;
  private destroyed = false;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private subscribeOptions: MarketSubscribeOptions;

  constructor(options: MarketSubscribeOptions) {
    super();
    this.subscribeOptions = options;
  }

  connect(): void {
    if (this.ws || this.destroyed) return;

    logger.debug("[PolyMarketStream] Connecting...");
    this.ws = new WebSocket(WS_URL);

    this.ws.addEventListener("open", () => {
      logger.info("[PolyMarketStream] Connected");
      this.reconnectAttempt = 0;
      this.emit("connected");

      this.ws!.send(JSON.stringify({
        assets_ids: this.subscribeOptions.assetIds,
        type: "market",
        initial_dump: this.subscribeOptions.initialDump ?? true,
        level: this.subscribeOptions.level ?? 2,
        custom_feature_enabled: this.subscribeOptions.customFeatureEnabled ?? false,
      }));

      this.startPing();
    });

    this.ws.addEventListener("message", (event) => {
      const text = typeof event.data === "string" ? event.data : String(event.data);
      if (text === "PONG") return;

      try {
        const data = JSON.parse(text);
        const eventType = typeof data.event_type === "string" ? data.event_type : "unknown";
        this.emit(eventType, data);
      } catch {
        logger.warn(`[PolyMarketStream] Failed to parse: ${text.slice(0, 100)}`);
      }
    });

    this.ws.addEventListener("close", (event) => {
      const reason = event.reason || `code ${event.code}`;
      logger.warn(`[PolyMarketStream] Disconnected: ${reason}`);
      this.cleanup();
      this.emit("disconnected", reason);
      if (!this.destroyed) this.scheduleReconnect();
    });

    this.ws.addEventListener("error", (event) => {
      const message = "message" in event ? String(event.message) : "WebSocket error";
      logger.error(`[PolyMarketStream] Error: ${message}`);
      this.emit("error", new Error(message));
    });
  }

  subscribe(assetIds: string[]): void {
    if (!this.ws) return;
    this.ws.send(JSON.stringify({ operation: "subscribe", assets_ids: assetIds }));
  }

  unsubscribe(assetIds: string[]): void {
    if (!this.ws) return;
    this.ws.send(JSON.stringify({ operation: "unsubscribe", assets_ids: assetIds }));
  }

  disconnect(): void {
    this.destroyed = true;
    this.cleanup();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  private startPing(): void {
    this.stopPing();
    this.pingTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send("PING");
      }
    }, PING_INTERVAL_MS);
  }

  private stopPing(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private cleanup(): void {
    this.stopPing();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private scheduleReconnect(): void {
    const delay = Math.min(INITIAL_BACKOFF_MS * Math.pow(BACKOFF_MULTIPLIER, this.reconnectAttempt), MAX_BACKOFF_MS);
    const jitter = delay * 0.2 * (Math.random() * 2 - 1);
    this.reconnectAttempt++;
    logger.debug(`[PolyMarketStream] Reconnecting in ${Math.round(delay + jitter)}ms`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.ws = null;
      this.connect();
    }, Math.max(0, delay + jitter));
  }
}
