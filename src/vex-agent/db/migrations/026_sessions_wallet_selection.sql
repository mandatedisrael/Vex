-- Puzzle 5 phase 5B: per-session wallet selection (immutable at creation).
--
-- A session may pin one EVM + one Solana wallet from the inventory; the agent
-- uses only those for the whole session. id + address are snapshotted together:
--   - the non-reusable id makes a stale/removed wallet unresolvable (fail-closed);
--   - the address pins the choice so a force re-import under the same id (address
--     drift) is detected and fails closed rather than signing with a new key.
-- All nullable: a session with no selection has wallet tools fail closed
-- (the "optional selection" model). Immutability is enforced in the app/engine
-- create path, not at the column level (columns only gate atomicity per family).

ALTER TABLE sessions ADD COLUMN IF NOT EXISTS selected_evm_wallet_id TEXT;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS selected_evm_wallet_address TEXT;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS selected_solana_wallet_id TEXT;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS selected_solana_wallet_address TEXT;

-- Per-family atomicity: id and address are either both set or both null.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_sessions_evm_wallet_atomic') THEN
    ALTER TABLE sessions ADD CONSTRAINT chk_sessions_evm_wallet_atomic CHECK (
      (selected_evm_wallet_id IS NULL AND selected_evm_wallet_address IS NULL)
      OR (selected_evm_wallet_id IS NOT NULL AND selected_evm_wallet_address IS NOT NULL)
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_sessions_solana_wallet_atomic') THEN
    ALTER TABLE sessions ADD CONSTRAINT chk_sessions_solana_wallet_atomic CHECK (
      (selected_solana_wallet_id IS NULL AND selected_solana_wallet_address IS NULL)
      OR (selected_solana_wallet_id IS NOT NULL AND selected_solana_wallet_address IS NOT NULL)
    );
  END IF;
END $$;
