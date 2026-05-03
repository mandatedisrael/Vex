import { existsSync, readFileSync } from "node:fs";
import { CONFIG_FILE, ENV_FILE, KEYSTORE_FILE, SOLANA_KEYSTORE_FILE } from "../../config/paths.js";
import { loadConfig } from "../../config/store.js";
import { readEnvValue } from "../../providers/env-resolution.js";
import { getKeystorePassword } from "../../utils/env.js";
import { decryptPrivateKey, loadKeystore } from "../../tools/wallet/keystore.js";
import {
  decryptSolanaSecretKey,
  deriveSolanaAddress,
  loadSolanaKeystore,
} from "../../tools/wallet/solana-keystore.js";

export interface EnvFieldSpec {
  key: string;
  required: boolean;
  description: string;
}

export interface EnvFieldStatus extends EnvFieldSpec {
  status: "configured" | "missing";
}

export interface WalletStatus {
  kind: "evm" | "solana";
  status: "configured" | "missing";
  address: string | null;
  detail: string;
  hasStoredState: boolean;
}

export const ENV_FIELDS: readonly EnvFieldSpec[] = [
  {
    key: "VEX_DB_URL",
    required: true,
    description: "Local Postgres database used by Vex MCP.",
  },
  {
    key: "EMBEDDING_BASE_URL",
    required: true,
    description: "Embeddings endpoint used by local MCP health checks.",
  },
  {
    key: "EMBEDDING_MODEL",
    required: true,
    description: "Embedding model identifier sent to the local provider.",
  },
  {
    key: "EMBEDDING_DIM",
    required: true,
    description: "Expected embedding vector length for bootstrap validation.",
  },
  {
    key: "EMBEDDING_PROVIDER",
    required: true,
    description: "Provider label used for runtime validation and logging.",
  },
  {
    key: "VEX_KEYSTORE_PASSWORD",
    required: true,
    description: "Password used to unlock and validate both local wallets.",
  },
  {
    key: "JUPITER_API_KEY",
    required: true,
    description: "Jupiter API key required to enable Solana swaps, lending, and prediction tools.",
  },
  {
    key: "TAVILY_API_KEY",
    required: false,
    description: "Optional key for web_research (search + page fetch). You can add it later without rerunning wallet setup.",
  },
  {
    key: "RETTIWT_API_KEY",
    required: false,
    description: "Optional Rettiwt cookie-session key for read-only Twitter/X account research. Use a secondary account.",
  },
] as const;

export function parseDotenvContent(content: string): Record<string, string> {
  const values: Record<string, string> = {};

  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const eqIndex = line.indexOf("=");
    if (eqIndex < 1) continue;

    const key = line.slice(0, eqIndex).trim();
    let value = line.slice(eqIndex + 1).trim();

    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
    }

    values[key] = value;
  }

  return values;
}

export function readAppEnvMap(envPath: string = ENV_FILE): Record<string, string> {
  if (!existsSync(envPath)) return {};
  return parseDotenvContent(readFileSync(envPath, "utf-8"));
}

export function collectEnvFieldStatuses(envPath: string = ENV_FILE): EnvFieldStatus[] {
  return ENV_FIELDS.map((field) => {
    const value = readEnvValue(field.key, envPath);
    return {
      ...field,
      status: value ? "configured" : "missing",
    };
  });
}

export function getEvmWalletStatus(): WalletStatus {
  const config = loadConfig();
  const address = config.wallet.address;
  const hasStoredState = Boolean(address) || existsSync(KEYSTORE_FILE) || existsSync(CONFIG_FILE);

  if (!address) {
    return {
      kind: "evm",
      status: "missing",
      address: null,
      detail: "No EVM wallet address is stored in config.json.",
      hasStoredState,
    };
  }

  const keystore = loadKeystore();
  if (!keystore) {
    return {
      kind: "evm",
      status: "missing",
      address,
      detail: "EVM keystore.json is missing.",
      hasStoredState,
    };
  }

  const password = getKeystorePassword();
  if (!password) {
    return {
      kind: "evm",
      status: "missing",
      address,
      detail: "VEX_KEYSTORE_PASSWORD is missing in CONFIG_DIR/.env.",
      hasStoredState,
    };
  }

  try {
    decryptPrivateKey(keystore, password);
    return {
      kind: "evm",
      status: "configured",
      address,
      detail: "Ready for local signing.",
      hasStoredState,
    };
  } catch (err) {
    return {
      kind: "evm",
      status: "missing",
      address,
      detail: err instanceof Error ? err.message : "Stored EVM wallet could not be decrypted.",
      hasStoredState,
    };
  }
}

export function getSolanaWalletStatus(): WalletStatus {
  const config = loadConfig();
  const address = config.wallet.solanaAddress;
  const hasStoredState = Boolean(address) || existsSync(SOLANA_KEYSTORE_FILE) || existsSync(CONFIG_FILE);

  if (!address) {
    return {
      kind: "solana",
      status: "missing",
      address: null,
      detail: "No Solana wallet address is stored in config.json.",
      hasStoredState,
    };
  }

  const keystore = loadSolanaKeystore();
  if (!keystore) {
    return {
      kind: "solana",
      status: "missing",
      address,
      detail: "solana-keystore.json is missing.",
      hasStoredState,
    };
  }

  const password = getKeystorePassword();
  if (!password) {
    return {
      kind: "solana",
      status: "missing",
      address,
      detail: "VEX_KEYSTORE_PASSWORD is missing in CONFIG_DIR/.env.",
      hasStoredState,
    };
  }

  try {
    const secretKey = decryptSolanaSecretKey(keystore, password);
    const derivedAddress = deriveSolanaAddress(secretKey);
    if (derivedAddress !== address) {
      return {
        kind: "solana",
        status: "missing",
        address,
        detail: "Configured Solana address does not match the stored keystore.",
        hasStoredState,
      };
    }

    return {
      kind: "solana",
      status: "configured",
      address,
      detail: "Ready for local signing.",
      hasStoredState,
    };
  } catch (err) {
    return {
      kind: "solana",
      status: "missing",
      address,
      detail: err instanceof Error ? err.message : "Stored Solana wallet could not be decrypted.",
      hasStoredState,
    };
  }
}
