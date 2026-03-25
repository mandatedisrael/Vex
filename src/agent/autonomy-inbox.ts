/**
 * Autonomy inbox — typed event queue for Echo Loop.
 *
 * Monitors (topup, subagent completion) publish events here.
 * Echo Loop reads the inbox at the start of each sense phase.
 *
 * This replaces prompt injection with a deterministic, auditable event channel.
 */

import * as inboxRepo from "./db/repos/inbox.js";
import type { AutonomyEventType, AutonomyInboxEvent } from "./types.js";
import logger from "../utils/logger.js";

/** Publish an event to the inbox. Fire-and-forget — never throws. */
export async function publish(eventType: AutonomyEventType, payload: Record<string, unknown> = {}): Promise<void> {
  try {
    await inboxRepo.publish(eventType, payload);
    logger.info("autonomy.inbox.published", { eventType });
  } catch (err) {
    logger.error("autonomy.inbox.publish_failed", { eventType, error: err instanceof Error ? err.message : String(err) });
  }
}

/**
 * Consume all pending events (atomically marks them consumed).
 * Returns empty array if no events or on error.
 */
export async function consumeAll(): Promise<AutonomyInboxEvent[]> {
  try {
    const events = await inboxRepo.consumePending();
    if (events.length > 0) {
      logger.info("autonomy.inbox.consumed", { count: events.length, types: events.map((e) => e.eventType) });
    }
    return events;
  } catch (err) {
    logger.error("autonomy.inbox.consume_failed", { error: err instanceof Error ? err.message : String(err) });
    return [];
  }
}

/** Peek without consuming — useful for monitor status checks. */
export async function peek(): Promise<AutonomyInboxEvent[]> {
  try {
    return await inboxRepo.peekPending();
  } catch {
    return [];
  }
}

/** Build a context string from inbox events for injection into loop prompts. */
export function formatEventsForContext(events: AutonomyInboxEvent[]): string {
  if (events.length === 0) return "";

  const lines = events.map((e) => {
    switch (e.eventType) {
      case "compute_balance_low":
        return `[BALANCE ALERT] ${e.payload.message ?? "Inference provider balance is low."}`;
      case "subagent_completed":
        return `[SUBAGENT COMPLETED] ${e.payload.name ?? "unknown"}: ${e.payload.summary ?? "no summary"}`;
      case "external_alert":
        return `[ALERT] ${e.payload.message ?? "External alert received"}`;
      default:
        return `[EVENT] ${e.eventType}: ${JSON.stringify(e.payload)}`;
    }
  });

  return `--- Autonomy Events ---\n${lines.join("\n")}\n--- End Events ---`;
}
