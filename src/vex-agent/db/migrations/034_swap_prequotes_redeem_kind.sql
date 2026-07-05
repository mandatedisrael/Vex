-- Wave 5 (Pendle) — expand swap_prequotes.kind to allow 'redeem'.
--
-- Migration 029 pinned `kind` with `CHECK (kind IN ('swap', 'bridge'))`. Pendle's
-- fixed-yield PT redeem is NEITHER a swap nor a bridge: it has its own dedicated
-- identity (provider, wallet, chainId, ptAddress, ytAddress, amount, receiver —
-- see prequote/identity/pendle-redeem.ts) and its own record/gate branches, so it
-- must never reuse the swap or bridge kind. This EXPAND-ONLY migration widens the
-- CHECK to include 'redeem'; no rows change and no column is dropped.
--
-- Forward-only, idempotent: drop the old constraint if present, then add the
-- widened one only when it is not already there. The mirror under vex-app is kept
-- in sync by scripts/copy-migrations.mjs.

ALTER TABLE swap_prequotes
  DROP CONSTRAINT IF EXISTS swap_prequotes_kind_check;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'swap_prequotes_kind_check'
  ) THEN
    ALTER TABLE swap_prequotes
      ADD CONSTRAINT swap_prequotes_kind_check
      CHECK (kind IN ('swap', 'bridge', 'redeem'));
  END IF;
END$$;
