-- Puzzle 5 phase 4 — wallet_intents (durable transfer prepare/confirm intents).
--
-- Replaces the process-local `pendingIntents = new Map<...>` in
-- `src/vex-agent/tools/internal/wallet/send.ts:32`. Plan §05:
--
--   Process-local pendingIntents trzeba zastapic DB-backed intent.
--   Confirm: sprawdza expiry, sprawdza consumed/cancelled, nie wykonuje po
--   restarcie bez pelnego intentu, zapisuje tx hash/result, nigdy nie
--   zwraca private key do renderer.
--
-- Companion to the puzzle-5 phase-3 approval runtime: `wallet_send_confirm`
-- still routes through the central approval gate (mutating + restricted →
-- pendingApproval). The wallet intent row stays `pending` across the
-- approval pause so a paused-then-approved confirm consumes the SAME
-- pre-approved row instead of dispatching a fresh transfer.
--
-- Status lifecycle (CHECK enum):
--   pending      — created by wallet_send_prepare, waiting for confirm.
--   consuming    — CAS-claimed by confirm; about to execute the transfer.
--   executed     — broadcast + confirmation + audit write all succeeded.
--                  `tx_hash` is set; `failure_reason` NULL.
--   failed       — broadcast/confirmation failure OR pre-broadcast failure.
--                  `tx_hash` MAY be set (when broadcast went through but
--                  chain reverted / confirmation timed out — the operator
--                  needs the hash to investigate on-chain). `failure_reason`
--                  is a structural-only label (ErrorKind:errorHash); raw
--                  cause messages NEVER persist here.
--   audit_failed — broadcast + confirmation succeeded, BUT the post-tx
--                  `markExecuted` audit write to this row itself failed.
--                  Tx is real and on-chain (`tx_hash` set); the intent
--                  needs operator/phase-7 reconcile, not a re-broadcast.
--                  Distinct from `failed` so reconcile tooling can
--                  distinguish "transfer broken" from "audit broken".
--   cancelled    — operator cancelled before consume via the IPC cancel
--                  handler. CAS-guarded against race with confirm.
--   expired      — DB CHECK allows but phase 4 does NOT populate this
--                  value (confirm-time gate handles expiry inline; the
--                  scheduled sweep belongs to phase 7 audit).
--
-- Ownership invariant: every CAS / lookup in the engine repo includes
-- `session_id` in the WHERE clause (Codex puzzle-5 phase-4 review point
-- 3 — cross-session confirm/get/cancel must miss even when intent_id is
-- known to another session).
--
-- `failure_reason` is structural-only (`ErrorKind:shortSha256(message)`).
-- Raw wallet/RPC errors can carry API keys, addresses, signatures, seed
-- fragments — they MUST never reach this column (mirror approval-runtime
-- phase 3 transcript redaction policy). The DTO mapper in vex-app/main
-- additionally NEVER returns `failure_reason` over the IPC boundary.
--
-- Forward-only; idempotent IF NOT EXISTS. FK CASCADE on session delete
-- keeps the intent garbage-collected with its session — no orphan rows.

CREATE TABLE IF NOT EXISTS wallet_intents (
  intent_id        TEXT PRIMARY KEY,
  session_id       TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  wallet_address   TEXT NOT NULL,
  network          TEXT NOT NULL CHECK (network IN ('eip155', 'solana')),
  chain_alias      TEXT,
  to_address       TEXT NOT NULL,
  amount           TEXT NOT NULL,
  token            TEXT,
  preview_json     JSONB NOT NULL CHECK (jsonb_typeof(preview_json) = 'object'),
  status           TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending',
    'consuming',
    'executed',
    'failed',
    'audit_failed',
    'cancelled',
    'expired'
  )),
  expires_at       TIMESTAMPTZ NOT NULL,
  consumed_at      TIMESTAMPTZ,
  cancelled_at     TIMESTAMPTZ,
  tx_hash          TEXT,
  failure_reason   TEXT,
  idempotency_key  TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Per-session listing hot path (getPendingForSession, future audit UI).
CREATE INDEX IF NOT EXISTS idx_wallet_intents_session
  ON wallet_intents (session_id);

-- TTL / sweep hot path: only pending rows are candidates for the
-- confirm-time gate OR the future scheduled sweep (phase 7).
CREATE INDEX IF NOT EXISTS idx_wallet_intents_status_expires
  ON wallet_intents (status, expires_at)
  WHERE status = 'pending';

-- Idempotency defense-in-depth (phase 4 sets `idempotency_key = intent_id`;
-- partial UNIQUE catches accidental cross-intent key reuse).
CREATE UNIQUE INDEX IF NOT EXISTS idx_wallet_intents_idempotency
  ON wallet_intents (idempotency_key)
  WHERE idempotency_key IS NOT NULL;
