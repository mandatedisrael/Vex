/**
 * Polymarket User WebSocket — real-time order and trade updates.
 *
 * Authenticated channel. Requires CLOB API credentials.
 * Events: order (PLACEMENT/UPDATE/CANCELLATION), trade (MATCHED/MINED/CONFIRMED/FAILED).
 * Ping/pong every 10 seconds.
 */

import { EventEmitter } from "node:events";
import { requirePolyClobCredentials } from "../auth.js";
import logger from "../../../utils/logger.js";

const WS_URL = "wss://ws-subscriptions-clob.polymarket.com/ws/user";
const PING_INTERVAL_MS = 10_000;
const INITIAL_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30_000;
const BACKOFF_MULTIPLIER = 2;

export interface UserSubscribeOptions {
  markets?: string[];
}

/**
 * PolyUserStream — EventEmitter WebSocket client for User channel.
 *
 * Events:
 * - "order" (data: { event_type, id, market, asset_id, side, price, type: PLACEMENT|UPDATE|CANCELLATION, status, ... })
 * - "trade" (data: { event_type, type: TRADE, id, market, asset_id, side, size, price, status, trader_side, ... })
 * - "connected" ()
 * - "disconnected" (reason: string)
 * - "error" (err: Error)
 */
export class PolyUserStream extends EventEmitter {
  private ws: WebSocket | null = null;
  private destroyed = false;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private options: UserSubscribeOptions;

  constructor(options?: UserSubscribeOptions) {
    super();
    this.options = options ?? {};
  }

  connect(): void {
    if (this.ws || this.destroyed) return;

    const creds = requirePolyClobCredentials();

    logger.debug("[PolyUserStream] Connecting...");
    this.ws = new WebSocket(WS_URL);

    this.ws.addEventListener("open", () => {
      logger.info("[PolyUserStream] Connected");
      this.reconnectAttempt = 0;
      this.emit("connected");

      const subscribeMsg: Record<string, unknown> = {
        auth: {
          apiKey: creds.apiKey,
          secret: creds.apiSecret,
          passphrase: creds.passphrase,
        },
        type: "user",
      };
      if (this.options.markets && this.options.markets.length > 0) {
        subscribeMsg.markets = this.options.markets;
      }

      this.ws!.send(JSON.stringify(subscribeMsg));
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
        logger.warn(`[PolyUserStream] Failed to parse: ${text.slice(0, 100)}`);
      }
    });

    this.ws.addEventListener("close", (event) => {
      const reason = event.reason || `code ${event.code}`;
      logger.warn(`[PolyUserStream] Disconnected: ${reason}`);
      this.cleanup();
      this.emit("disconnected", reason);
      if (!this.destroyed) this.scheduleReconnect();
    });

    this.ws.addEventListener("error", (event) => {
      const message = "message" in event ? String(event.message) : "WebSocket error";
      logger.error(`[PolyUserStream] Error: ${message}`);
      this.emit("error", new Error(message));
    });
  }

  subscribeMarkets(markets: string[]): void {
    if (!this.ws) return;
    this.ws.send(JSON.stringify({ operation: "subscribe", markets }));
  }

  unsubscribeMarkets(markets: string[]): void {
    if (!this.ws) return;
    this.ws.send(JSON.stringify({ operation: "unsubscribe", markets }));
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
    logger.debug(`[PolyUserStream] Reconnecting in ${Math.round(delay + jitter)}ms`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.ws = null;
      this.connect();
    }, Math.max(0, delay + jitter));
  }
}
