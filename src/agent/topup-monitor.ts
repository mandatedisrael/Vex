/**
 * Auto-top-up monitor — detects low inference balance, alerts agent.
 *
 * Hybrid approach:
 * 1. Code-level monitor checks balance every 60s (zero inference cost)
 * 2. When low, publishes event to autonomy inbox with full context
 * 3. Echo Loop reads the event and agent executes top-up via tool calls
 *
 * The monitor NEVER executes SDK calls directly — the agent does,
 * creating an auditable conversation trail.
 */

import { getProviderBalance } from "./billing.js";
import { getInferenceConfig } from "./engine.js";
import { getActiveProvider } from "./providers/registry.js";
import { publish } from "./autonomy-inbox.js";
import * as topupRepo from "./db/repos/topup.js";
import {
  TOPUP_MONITOR_INTERVAL_MS,
  TOPUP_COOLDOWN_MS,
  TOPUP_BASELINE_MULTIPLIER,
  TOPUP_MAX_CONSECUTIVE_ALERTS,
} from "./constants.js";
import type { AgentEvent } from "./types.js";
import type { EventEmitter } from "./engine.js";
import logger from "../utils/logger.js";

// ── State ────────────────────────────────────────────────────────────

let monitorTimer: ReturnType<typeof setInterval> | null = null;
let lastAlertAt = 0;
let consecutiveAlerts = 0;
let broadcastEmit: EventEmitter | null = null;

export function setTopupBroadcast(emit: EventEmitter): void {
  broadcastEmit = emit;
}

/** Reset internal state — exported for testing only. */
export function _resetForTest(): void {
  lastAlertAt = 0;
  consecutiveAlerts = 0;
}

// ── Lifecycle ────────────────────────────────────────────────────────

export function startMonitor(): void {
  if (monitorTimer) return;
  monitorTimer = setInterval(checkBalance, TOPUP_MONITOR_INTERVAL_MS);
  logger.info("topup-monitor.started", { intervalMs: TOPUP_MONITOR_INTERVAL_MS });
}

export function stopMonitor(): void {
  if (monitorTimer) {
    clearInterval(monitorTimer);
    monitorTimer = null;
    logger.info("topup-monitor.stopped");
  }
}

// ── Core check ───────────────────────────────────────────────────────

/** Exported for testing. Normally called by the monitor interval. */
export async function checkBalance(): Promise<void> {
  try {
    const config = getInferenceConfig();
    if (!config) return;

    // Top-up monitor is 0G Compute only — other providers use different billing
    const provider = getActiveProvider();
    if (!provider || provider.id !== "0g-compute") return;

    const balance = await provider.getBalance();
    if (!balance) return;

    if (!balance.isLow) {
      if (consecutiveAlerts > 0) {
        consecutiveAlerts = 0;
        logger.info("topup-monitor.balance_recovered", { available: balance.availableRaw, currency: balance.currency });
      }
      return;
    }

    if (Date.now() - lastAlertAt < TOPUP_COOLDOWN_MS) return;

    lastAlertAt = Date.now();
    consecutiveAlerts++;

    await handleLowBalance(config, balance);

    if (consecutiveAlerts >= TOPUP_MAX_CONSECUTIVE_ALERTS) {
      await handleCriticalEscalation(balance.availableRaw);
    }
  } catch (err) {
    logger.error("topup-monitor.check_failed", { error: err instanceof Error ? err.message : String(err) });
  }
}

async function handleLowBalance(
  config: { provider: string; model: string },
  balance: { availableRaw: number; availableDisplay: string; currency: string; isLow: boolean; lowBalanceMessage?: string },
): Promise<void> {
  logger.warn("topup-monitor.balance_low", {
    available: balance.availableRaw, currency: balance.currency, consecutiveAlerts,
  });

  await topupRepo.recordEvent({
    eventType: "balance_check",
    balanceBefore: balance.availableRaw,
    metadata: { consecutiveAlerts },
  });

  const message = balance.lowBalanceMessage ?? `Low balance: ${balance.availableDisplay}`;

  await publish("compute_balance_low", {
    message,
    providerAddress: config.provider, model: config.model,
    available: balance.availableRaw, currency: balance.currency,
    consecutiveAlerts,
  });

  broadcastEmit?.({
    type: "balance_low",
    data: { message, providerBalanceRaw: balance.availableRaw, ledgerLockedOg: balance.availableRaw, threshold: 0 },
  });
}

async function handleCriticalEscalation(currentLockedOg: number): Promise<void> {
  logger.error("topup-monitor.critical", { consecutiveAlerts });
  await topupRepo.recordEvent({
    eventType: "critical_alert",
    balanceBefore: currentLockedOg,
    metadata: { reason: "Agent failed to top up after multiple alerts" },
  });
  broadcastEmit?.({
    type: "error",
    data: { message: `CRITICAL: Inference balance critically low after ${consecutiveAlerts} alerts. Agent may not be able to top up automatically.` },
  });
}

/** Called after a successful top-up to update the baseline. */
export async function onTopupSuccess(newLockedOg: number, newTotalOg: number, amount: number): Promise<void> {
  await topupRepo.updateBaseline(newLockedOg, newTotalOg, amount);
  await topupRepo.recordEvent({
    eventType: "topup_succeeded",
    amount: amount,
    balanceAfter: newLockedOg,
    source: "auto",
  });
  consecutiveAlerts = 0;
  logger.info("topup-monitor.topup_succeeded", { newLockedOg, amount });
}

// ── Alert message builder ────────────────────────────────────────────

function buildAlertMessage(
  providerAddress: string,
  model: string,
  balance: { providerLockedOg: number; ledgerAvailableOg: number },
  threshold: number,
): string {
  return `[COMPUTE BALANCE ALERT] Your inference balance is critically low.

Current state:
- Provider (broker) address: ${providerAddress}
- Model: ${model}
- Provider locked: ${balance.providerLockedOg.toFixed(4)} 0G (threshold: ${threshold.toFixed(4)} 0G)
- Ledger available: ${balance.ledgerAvailableOg.toFixed(4)} 0G

Top-up procedure (two steps):
1. First deposit A0GI from wallet to your 0G Compute ledger: 0g-compute_ledger_deposit
2. Then fund the broker from your ledger: 0g-compute_ledger_fund --provider ${providerAddress}

If ledger already has available funds, skip step 1 and go directly to step 2.
Read the 0G Compute skill reference for full details.`;
}
