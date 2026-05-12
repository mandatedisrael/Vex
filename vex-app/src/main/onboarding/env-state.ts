/**
 * Presence-only env-state probes for `vex.onboarding.getEnvState()`.
 * MUST NOT decrypt keystores — codex turn 3 RED #3. Wallet status
 * collapses to `present | missing` (file existence at the shared
 * CONFIG_DIR), which is everything the System Check screen needs.
 *
 * M9: extends the shape with per-API-key status (jupiter / tavily /
 * rettiwt / polymarket-3-state) + embeddings.allFieldsConfigured +
 * embeddings.dbReachable. The legacy `hasJupiterApiKey` field stays
 * as a deprecated mirror of `apiKeys.jupiterConfigured` so M2/M7
 * callers keep parsing without changes.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { loadConfig } from "@vex-lib/wallet.js";
import { CONFIG_DIR, ENV_FILE, SETUP_COMPLETE_FILE } from "../paths/config-dir.js";
import type {
  EnvState,
  ProviderState,
  WalletAddresses,
} from "@shared/schemas/onboarding.js";
import type { PolymarketStatus } from "@shared/schemas/api-keys.js";
import { log } from "../logger/index.js";
import { probeEmbeddings } from "./embedding-state.js";
import { probeProvider } from "./provider-state.js";
import { probeMode } from "./mode-state.js";
import { probeWake } from "./wake-state.js";

const KEYSTORE_FILE = path.join(CONFIG_DIR, "keystore.json");
const SOLANA_KEYSTORE_FILE = path.join(CONFIG_DIR, "solana-keystore.json");

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function readEnvKeyPresence(
  envPath: string,
  key: string
): Promise<boolean> {
  try {
    const content = await fs.readFile(envPath, "utf8");
    const re = new RegExp(`^\\s*${escapeRegex(key)}\\s*=\\s*\\S`, "m");
    return re.test(content);
  } catch {
    return false;
  }
}

export async function readEnvValue(
  envPath: string,
  key: string
): Promise<string | null> {
  try {
    const content = await fs.readFile(envPath, "utf8");
    const re = new RegExp(`^\\s*${escapeRegex(key)}\\s*=\\s*(.+)$`, "m");
    const match = re.exec(content);
    if (!match) return null;
    let value = (match[1] ?? "").trim();
    value = value.replace(/^["']/, "").replace(/["']$/, "");
    return value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

export function redactEmbeddingUrl(rawUrl: string | null): string | null {
  if (!rawUrl) return null;
  try {
    const url = new URL(rawUrl);
    return `${url.protocol}//${url.host}`;
  } catch {
    return null;
  }
}

/**
 * Public addresses from `config.json` — plaintext, NOT decrypted from
 * the keystore (codex turn 3 RED #3 stays honored). Returns undefined
 * if config.json is missing or unparseable so the optional schema
 * field stays absent rather than mis-typed.
 */
function gatherWalletAddresses(): WalletAddresses | undefined {
  try {
    const cfg = loadConfig();
    return {
      evm: cfg.wallet.address ?? null,
      solana: cfg.wallet.solanaAddress ?? null,
    };
  } catch (cause) {
    log.warn("[env-state] gatherWalletAddresses failed", cause);
    return undefined;
  }
}

function polymarketStatusFrom(
  apiKey: boolean,
  apiSecret: boolean,
  passphrase: boolean,
): PolymarketStatus {
  const set = [apiKey, apiSecret, passphrase].filter(Boolean).length;
  if (set === 0) return "missing";
  if (set === 3) return "configured";
  return "partial";
}

export async function gatherEnvState(): Promise<EnvState> {
  const [
    hasPwd,
    hasJupiter,
    hasTavily,
    hasRettiwt,
    hasPolyKey,
    hasPolySecret,
    hasPolyPass,
    evmExists,
    solExists,
    setupFlag,
    embeddings,
    provider,
    mode,
    wake,
  ] = await Promise.all([
    readEnvKeyPresence(ENV_FILE, "VEX_KEYSTORE_PASSWORD"),
    readEnvKeyPresence(ENV_FILE, "JUPITER_API_KEY"),
    readEnvKeyPresence(ENV_FILE, "TAVILY_API_KEY"),
    readEnvKeyPresence(ENV_FILE, "RETTIWT_API_KEY"),
    readEnvKeyPresence(ENV_FILE, "POLYMARKET_API_KEY"),
    readEnvKeyPresence(ENV_FILE, "POLYMARKET_API_SECRET"),
    readEnvKeyPresence(ENV_FILE, "POLYMARKET_PASSPHRASE"),
    fileExists(KEYSTORE_FILE),
    fileExists(SOLANA_KEYSTORE_FILE),
    fileExists(SETUP_COMPLETE_FILE),
    probeEmbeddings(ENV_FILE),
    probeProvider(ENV_FILE),
    probeMode({ envFile: ENV_FILE }),
    probeWake({ envFile: ENV_FILE }),
  ]);

  const polymarketStatus = polymarketStatusFrom(hasPolyKey, hasPolySecret, hasPolyPass);
  const walletAddresses = gatherWalletAddresses();

  return {
    hasKeystorePassword: hasPwd,
    hasJupiterApiKey: hasJupiter,
    apiKeys: {
      jupiterConfigured: hasJupiter,
      tavilyConfigured: hasTavily,
      rettiwtConfigured: hasRettiwt,
      polymarketStatus,
    },
    embeddings,
    walletStatus: {
      evm: evmExists ? "present" : "missing",
      solana: solExists ? "present" : "missing",
    },
    ...(walletAddresses !== undefined ? { walletAddresses } : {}),
    provider,
    mode,
    wake,
    setupCompleteFlag: setupFlag,
  };
}

// Re-export ProviderState for downstream typing convenience.
export type { ProviderState };
