/**
 * Shared PRIVATE lenient Zod primitives for the Polymarket CLOB validators.
 *
 * codex-002 Phase 2: these mirror the hand-written `typeof x === "..." ? x : default`
 * guards. They never reject: a wrong-typed/missing field is replaced with the same
 * default the original produced, so the enclosing object schema fails ONLY on a
 * root-type mismatch. Single-sourced here so the per-resource modules never
 * duplicate them.
 */

import { z } from "zod";

// ── Reusable lenient field primitives ─────────────────────────────────
//
// Each mirrors a hand-written `typeof x === "..." ? x : default` guard. They
// never reject: a wrong-typed/missing field is replaced with the same default
// the original produced, so the enclosing object schema fails ONLY on a
// root-type mismatch.

/** `typeof v === "string" ? v : def` */
export const strDefault = (def: string) => z.unknown().transform((v) => (typeof v === "string" ? v : def));

/** `typeof v === "number" ? v : def` */
export const numDefault = (def: number) => z.unknown().transform((v) => (typeof v === "number" ? v : def));

/** `v === true` (only the literal boolean true is truthy here). */
export const isTrue = z.unknown().transform((v) => v === true);

/**
 * `asOptionalString` semantics: a non-empty string passes through, anything
 * else (missing, empty, wrong type) becomes `undefined`.
 */
export const asOptionalString = z
  .unknown()
  .transform((v) => (typeof v === "string" && v.length > 0 ? v : undefined));

/**
 * Element-wise string filter: `Array.isArray(v) ? v.filter(isString) : <def>`.
 * Non-array root collapses to the supplied default (`[]` or `undefined`);
 * an array keeps only its string elements.
 */
export const stringArrayFilter = <D extends string[] | undefined>(def: D) =>
  z.unknown().transform((v): string[] | D =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : def,
  );

/** Shared by `openOrderSchema` (orders) and `clobTradeSchema` (trades). */
export const openOrderSideSchema = z.unknown().transform((v) => (v === "SELL" ? "SELL" : "BUY"));

/** Shared by the midpoints / spreads batch validators. */
export const batchStringMapSchema = z.record(z.string(), z.unknown()).transform((raw) => {
  const result: Record<string, string> = {};
  for (const [tokenId, value] of Object.entries(raw)) {
    if (typeof value === "string") result[tokenId] = value;
  }
  return result;
});
