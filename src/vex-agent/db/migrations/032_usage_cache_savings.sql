-- Cache-savings persistence on usage_log (STRUCTURE+CACHE phase, 2026-06-10).
--
-- `cached_savings` records the NET cache effect for a request, computed at
-- logUsage time (`computeRequestCost`): read savings (cachedTokens at the
-- cache-read price vs the input price) MINUS the write surcharge
-- (cacheWriteTokens at the cache-write price vs the input price). The value
-- can legitimately be NEGATIVE — the first request of an explicit-cache
-- prefix (e.g. Anthropic, write 1.25×/2× input) writes more than it reads.
-- We record the truth; the UI handles the sign explicitly.
--
-- `cache_write_tokens` is the per-request cache-write token count. OpenRouter
-- returns it ONLY for explicit-cache models with cache-write pricing; absent
-- in the response means 0 here.
--
-- A NEW numbered migration (not an edit of 001): the runner applies only
-- `version > MAX(schema_version)`, so editing 001 would be invisible to
-- already-initialized databases — and `logUsage` is awaited without a
-- try/catch, so a stale DB would fail every turn. Forward-only, idempotent
-- (IF NOT EXISTS); existing rows default to 0 (historical savings unknown —
-- no backfill). Mirrored byte-identically in vex-app/resources/migrations/.

ALTER TABLE usage_log ADD COLUMN IF NOT EXISTS cached_savings NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE usage_log ADD COLUMN IF NOT EXISTS cache_write_tokens INT NOT NULL DEFAULT 0;
