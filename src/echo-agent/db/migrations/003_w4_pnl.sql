-- W4A: USD-exact valuation + realized PnL
-- Adds valuation columns to proj_activity, creates proj_pnl_matches ledger,
-- extends proj_open_positions with notional/fee columns.

-- ── proj_activity: valuation fields ────────────────────────────────

ALTER TABLE proj_activity ADD COLUMN IF NOT EXISTS input_value_usd NUMERIC;
ALTER TABLE proj_activity ADD COLUMN IF NOT EXISTS output_value_usd NUMERIC;
ALTER TABLE proj_activity ADD COLUMN IF NOT EXISTS fee_value_usd NUMERIC;
ALTER TABLE proj_activity ADD COLUMN IF NOT EXISTS unit_price_usd NUMERIC;
ALTER TABLE proj_activity ADD COLUMN IF NOT EXISTS valuation_source TEXT;

-- ── proj_pnl_matches: FIFO lot match ledger ───────────────────────
-- Canonical realized PnL. Each sell match consumes part of a lot.
-- lot_id is nullable — shortfall rows have lot_id = NULL.

CREATE TABLE IF NOT EXISTS proj_pnl_matches (
  id SERIAL PRIMARY KEY,
  match_kind TEXT NOT NULL DEFAULT 'matched',
  sell_activity_id INTEGER NOT NULL REFERENCES proj_activity(id),
  lot_id INTEGER REFERENCES proj_pnl_lots(id),
  instrument_key TEXT NOT NULL,
  wallet_address TEXT NOT NULL,
  quantity_matched TEXT NOT NULL,
  cost_basis_usd NUMERIC,
  proceeds_usd NUMERIC,
  realized_pnl_usd NUMERIC,
  namespace TEXT NOT NULL,
  chain TEXT NOT NULL,
  matched_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pnl_matches_lot ON proj_pnl_matches(lot_id) WHERE lot_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pnl_matches_sell ON proj_pnl_matches(sell_activity_id);
CREATE INDEX IF NOT EXISTS idx_pnl_matches_instrument ON proj_pnl_matches(instrument_key, wallet_address);

-- ── proj_open_positions: prediction notional/fee ───────────────────

ALTER TABLE proj_open_positions ADD COLUMN IF NOT EXISTS notional_usd NUMERIC;
ALTER TABLE proj_open_positions ADD COLUMN IF NOT EXISTS fee_usd NUMERIC;
