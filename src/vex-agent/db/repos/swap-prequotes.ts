/**
 * Swap prequotes repo — durable swap-quote safety preview store (Stage 6c).
 *
 * Every successful swap QUOTE records one row here capturing the fail-closed
 * token-safety verdict computed at quote time, keyed by a deterministic
 * match-hash over the trade identity (see
 * `src/vex-agent/tools/protocols/swap-prequote.ts` for the hash + verdict
 * computation). A future runtime gate (Stage 7, NOT in this repo) reads the
 * latest fresh matching row before a swap EXECUTE and fails closed when none
 * exists.
 *
 * Migration: `src/vex-agent/db/migrations/029_swap_prequotes.sql`.
 *
 * **Session ownership invariant** (mirrors wallet-intents): every lookup
 * includes `session_id` in the predicate — a read from a different session
 * must miss even when the `match_hash` is known. Tests pin the cross-session
 * miss.
 *
 * **Data-exposure invariant**: `safetyDetail` / `routeRef` carry ONLY bounded,
 * structural fields. Raw provider/HTTP/error text NEVER reaches these columns
 * (the recorder is responsible for building structural-only payloads).
 */

import { execute, queryOne } from "../client.js";
import { jsonb } from "../params.js";

export type PrequoteFamily = "eip155" | "solana";
export type PrequoteKind = "swap" | "bridge";
export type SafetyVerdict = "pass" | "fail" | "unknown";

export interface SwapPrequote {
  prequoteId: string;
  sessionId: string;
  matchHash: string;
  kind: PrequoteKind;
  family: PrequoteFamily;
  provider: string;
  chainId: number | null;
  walletAddress: string;
  tokenIn: string;
  tokenOut: string;
  amount: string;
  slippageBps: number | null;
  safetyVerdict: SafetyVerdict;
  safetyDetail: Record<string, unknown>;
  routeRef: Record<string, unknown> | null;
  createdAt: string;
  expiresAt: string;
}

export interface CreatePrequoteInput {
  prequoteId: string;
  sessionId: string;
  matchHash: string;
  kind: PrequoteKind;
  family: PrequoteFamily;
  provider: string;
  chainId: number | null;
  walletAddress: string;
  tokenIn: string;
  tokenOut: string;
  amount: string;
  slippageBps: number | null;
  safetyVerdict: SafetyVerdict;
  /**
   * Structural-only safety block. MUST be a JSON object (DB CHECK
   * `jsonb_typeof = 'object'`). The recorder is responsible for building a
   * bounded payload — raw provider/HTTP/error text never reaches this field.
   */
  safetyDetail: Record<string, unknown>;
  /** Structural-only route reference, or null. */
  routeRef?: Record<string, unknown> | null;
  expiresAt: string;
}

// ── ISO normalisation (TIMESTAMPTZ → Date, see wallet-intents repo) ──

function toIso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

const SELECT_COLUMNS =
  "prequote_id, session_id, match_hash, kind, family, provider, " +
  "chain_id, wallet_address, token_in, token_out, amount, slippage_bps, " +
  "safety_verdict, safety_detail, route_ref, created_at, expires_at";

function mapRow(r: Record<string, unknown>): SwapPrequote {
  return {
    prequoteId: r.prequote_id as string,
    sessionId: r.session_id as string,
    matchHash: r.match_hash as string,
    kind: r.kind as PrequoteKind,
    family: r.family as PrequoteFamily,
    provider: r.provider as string,
    // BIGINT comes back from node-postgres as a string; normalise to number.
    chainId: r.chain_id === null || r.chain_id === undefined ? null : Number(r.chain_id),
    walletAddress: r.wallet_address as string,
    tokenIn: r.token_in as string,
    tokenOut: r.token_out as string,
    amount: r.amount as string,
    slippageBps:
      r.slippage_bps === null || r.slippage_bps === undefined
        ? null
        : Number(r.slippage_bps),
    safetyVerdict: r.safety_verdict as SafetyVerdict,
    safetyDetail: (r.safety_detail as Record<string, unknown>) ?? {},
    routeRef: (r.route_ref as Record<string, unknown> | null) ?? null,
    createdAt: toIso(r.created_at as string | Date),
    expiresAt: toIso(r.expires_at as string | Date),
  };
}

// ── create ──────────────────────────────────────────────────────────────

const INSERT_SQL = `INSERT INTO swap_prequotes (
  prequote_id, session_id, match_hash, kind, family, provider,
  chain_id, wallet_address, token_in, token_out, amount, slippage_bps,
  safety_verdict, safety_detail, route_ref, expires_at
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb, $15::jsonb, $16)`;

export async function create(input: CreatePrequoteInput): Promise<void> {
  await execute(INSERT_SQL, [
    input.prequoteId,
    input.sessionId,
    input.matchHash,
    input.kind,
    input.family,
    input.provider,
    input.chainId,
    input.walletAddress,
    input.tokenIn,
    input.tokenOut,
    input.amount,
    input.slippageBps,
    input.safetyVerdict,
    jsonb(input.safetyDetail),
    input.routeRef === null || input.routeRef === undefined
      ? null
      : jsonb(input.routeRef),
    input.expiresAt,
  ]);
}

// ── findLatestFreshByMatch (session-scoped) ─────────────────────────────

/**
 * Newest non-expired prequote row for a (session, match_hash). Returns `null`
 * when no fresh row exists (including cross-session: a row recorded under a
 * different session never matches). Freshness is `expires_at > NOW()` — an
 * expired row is invisible. Stage 7 adds verdict filtering at the gate; this
 * read stays simple + correct.
 */
export async function findLatestFreshByMatch(
  sessionId: string,
  matchHash: string,
): Promise<SwapPrequote | null> {
  const row = await queryOne<Record<string, unknown>>(
    `SELECT ${SELECT_COLUMNS} FROM swap_prequotes
      WHERE session_id = $1
        AND match_hash = $2
        AND expires_at > NOW()
      ORDER BY created_at DESC
      LIMIT 1`,
    [sessionId, matchHash],
  );
  return row ? mapRow(row) : null;
}
