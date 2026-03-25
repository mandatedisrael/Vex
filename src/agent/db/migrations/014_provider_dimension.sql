-- 014: Add provider/currency dimension to usage and billing tables.
-- Prevents mixing 0G and USD data in lifetime aggregates.

ALTER TABLE usage_log ADD COLUMN IF NOT EXISTS provider TEXT;
ALTER TABLE usage_log ADD COLUMN IF NOT EXISTS currency TEXT DEFAULT '0G';

ALTER TABLE billing_snapshots ADD COLUMN IF NOT EXISTS provider TEXT;
ALTER TABLE billing_snapshots ADD COLUMN IF NOT EXISTS currency TEXT DEFAULT '0G';
