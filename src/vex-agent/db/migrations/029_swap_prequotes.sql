-- Stage 6c — swap_prequotes (durable swap-quote safety preview store).
--
-- Purpose: every successful swap QUOTE records a row here capturing the
-- token-safety verdict computed at quote time, keyed by a deterministic
-- match-hash over the trade identity. The Stage-7 runtime gate
-- (`evaluateSwapPrequoteGate`) reads the matching rows before a swap EXECUTE —
-- the agent equivalent of Claude Code's Read-before-Edit precondition. This
-- table only RECORDS the preview; the gate logic lives in the runtime.
--
-- Stage-7 gate policy (what blocks vs passes):
--   The gate BLOCKS a swap execute on (no fresh matching `swap` prequote) OR
--   (a fresh `fail` row for the identity). Both `pass` AND `unknown` PASS the
--   gate. An `unknown` is surfaced in the restricted-mode approval preview
--   ("safety: UNVERIFIED — audit unavailable") and logged when allowed in
--   full-auto, so a human (or the audit trail) sees that an un-audited leg was
--   permitted. A fresh `fail` can never be authorized even if a later
--   `pass`/`unknown` row exists for the same identity (gate guardrail #1).
--
-- Verdict semantics (`safety_verdict`):
--   pass    — every audited leg passed its risk check; no leg is unknown.
--   fail    — at least one leg is a CONFIRMED honeypot: EVM `isHoneypot = true`
--             or Solana `isSus = true`. That is the ONLY hard-block doctrine —
--             it mirrors the single hard-abort in `executeKyberSwap` so the gate
--             never passes something the executor would reject. Fee-on-transfer
--             (EVM `isFOT`/`tax`) is NOT a fail: the model decides on fee-bearing
--             tokens (even in full-auto / full-agent). The FoT tax is surfaced in
--             `safety_detail` and in the approval preview so a human/the audit
--             still sees it; it never forces `fail` on its own.
--   unknown — at least one non-native leg could NOT be audited (EVM
--             checkFailed / malformed leg, Solana audit data absent for a
--             non-native non-wSOL mint) and no leg is a hard fail. "Could not
--             verify" passes the gate but is surfaced to the human/audit (see
--             gate policy above), it does NOT block on its own.
--   Aggregation is worst-leg: any fail → fail; else any unknown → unknown;
--   else pass. Native legs (EVM native sentinel, Solana SOL/wSOL) never worsen
--   the verdict.
--
-- Match-hash composition (`match_hash`, sha256 hex; identical at record-time
-- and at Stage-7 gate-time). The material is prefixed with the `kind`
-- discriminant and then the kind-specific fields in a FIXED order, so a swap and
-- a bridge with otherwise-similar values never collide. For a swap:
--   sha256_hex(join(' ', [
--     'swap', session_id, family, chainIdOrEmpty, wallet_address_canon,
--     token_in_canon, token_out_canon, amount_canon,
--     recipient_canon, approveExact, slippage_bps, provider
--   ]))
--   - EVM addresses + EVM wallet address are lowercased; Solana mints + wallet
--     address are preserved as-is (base58 is case-sensitive).
--   - chainIdOrEmpty: numeric chainId string for EVM, "" for Solana.
--   - amount_canon: decimal-normalized human amount so "1.0" and "1" collide.
--   - recipient_canon: family-canonical output recipient (defaults to self when
--     omitted, matching the executor) — a redirected output diverges → block.
--   - approveExact: stable "1"/"0" allowance token — flipping it diverges → block.
--   - slippage_bps: integer string (or "" when omitted). Slippage IS now bound:
--     a 50bps quote then a 10000bps execute diverges → block.
--   - provider: the quoting VENUE ("kyberswap" | "uniswap" | "jupiter"), bound as
--     the LAST hash field (LOCKED Wave-2 #4). On EVM it does NOT derive from
--     `family` (kyberswap and uniswap are both eip155), so binding it stops a
--     kyberswap quote from authorizing a uniswap execute for the same identity.
--     The `provider` COLUMN below is stored for auditing; the hash binds it too.
--   (The bridge `kind` binds its own fixed tail — source/dest wallets, tokens,
--   tradeType, refundTo, referrer, referrerFeeBps, filler, provider — see
--   swap-prequote.ts.)
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
