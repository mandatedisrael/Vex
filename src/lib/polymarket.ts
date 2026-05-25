/**
 * Cross-boundary re-export so vex-app (Electron main) can pull the
 * canonical Polymarket credential primitives via `@vex-lib/polymarket.js`
 * without reaching outside the alias scope (mirrors `src/lib/wallet.ts`).
 *
 * The implementations live under `src/tools/wallet/polymarket-credentials.ts`
 * and stay the single source of truth for the EIP-712 ClobAuth signing
 * flow + derive/create API key sequence. vex-shell (CLI) consumes
 * `deriveAndSavePolymarketCredentials` directly via the legacy import path;
 * vex-app uses the env-free `acquirePolymarketCredentialsWithPassword`
 * primitive exported here.
 */

export {
  acquirePolymarketCredentialsWithPassword,
  deriveAndSavePolymarketCredentials,
  type AcquireResult,
  type AcquiredPolymarketCredentials,
  type DeriveResult,
} from "../tools/wallet/polymarket-credentials.js";

// Per-wallet credential-map primitives (puzzle 5 B-UI). `buildPolymarketVaultUpdates`
// is the SINGLE source of truth for which vault keys a Polymarket write touches
// (map merge + primary-only fixed keys); the vex-app onboarding handler composes
// it exactly like the CLI path so the rule cannot drift between clients.
export {
  buildPolymarketVaultUpdates,
  parseCredentialMapEnv,
  type StoredPolyCredentials,
} from "../tools/polymarket/credential-map.js";

// Vault secret key NAMES (not values) the vex-app handler needs to read the
// current map env and write the legacy primary fallback keys.
export {
  ENV_POLYMARKET_API_KEY,
  ENV_POLYMARKET_API_SECRET,
  ENV_POLYMARKET_PASSPHRASE,
  ENV_POLYMARKET_CLOB_CREDENTIALS_BY_ADDRESS,
} from "../tools/polymarket/constants.js";
