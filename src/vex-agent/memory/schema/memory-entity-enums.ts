/**
 * Memory v2 — knowledge-graph entity-type bounded-vocabulary enum (S1d). The
 * SINGLE SOURCE OF TRUTH for the `entity_type` column on `memory_entities`.
 *
 * LOCKSTEP CONTRACT (rules/20 §4): the `as const` tuple here is mirrored by the
 * named CHECK constraint `me_entity_type_valid` in
 * `db/migrations/001_initial.sql` (the DB enforces it at write time). The drift
 * guard in `__tests__/vex-agent/memory/schema/memory-entity-enums.test.ts`
 * parses that CHECK's value list and asserts it equals BOTH this array AND the
 * matching `z.enum(...).options`, so SQL and TS can never silently diverge.
 *
 * Closed vocabulary for the Vex crypto-trading domain (memory-system-v2 §9 S1d):
 * - `token`         — an asset (SOL / ETH).
 * - `protocol`      — an on-chain protocol or trading venue (Hyperliquid / Uniswap).
 * - `wallet`        — an address / account.
 * - `strategy`      — a named approach.
 * - `market_regime` — a market condition (high_vol / bull).
 * - `concept`       — an indicator / metric / general idea (funding_rate / liquidation).
 * - `person`        — a counterparty / social figure.
 * - `event`         — a discrete occurrence.
 *
 * Pure module: `as const` tuple + Zod schema + derived type. No DB, no I/O.
 */

import { z } from "zod";

// ── entity_type ─────────────────────────────────────────────────
export const MEMORY_ENTITY_TYPE = [
  "token",
  "protocol",
  "wallet",
  "strategy",
  "market_regime",
  "concept",
  "person",
  "event",
] as const;

export const memoryEntityTypeSchema = z.enum(MEMORY_ENTITY_TYPE);
export type MemoryEntityType = z.infer<typeof memoryEntityTypeSchema>;
