-- Stage 6c — swap_prequotes (durable swap-quote safety preview store).
--
-- Purpose: every successful swap QUOTE records a row here capturing the
-- fail-closed token-safety verdict computed at quote time, keyed by a
-- deterministic match-hash over the trade identity. A future runtime gate
-- (Stage 7, NOT in this migration) reads the LATEST FRESH matching row before
-- a swap EXECUTE and blocks when no fresh safety-passed preview exists — the
-- agent equivalent of Claude Code's Read-before-Edit precondition. This table
-- only RECORDS the preview; it never gates anything on its own.
--
-- Fail-closed verdict semantics (`safety_verdict`):
--   pass    — every audited leg passed its risk check; no leg is unknown.
--   fail    — at least one leg is a hard reject (EVM honeypot, or EVM
--             fee-on-transfer with tax > 50; Solana isSus = true). Mirrors the
--             real hard-abort in `executeKyberSwap` so the gate never passes
--             something the executor would reject.
--   unknown — at least one non-native leg could NOT be audited (EVM
--             checkFailed / malformed leg, Solana audit data absent for a
--             non-native non-wSOL mint) and no leg is a hard fail. "Could not
--             verify" is treated as fail-closed by the Stage-7 gate.
--   Aggregation is worst-leg: any fail → fail; else any unknown → unknown;
--   else pass. Native legs (EVM native sentinel, Solana SOL/wSOL) never worsen
--   the verdict.
--
-- Match-hash composition (`match_hash`, sha256 hex; identical at record-time
-- and at Stage-7 gate-time):
--   sha256_hex(join(' ', [
--     session_id, family, chainIdOrEmpty, wallet_address_canon,
--     token_in_canon, token_out_canon, amount_canon
--   ]))
--   - EVM addresses + EVM wallet address are lowercased; Solana mints + wallet
--     address are preserved as-is (base58 is case-sensitive).
--   - chainIdOrEmpty: numeric chainId string for EVM, "" for Solana.
--   - amount_canon: decimal-normalized human amount so "1.0" and "1" collide.
--   - Slippage and provider are deliberately NOT part of the hash (a slippage
--     tweak must not invalidate the safety preview; provider derives from
--     family).
--
-- Data-exposure invariant: `safety_detail` and `route_ref` carry ONLY bounded,
-- structural fields (per-leg verdicts + audited booleans/numbers, or a bounded
-- `checkFailed` reason class). Raw provider/HTTP/error text, secrets, keys, and
-- signatures NEVER reach these columns (mirror the wallet_intents
-- `failure_reason` structural-only policy). The CHECK enforces an object shape.
--
-- Forward-only; idempotent IF NOT EXISTS. FK CASCADE on session delete keeps
-- prequotes garbage-collected with their session — no orphan rows. `kind`
-- allows 'bridge' for forward-compat (Stage 8), but Stage 6c records only
-- 'swap'.

CREATE TABLE IF NOT EXISTS swap_prequotes (
  prequote_id     TEXT PRIMARY KEY,
  session_id      TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  match_hash      TEXT NOT NULL,
  kind            TEXT NOT NULL CHECK (kind IN ('swap', 'bridge')),
  family          TEXT NOT NULL CHECK (family IN ('eip155', 'solana')),
  provider        TEXT NOT NULL,
  chain_id        BIGINT,
  wallet_address  TEXT NOT NULL,
  token_in        TEXT NOT NULL,
  token_out       TEXT NOT NULL,
  amount          TEXT NOT NULL,
  slippage_bps    INTEGER,
  safety_verdict  TEXT NOT NULL CHECK (safety_verdict IN ('pass', 'fail', 'unknown')),
  safety_detail   JSONB NOT NULL CHECK (jsonb_typeof(safety_detail) = 'object'),
  route_ref       JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at      TIMESTAMPTZ NOT NULL
);

-- Stage-7 gate hot path: newest fresh row for a (session, match_hash).
CREATE INDEX IF NOT EXISTS idx_swap_prequotes_match
  ON swap_prequotes (session_id, match_hash, created_at DESC);

-- Per-session listing / CASCADE-cleanup hot path.
CREATE INDEX IF NOT EXISTS idx_swap_prequotes_session
  ON swap_prequotes (session_id);
