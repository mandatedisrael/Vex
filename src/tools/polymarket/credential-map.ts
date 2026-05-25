/**
 * Per-wallet Polymarket CLOB credential map (puzzle 5 B-core).
 *
 * Storage model A (Codex GREEN LIGHT): ONE encrypted vault secret
 * (`POLYMARKET_CLOB_CREDENTIALS_BY_ADDRESS`) whose value is a JSON object keyed
 * by the normalized (lowercased) EVM address:
 *   { "<lc-addr>": { apiKey, apiSecret, passphrase } }
 *
 * The value is mirrored into `process.env` at vault unlock, so both the read
 * path (`auth.requirePolyClobCredentials`) and the write/merge path
 * (`wallet/polymarket-credentials.deriveAndSavePolymarketCredentials`) operate
 * on `process.env[ENV_POLYMARKET_CLOB_CREDENTIALS_BY_ADDRESS]`.
 *
 * This module is PURE (zod + viem address normalization only) — no keystore /
 * decrypt imports — so it is safe to import from the protocol-path
 * `polymarket/` tree AND from the wallet module that derives creds.
 *
 * Fail-closed contract: a present-but-malformed map throws (never silently
 * degrades to "no creds"), so vault corruption surfaces instead of hiding.
 */

import { z } from "zod";
import { getAddress } from "viem";
import { VexError, ErrorCodes } from "../../errors.js";
import type { VaultSecretKey } from "../../lib/secret-keys.js";
import {
  ENV_POLYMARKET_API_KEY,
  ENV_POLYMARKET_API_SECRET,
  ENV_POLYMARKET_PASSPHRASE,
  ENV_POLYMARKET_CLOB_CREDENTIALS_BY_ADDRESS,
} from "./constants.js";

/** One wallet's CLOB credentials, as stored in the map and consumed by auth. */
export interface StoredPolyCredentials {
  apiKey: string;
  apiSecret: string;
  passphrase: string;
}

const storedCredsSchema = z
  .object({
    apiKey: z.string().min(1),
    apiSecret: z.string().min(1),
    passphrase: z.string().min(1),
  })
  .strict();

/** Map of normalized EVM address → credentials. */
const credentialMapSchema = z.record(z.string(), storedCredsSchema);

export type CredentialMap = Record<string, StoredPolyCredentials>;

/**
 * Normalize an EVM address into the map key form: checksum-validated, then
 * lowercased. Throws (viem) on a non-address string — callers always pass a
 * resolved wallet address, so an invalid value here is a bug worth surfacing.
 */
export function normalizePolyAddress(address: string): string {
  return getAddress(address).toLowerCase();
}

/**
 * Parse the credential-map env value. Absent / empty → `{}` (a valid empty
 * map — fall through to the legacy fallback / "not configured"). Present but
 * malformed (bad JSON or shape) → throw, so corruption fails CLOSED rather than
 * silently masquerading as "no creds for this wallet".
 */
export function parseCredentialMapEnv(raw: string | undefined): CredentialMap {
  if (!raw || raw.trim().length === 0) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new VexError(
      ErrorCodes.POLYMARKET_NOT_CONFIGURED,
      "Polymarket per-wallet credential map is corrupt (invalid JSON).",
      "Re-run Polymarket setup for the affected wallet to regenerate credentials.",
    );
  }

  const result = credentialMapSchema.safeParse(parsed);
  if (!result.success) {
    throw new VexError(
      ErrorCodes.POLYMARKET_NOT_CONFIGURED,
      "Polymarket per-wallet credential map is malformed.",
      "Re-run Polymarket setup for the affected wallet to regenerate credentials.",
    );
  }
  return result.data;
}

/** Serialize a credential map for storage (deterministic, no pretty-print). */
export function serializeCredentialMap(map: CredentialMap): string {
  return JSON.stringify(map);
}

/**
 * Return a NEW map with `address`'s entry set/replaced — preserves every other
 * wallet's credentials. Address is normalized to the map key form.
 */
export function withCredentialEntry(
  map: CredentialMap,
  address: string,
  creds: StoredPolyCredentials,
): CredentialMap {
  return { ...map, [normalizePolyAddress(address)]: creds };
}

/**
 * Build the vault-secret updates for persisting one wallet's CLOB credentials —
 * the SINGLE source of truth for "which keys get written" (puzzle 5 B-UI D1).
 * Shared by the CLI/env path (`deriveAndSavePolymarketCredentials`) and the
 * vex-app onboarding handler so the rule cannot drift between them:
 *   - ALWAYS merge `creds` into the per-address map (preserving other wallets);
 *   - for the PRIMARY wallet ONLY, ALSO refresh the three fixed legacy keys
 *     (backward-compat read fallback + setup-tool visibility). Non-primary
 *     wallets live in the map only.
 *
 * PURE: parse/merge/serialize only — never touches the keystore, the vault, or
 * process.env. Callers persist the returned object with their own writer (CLI:
 * writeSecretVaultSecrets; vex-app: writeUnlockedSecrets) and decide `isPrimary`.
 * A malformed `currentMapEnv` throws via `parseCredentialMapEnv` (fail closed).
 */
export function buildPolymarketVaultUpdates(args: {
  readonly currentMapEnv: string | undefined;
  readonly address: string;
  readonly creds: StoredPolyCredentials;
  readonly isPrimary: boolean;
}): Partial<Record<VaultSecretKey, string>> {
  const nextMap = withCredentialEntry(
    parseCredentialMapEnv(args.currentMapEnv),
    args.address,
    args.creds,
  );
  const updates: Partial<Record<VaultSecretKey, string>> = {
    [ENV_POLYMARKET_CLOB_CREDENTIALS_BY_ADDRESS]: serializeCredentialMap(nextMap),
  };
  if (args.isPrimary) {
    updates[ENV_POLYMARKET_API_KEY] = args.creds.apiKey;
    updates[ENV_POLYMARKET_API_SECRET] = args.creds.apiSecret;
    updates[ENV_POLYMARKET_PASSPHRASE] = args.creds.passphrase;
  }
  return updates;
}
