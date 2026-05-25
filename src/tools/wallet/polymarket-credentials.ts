/**
 * Polymarket CLOB API credential derivation — canonical source of truth.
 *
 * Moved out of `src/tools/polymarket/` in puzzle 5 phase 5D-protocols p5 (Codex
 * ruling): this is credential SETUP (sign an EIP-712 ClobAuth with the wallet
 * keystore → derive/create API creds → persist), NOT session-scoped protocol
 * trading. It legitimately decrypts the keystore, so it lives in a wallet
 * module — keeping protocol paths free of keystore/decrypt imports (the
 * keystore-isolation scan stays strict-empty for protocol code).
 *
 * Puzzle 5 B-core: derivation is now PER-WALLET. `deriveAndSave…({ walletId })`
 * targets a specific session EVM wallet and merges its creds into the
 * `POLYMARKET_CLOB_CREDENTIALS_BY_ADDRESS` map (see `polymarket/credential-map.ts`);
 * omitting `walletId` keeps the primary-wallet behavior. The read side lives in
 * `polymarket/auth.requirePolyClobCredentials(address)`.
 *
 * Flow: wallet keystore → EIP-712 ClobAuth signature → derive/create API key → save to encrypted vault
 * Used by:
 *   - CLI `vex polymarket setup` + vex-agent internal tool (legacy env-driven path)
 *   - vex-app onboarding handler (env-free `acquire…` primitive)
 *
 * Two-tier surface per Codex Phase-2 review:
 *   1. `acquirePolymarketCredentialsWithPassword(password)` — env-free primitive.
 *      Decrypts the keystore using the explicitly provided password, signs the
 *      L1 EIP-712 ClobAuth, calls Polymarket. Returns credentials in memory.
 *      Does NOT touch the vault, .env, or process.env.
 *   2. `deriveAndSavePolymarketCredentials({ secretsFilePath? })` — legacy CLI
 *      wrapper. Resolves the master password from process.env
 *      (`VEX_KEYSTORE_PASSWORD`), then composes the acquire primitive with the
 *      same vault-persist + .env-strip + same-process env-apply as before.
 *
 * Auth: L1 EIP-712 typed data signature in request headers (POLY_ADDRESS,
 * POLY_SIGNATURE, POLY_TIMESTAMP, POLY_NONCE). NOT JSON body auth.
 *
 * No secrets in return value — only apiKeyPrefix (first 8 chars + ellipsis).
 */

import { type Address, type Hex, getAddress } from "viem";
import { privateKeyToAddress } from "viem/accounts";
import { loadKeystore, loadKeystoreFile, decryptPrivateKey } from "./keystore.js";
import { loadConfig, type WalletInventoryEntry } from "../../config/store.js";
import {
  derivePath,
  getPrimaryEvmAddress,
  getPrimaryEvmEntry,
  getWalletById,
} from "./inventory.js";
import { fetchWithTimeout, readJson } from "../../utils/http.js";
import { VexError, ErrorCodes } from "../../errors.js";
import {
  stripManagedSecretsFromDotenvFile,
  writeSecretVaultSecrets,
} from "../../lib/local-secret-vault.js";
import { requireKeystorePassword } from "../../utils/env.js";
import { isRecord } from "../../utils/validation-helpers.js";
import {
  CLOB_BASE_URL,
  CLOB_TIMEOUT_MS,
  POLYGON_CHAIN_ID,
  ENV_POLYMARKET_CLOB_CREDENTIALS_BY_ADDRESS,
} from "../polymarket/constants.js";
import {
  type StoredPolyCredentials,
  buildPolymarketVaultUpdates,
} from "../polymarket/credential-map.js";

// ── EIP-712 ClobAuth domain + types (from Polymarket docs) ─────────

const CLOB_AUTH_DOMAIN = {
  name: "ClobAuthDomain",
  version: "1",
  chainId: POLYGON_CHAIN_ID,
} as const;

const CLOB_AUTH_TYPES = {
  ClobAuth: [
    { name: "address", type: "address" },
    { name: "timestamp", type: "string" },
    { name: "nonce", type: "uint256" },
    { name: "message", type: "string" },
  ],
} as const;

const CLOB_AUTH_MESSAGE = "This message attests that I control the given wallet";

export interface DeriveResult {
  /** First 8 characters of API key + ellipsis — safe for display/output. */
  apiKeyPrefix: string;
  /** Storage location where credentials were saved. */
  storage: "secret-vault";
  /** Wallet address used for derivation. */
  address: Address;
}

export interface AcquiredPolymarketCredentials {
  apiKey: string;
  secret: string;
  passphrase: string;
}

export interface AcquireResult {
  address: Address;
  credentials: AcquiredPolymarketCredentials;
}

/**
 * Acquire (derive or create) Polymarket CLOB API credentials for the EVM
 * wallet stored on disk. Decrypts the wallet keystore using the explicitly
 * provided password (NO process.env dependency). Signs the L1 EIP-712
 * ClobAuth, calls Polymarket /auth/derive-api-key (with 15s timeout), and
 * falls back to /auth/api-key creation if derive returns nothing.
 *
 * Returns the credentials in memory — caller is responsible for persisting
 * them under a write lock and dropping the reference. This function does
 * NOT touch the secret vault, .env, or process.env.
 *
 * Throws engine `VexError` codes:
 *   - `KEYSTORE_NOT_FOUND`    wallet keystore missing
 *   - `KEYSTORE_DECRYPT_FAILED` keystore decrypt failed (wrong password or
 *                              corrupt ciphertext) — distinct from a
 *                              `LocalSecretVaultError("invalid_password")`
 *                              raised by the master-password vault layer.
 *                              The handler decides which surface to map to.
 *   - `POLYMARKET_AUTH_FAILED` API rejection or malformed response (4xx)
 *   - `HTTP_REQUEST_FAILED`    network / timeout / 5xx
 */
export async function acquirePolymarketCredentialsWithPassword(
  password: string,
  entry?: WalletInventoryEntry,
): Promise<AcquireResult> {
  // 1. Keystore must exist on disk. For a specific session wallet (`entry`),
  // resolve its derived keystore path (traversal-guarded by `derivePath`);
  // otherwise the primary (legacy) keystore.
  const keystore = entry ? loadKeystoreFile(derivePath("evm", entry)) : loadKeystore();
  if (!keystore) {
    throw new VexError(
      ErrorCodes.KEYSTORE_NOT_FOUND,
      entry ? "Keystore not found for the selected EVM wallet." : "Keystore not found.",
      "Generate or import an EVM wallet before configuring Polymarket.",
    );
  }

  // 2. Decrypt with the EXPLICIT password — engine raises
  // `KEYSTORE_DECRYPT_FAILED` on wrong password or corrupt ciphertext.
  // Propagate untouched so the handler can map it to `wallet.password_invalid`.
  // `let` (not `const`) so we can overwrite the binding after the signer
  // consumes the key. JS strings are immutable, so this only drops OUR
  // reference; any internal copy in viem's account survives until GC, but
  // shortening the lifetime of the local binding is the strongest in-process
  // defense available.
  let privateKey: Hex = decryptPrivateKey(keystore, password);

  // 2b. Per-wallet derive (B-core): assert the decrypted key derives the
  // recorded address BEFORE signing, so creds are never derived/bound with a
  // key that isn't the selected wallet (Codex B-core ruling — fail closed).
  // Scrub the local binding before throwing.
  if (entry && privateKeyToAddress(privateKey) !== getAddress(entry.address)) {
    privateKey = "0x" as Hex;
    throw new VexError(
      ErrorCodes.SIGNER_MISMATCH,
      "EVM keystore does not match the selected wallet address.",
      "Re-import the wallet or restore from backup.",
    );
  }

  // 3. Sign EIP-712 ClobAuth. `try/finally` guarantees the local binding is
  // overwritten whether the signer succeeds or throws — so any subsequent
  // network call below executes with `privateKey` already scrubbed.
  let headers: Record<string, string>;
  let address: Address;
  try {
    const built = await buildL1AuthHeaders(privateKey);
    headers = built.headers;
    address = built.address;
  } finally {
    privateKey = "0x" as Hex;
  }

  // 4. Try derive first (GET — recovers existing credentials).
  const derived = await tryDeriveApiKey(headers);
  if (derived) return { address, credentials: derived };

  // 5. Fall back to create (POST — generates new credentials). 4xx vs
  // 5xx/network is distinguished so the handler can surface a
  // user-actionable auth error separately from a transient network error.
  const created = await createApiKey(headers);
  return { address, credentials: created };
}

/**
 * Derive Polymarket CLOB API credentials for an EVM wallet and save them into
 * the per-wallet credential map. Legacy env-driven entry point used by:
 *   - vex CLI `vex polymarket setup`
 *   - vex-agent internal tool (`polymarket-setup`)
 *
 * Target wallet:
 *   - `options.walletId` → that specific session EVM wallet;
 *   - omitted → the primary EVM wallet (legacy CLI behavior).
 *
 * Persistence (puzzle 5 B-core): the creds are MERGED into the
 * `POLYMARKET_CLOB_CREDENTIALS_BY_ADDRESS` map (keyed by normalized address),
 * preserving every other wallet's entry. For the PRIMARY wallet only, the three
 * fixed keys are also written — backward compat for the legacy read fallback and
 * the `polymarket_setup` visibility gate. Legacy keys are never deleted here.
 *
 * Resolves the master password from `process.env.VEX_KEYSTORE_PASSWORD` via
 * `requireKeystorePassword()`. The Electron app does NOT use this path — it
 * calls `acquirePolymarketCredentialsWithPassword` directly with the unlocked
 * in-memory password.
 *
 * Throws `VexError` on failure (no wallet, network, auth, missing fields).
 */
export async function deriveAndSavePolymarketCredentials(
  options: { readonly walletId?: string; readonly secretsFilePath?: string } = {},
): Promise<DeriveResult> {
  const cfg = loadConfig();

  // Resolve the target EVM wallet: an explicit session wallet by id, else the
  // primary (legacy CLI behavior).
  const entry = options.walletId
    ? getWalletById("evm", options.walletId, cfg)
    : getPrimaryEvmEntry(cfg);
  if (!entry) {
    throw new VexError(
      ErrorCodes.WALLET_NOT_CONFIGURED,
      options.walletId ? "Selected EVM wallet not found." : "No wallet configured.",
      options.walletId
        ? "Re-select an EVM wallet for this session."
        : "Run: vex wallet create --json",
    );
  }

  const masterPassword = requireKeystorePassword();
  const { address, credentials } = await acquirePolymarketCredentialsWithPassword(
    masterPassword,
    entry,
  );

  const stored: StoredPolyCredentials = {
    apiKey: credentials.apiKey,
    apiSecret: credentials.secret,
    passphrase: credentials.passphrase,
  };

  // Primary wallet → the updates ALSO refresh the three fixed keys (legacy read
  // fallback + setup-tool visibility). Non-primary wallets live in the map only.
  const primaryAddress = getPrimaryEvmAddress(cfg);
  const isPrimary =
    primaryAddress !== null && getAddress(primaryAddress) === getAddress(address);

  // Single source of truth for which vault keys to write (shared with the
  // vex-app onboarding handler) — map merge + primary-only fixed keys.
  const updates = buildPolymarketVaultUpdates({
    currentMapEnv: process.env[ENV_POLYMARKET_CLOB_CREDENTIALS_BY_ADDRESS],
    address,
    creds: stored,
    isPrimary,
  });

  // Persistence — vault write + .env strip + same-process env apply.
  writeSecretVaultSecrets(
    masterPassword,
    updates,
    options.secretsFilePath ? { filePath: options.secretsFilePath } : {},
  );
  stripManagedSecretsFromDotenvFile();

  // Mirror the written keys into this process so the new creds are usable now.
  for (const [key, value] of Object.entries(updates)) {
    if (value !== undefined) process.env[key] = value;
  }

  return {
    apiKeyPrefix: `${credentials.apiKey.slice(0, 8)}…`,
    storage: "secret-vault",
    address,
  };
}

// ── Internal helpers ────────────────────────────────────────────────

/**
 * Build L1 auth headers for Polymarket CLOB API.
 * Signs EIP-712 ClobAuth typed data with wallet private key.
 */
async function buildL1AuthHeaders(
  privateKey: Hex,
  nonce = 0,
): Promise<{ headers: Record<string, string>; address: Address }> {
  const { createWalletClient, http } = await import("viem");
  const { privateKeyToAccount } = await import("viem/accounts");
  const { polygon } = await import("viem/chains");

  const account = privateKeyToAccount(privateKey);
  const client = createWalletClient({ account, chain: polygon, transport: http() });

  const timestamp = Math.floor(Date.now() / 1000).toString();

  const signature = await client.signTypedData({
    domain: CLOB_AUTH_DOMAIN,
    types: CLOB_AUTH_TYPES,
    primaryType: "ClobAuth",
    message: {
      address: account.address,
      timestamp,
      nonce: BigInt(nonce),
      message: CLOB_AUTH_MESSAGE,
    },
  });

  return {
    headers: {
      POLY_ADDRESS: account.address,
      POLY_SIGNATURE: signature,
      POLY_TIMESTAMP: timestamp,
      POLY_NONCE: String(nonce),
    },
    address: account.address,
  };
}

async function tryDeriveApiKey(
  l1Headers: Record<string, string>,
): Promise<AcquiredPolymarketCredentials | null> {
  // Derive path is "best effort recovery"; any non-2xx or parse failure
  // simply falls through to create. We deliberately do NOT bubble HTTP
  // errors here — the create call below provides the canonical error
  // surface (4xx vs 5xx) for the handler.
  let response: Response;
  try {
    response = await fetchWithTimeout(`${CLOB_BASE_URL}/auth/derive-api-key`, {
      method: "GET",
      headers: l1Headers,
      timeoutMs: CLOB_TIMEOUT_MS,
    });
  } catch {
    return null;
  }

  if (!response.ok) return null;
  const data = await readJson(response);
  return parseCredentials(data);
}

async function createApiKey(
  l1Headers: Record<string, string>,
): Promise<AcquiredPolymarketCredentials> {
  // Network / timeout / DNS / connection-refused → HTTP_REQUEST_FAILED.
  // `fetchWithTimeout` already wraps these into a VexError(HTTP_REQUEST_FAILED
  // | HTTP_TIMEOUT). We re-throw both as `HTTP_REQUEST_FAILED` so the
  // handler surfaces a single transient-error code.
  let response: Response;
  try {
    response = await fetchWithTimeout(`${CLOB_BASE_URL}/auth/api-key`, {
      method: "POST",
      headers: l1Headers,
      timeoutMs: CLOB_TIMEOUT_MS,
    });
  } catch (cause: unknown) {
    if (cause instanceof VexError && cause.code === ErrorCodes.HTTP_TIMEOUT) {
      // Surface timeout as a network error — same retry semantics for the UI.
      throw new VexError(
        ErrorCodes.HTTP_REQUEST_FAILED,
        cause.message,
        cause.hint,
      );
    }
    throw cause;
  }

  // 4xx → auth failure (signature rejected, address blocked, etc.). The
  // handler maps to `provider.polymarket_setup_failed`.
  // 5xx → server-side transient failure. Maps to `provider.unavailable`.
  if (!response.ok) {
    const errBody = await readJson(response).catch(() => null);
    const errMsg = isRecord(errBody) && typeof errBody.error === "string"
      ? errBody.error
      : `HTTP ${response.status}`;

    if (response.status >= 500) {
      throw new VexError(
        ErrorCodes.HTTP_REQUEST_FAILED,
        `Polymarket API unavailable: ${errMsg}`,
        "Try again in a moment.",
      );
    }
    throw new VexError(
      ErrorCodes.POLYMARKET_AUTH_FAILED,
      `Failed to create API key: ${errMsg}`,
    );
  }

  const data = await readJson(response);
  const parsed = parseCredentials(data);
  if (!parsed) {
    // 200 with malformed body — treat as an auth-layer failure (the API
    // contract was violated) rather than a network error.
    throw new VexError(
      ErrorCodes.POLYMARKET_AUTH_FAILED,
      "Polymarket API returned an unexpected response.",
    );
  }
  return parsed;
}

function parseCredentials(data: unknown): AcquiredPolymarketCredentials | null {
  if (!isRecord(data)) return null;
  const apiKey = typeof data.apiKey === "string" ? data.apiKey : null;
  const secret = typeof data.secret === "string" ? data.secret : null;
  const passphrase = typeof data.passphrase === "string" ? data.passphrase : null;
  if (!apiKey || !secret || !passphrase) return null;
  return { apiKey, secret, passphrase };
}
