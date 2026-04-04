/**
 * BalanceMonitor types and constants.
 */

import type { Address } from "viem";

// ── Anti-spam state ──────────────────────────────────────────────────

export interface ProviderAlertState {
  lastAlertAt: number;
  lastAlertBalance: string; // stringified for JSON
}

export interface ProviderThresholdState {
  threshold: number;
  recommendedMin: number;
}

export interface MonitorState {
  providers: string[];
  mode: MonitorMode;
  threshold?: number;
  buffer?: number;
  alertRatio?: number;
  intervalSec: number;
  lastCheckAt: number;
  alerts: Record<string, ProviderAlertState>;
  providerThresholds?: Record<string, ProviderThresholdState>;
}

export const ALERT_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour
export const ALERT_DROP_THRESHOLD = 0.5; // alert again if balance dropped another 50%

// ── Monitor ──────────────────────────────────────────────────────────

export type MonitorMode = "fixed" | "recommended";

export interface BalanceMonitorOptions {
  providers: Address[];
  mode: MonitorMode;
  threshold?: number;      // required for fixed
  buffer?: number;         // default 0, extra 0G above recommended
  alertRatio?: number;     // default 1.2
  intervalSec: number;
}
