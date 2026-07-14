-- Mission results ledger. One row per mission RUN, opened when the run
-- starts and closed at every terminal branch of finalize. Gives every
-- mission a stable per-wallet number (Mission #N) and a persisted, ETH-
-- denominated PnL record so performance is comparable across runs.
--
-- PnL is denominated in ETH (the bankroll's own unit): bankroll_end_eth
-- minus bankroll_start_eth, where bankroll = native ETH + WETH matched by
-- PER-CHAIN ADDRESS (see engine/mission/bankroll.ts) — nets out gas, fees,
-- and slippage automatically. Token bags still held at close are recorded
-- in open_positions_json and EXCLUDED from the headline PnL so an unsold
-- position never distorts it. USD prices are kept only for display
-- tooltips. `stop_reason` is the raw engine StopReason (e.g.
-- `deadline_reached`) — presentation (e.g. mapping a reached time-box to a
-- non-failure outcome) is a pure function in the read layer, never SQL.
--
-- seq_no is a per-wallet sequence ("Mission #N") minted under a
-- transaction-scoped advisory lock (see openMissionResult) so two
-- concurrent opens for the same wallet can never collide.

CREATE TABLE mission_results (
  id                    TEXT NOT NULL PRIMARY KEY,
  mission_id            TEXT NOT NULL REFERENCES missions(id),
  mission_run_id        TEXT NOT NULL REFERENCES mission_runs(id),
  session_id            TEXT NOT NULL REFERENCES sessions(id),
  wallet_address        TEXT NOT NULL,
  chain_id              BIGINT NOT NULL,
  seq_no                INTEGER NOT NULL,
  goal_snippet          TEXT,
  started_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at              TIMESTAMPTZ,
  duration_s            INTEGER,
  bankroll_start_eth    NUMERIC,
  bankroll_end_eth      NUMERIC,
  pnl_eth               NUMERIC,
  pnl_pct                NUMERIC,
  eth_price_usd_start   NUMERIC,
  eth_price_usd_end     NUMERIC,
  trades                INTEGER NOT NULL DEFAULT 0,
  outcome               TEXT NOT NULL DEFAULT 'running'
                          CHECK (outcome IN ('running', 'completed', 'cancelled', 'failed', 'stopped')),
  stop_reason           TEXT,
  open_positions_json   JSONB,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Exactly one ledger row per run — the open/close lifecycle keys on this
-- (ON CONFLICT (mission_run_id) DO NOTHING makes a retried open a no-op).
CREATE UNIQUE INDEX mission_results_run_uidx ON mission_results (mission_run_id);

-- seq_no is unique PER WALLET (case-insensitive) — the numbering invariant
-- "Mission #N" depends on. Defense in depth alongside the advisory-lock
-- minting in openMissionResult.
CREATE UNIQUE INDEX mission_results_wallet_seq_uidx ON mission_results (LOWER(wallet_address), seq_no);

-- Per-wallet history reads, newest first.
CREATE INDEX mission_results_wallet_history_idx ON mission_results (LOWER(wallet_address), seq_no DESC);
