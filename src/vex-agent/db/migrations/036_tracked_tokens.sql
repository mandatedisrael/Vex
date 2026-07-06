-- Robinhood launch — tracked_tokens (explicit token pinning for local chains).
--
-- The LOCAL-chain balance scan set (sync/local-chain-balance-sync.ts →
-- buildTokenScanSet) is seed tokens ∪ THIS TABLE. It replaces the implicit
-- spot-swap derivation (activity.getTrackedEvmTokensForChain) as the runtime
-- way a new token starts being tracked on a local chain like Robinhood (4663):
-- explicit rows instead of a query-time inference, so bridged, transferred,
-- and airdropped tokens can be tracked too.
--
-- Row provenance (`source`):
--   agent  — pinned via the wallet_track_token tool (model- or user-driven),
--   swap   — auto-pinned by a successful uniswap execute on a local chain,
--   bridge — auto-pinned by a relay bridge landing an ERC-20 on a local chain.
--
-- Pendle PT enrichment keeps its own spot-swap derivation
-- (activity.getTrackedEvmTokensForChain) — deliberately untouched by this table.

CREATE TABLE IF NOT EXISTS tracked_tokens (
  id             BIGSERIAL PRIMARY KEY,
  wallet_address TEXT NOT NULL,
  chain_id       BIGINT NOT NULL,
  token_address  TEXT NOT NULL,
  source         TEXT NOT NULL DEFAULT 'agent' CHECK (source IN ('agent', 'swap', 'bridge')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One row per (wallet, chain, token) — hex addresses dedupe case-insensitively.
CREATE UNIQUE INDEX IF NOT EXISTS idx_tracked_tokens_identity
  ON tracked_tokens (wallet_address, chain_id, LOWER(token_address));
