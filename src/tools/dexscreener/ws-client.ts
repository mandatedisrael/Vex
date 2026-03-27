/**
 * DexScreener WebSocket client for real-time streaming.
 *
 * Uses native Node 22+ WebSocket (no external dependency).
 * Supports profiles, boosts, and boosts-top channels.
 * Auto-reconnects with exponential backoff.
 */

import { EventEmitter } from "node:events";
import { loadConfig } from "../../config/store.js";
import logger from "../../utils/logger.js";
import type { DexStreamChannel } from "./types.js";

const CHANNEL_PATHS: Record<DexStreamChannel, string> = {
  profiles: "/token-profiles/latest/v1",
  boosts: "/token-boosts/latest/v1",
  "boosts-top": "/token-boosts/top/v1",
  "community-takeovers": "/community-takeovers/latest/v1",
  ads: "/ads/latest/v1",
};

const INITIAL_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30000;
const BACKOFF_MULTIPLIER = 2;
const JITTER_FACTOR = 0.2;

export interface DexScreenerStreamOptions {
  wsUrl?: string;
  channel: DexStreamChannel;
}

/**
 * DexScreenerStream — EventEmitter-based WebSocket client.
 *
 * Events:
 * - "handshake" (data: {limit: number, data: T[]})
 * - "update" (data: T)
 * - "connected" ()
 * - "disconnected" (reason: string)
 * - "error" (err: Error)
 */
export class DexScreenerStream extends EventEmitter {
  private ws: WebSocket | null = null;
  private readonly wsUrl: string;
  private readonly channel: DexStreamChannel;
  private destroyed = false;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private handshakeReceived = false;

  constructor(options: DexScreenerStreamOptions) {
    super();
    const baseUrl = options.wsUrl ?? loadConfig().services.dexScreenerApiUrl.replace(/^http/, "ws");
    const path = CHANNEL_PATHS[options.channel];
    this.wsUrl = `${baseUrl}${path}`;
    this.channel = options.channel;
  }

  connect(): void {
    if (this.ws) return;
    if (this.destroyed) return;

    logger.debug(`[DexScreenerStream] Connecting to ${this.wsUrl}`);

    this.ws = new WebSocket(this.wsUrl);
    this.handshakeReceived = false;

    this.ws.addEventListener("open", () => {
      logger.info(`[DexScreenerStream] Connected to ${this.channel}`);
      this.reconnectAttempt = 0;
      this.emit("connected");
    });

    this.ws.addEventListener("message", (event) => {
      try {
        const data = JSON.parse(typeof event.data === "string" ? event.data : String(event.data));

        if (!this.handshakeReceived) {
          this.handshakeReceived = true;
          this.emit("handshake", data);
        } else {
          this.emit("update", data);
        }
      } catch (err) {
        logger.warn(`[DexScreenerStream] Failed to parse message: ${err}`);
      }
    });

    this.ws.addEventListener("close", (event) => {
      const reason = event.reason || `code ${event.code}`;
      logger.warn(`[DexScreenerStream] Disconnected: ${reason}`);
      this.ws = null;
      this.emit("disconnected", reason);

      if (!this.destroyed) {
        this.scheduleReconnect();
      }
    });

    this.ws.addEventListener("error", (event) => {
      const message = "message" in event ? String(event.message) : "WebSocket error";
      logger.error(`[DexScreenerStream] Error: ${message}`);
      this.emit("error", new Error(message));
    });
  }

  disconnect(): void {
    this.destroyed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    logger.debug("[DexScreenerStream] Disconnected and cleaned up");
  }

  private scheduleReconnect(): void {
    const baseDelay = Math.min(
      INITIAL_BACKOFF_MS * Math.pow(BACKOFF_MULTIPLIER, this.reconnectAttempt),
      MAX_BACKOFF_MS,
    );
    const jitter = baseDelay * JITTER_FACTOR * (Math.random() * 2 - 1);
    const delay = Math.max(0, baseDelay + jitter);

    this.reconnectAttempt++;
    logger.debug(`[DexScreenerStream] Reconnecting in ${Math.round(delay)}ms (attempt ${this.reconnectAttempt})`);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }
}
