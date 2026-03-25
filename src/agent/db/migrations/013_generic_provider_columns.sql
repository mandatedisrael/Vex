-- 013: Rename 0G-specific column names to provider-agnostic names.
-- Supports multi-provider architecture (0G Compute + OpenRouter).

-- usage_log
ALTER TABLE usage_log RENAME COLUMN cost_og TO cost;

-- billing_snapshots
ALTER TABLE billing_snapshots RENAME COLUMN ledger_total_og TO provider_balance;
ALTER TABLE billing_snapshots RENAME COLUMN ledger_available_og TO provider_available;
ALTER TABLE billing_snapshots RENAME COLUMN provider_locked_og TO provider_locked;
ALTER TABLE billing_snapshots RENAME COLUMN session_burn_og TO session_cost;

-- topup_history
ALTER TABLE topup_history RENAME COLUMN amount_og TO amount;
ALTER TABLE topup_history RENAME COLUMN balance_before_og TO balance_before;
ALTER TABLE topup_history RENAME COLUMN balance_after_og TO balance_after;

-- funding_baseline
ALTER TABLE funding_baseline RENAME COLUMN baseline_locked_og TO baseline_locked;
ALTER TABLE funding_baseline RENAME COLUMN baseline_total_og TO baseline_total;
ALTER TABLE funding_baseline RENAME COLUMN last_topup_amount_og TO last_topup_amount;

-- loop_cycles
ALTER TABLE loop_cycles RENAME COLUMN token_cost_og TO token_cost;

-- subagents
ALTER TABLE subagents RENAME COLUMN token_cost_og TO token_cost;
