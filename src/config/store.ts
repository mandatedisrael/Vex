import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Address } from "viem";
import { CHAIN } from "../constants/chain.js";
import { CONFIG_DIR, CONFIG_FILE } from "./paths.js";
import { minLogger as logger } from "../utils/logger-shim.js";

export interface VexConfig {
  version: 1;
  chain: {
    chainId: number;
    name: string;
    rpcUrl: string;
    explorerUrl: string;
    nativeCurrency: {
      name: string;
      symbol: string;
      decimals: number;
    };
  };
  wallet: {
    address: Address | null;
    solanaAddress: string | null;
  };
  services: {
    vexApiUrl: string;
    khalaniApiUrl: string;
    dexScreenerApiUrl: string;
    kyberswapAggregatorUrl: string;
    kyberswapTokenApiUrl: string;
    kyberswapLimitOrderUrl: string;
    kyberswapZaasUrl: string;
    kyberswapCommonServiceUrl: string;
  };
  solana: {
    cluster: "mainnet-beta" | "devnet" | "testnet" | "custom";
    rpcUrl: string;
    explorerUrl: string;
    commitment: string;
    jupiterApiKey: string;
  };
  polymarket?: {
    clobBaseUrl?: string;
    gammaBaseUrl?: string;
    dataApiBaseUrl?: string;
  };
  claude?: {
    provider: string;
    model: string;
    providerEndpoint: string;
    proxyPort: number;
  };
}

export function getDefaultConfig(): VexConfig {
  return {
    version: 1,
    chain: {
      chainId: CHAIN.chainId,
      name: CHAIN.name,
      rpcUrl: CHAIN.rpc,
      explorerUrl: CHAIN.explorer,
      nativeCurrency: CHAIN.nativeCurrency,
    },
    wallet: {
      address: null,
      solanaAddress: null,
    },
    solana: {
      cluster: "mainnet-beta" as const,
      rpcUrl: "https://api.mainnet-beta.solana.com",
      explorerUrl: "https://explorer.solana.com",
      commitment: "confirmed",
      jupiterApiKey: "",
    },
    services: {
      vexApiUrl: "https://backend.vexlabs.ai/api",
      khalaniApiUrl: "https://api.hyperstream.dev",
      dexScreenerApiUrl: "https://api.dexscreener.com",
      kyberswapAggregatorUrl: "https://aggregator-api.kyberswap.com",
      kyberswapTokenApiUrl: "https://token-api.kyberswap.com",
      kyberswapLimitOrderUrl: "https://limit-order.kyberswap.com",
      kyberswapZaasUrl: "https://zap-api.kyberswap.com",
      kyberswapCommonServiceUrl: "https://common-service.kyberswap.com",
    },
  };
}

export function ensureConfigDir(): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
    logger.debug(`Created config directory: ${CONFIG_DIR}`);
  }
}

function parseClaudeConfig(raw: unknown): VexConfig["claude"] | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return undefined;
  }

  const candidate = raw as Record<string, unknown>;
  if (
    typeof candidate.provider !== "string"
    || typeof candidate.model !== "string"
    || typeof candidate.providerEndpoint !== "string"
    || typeof candidate.proxyPort !== "number"
  ) {
    return undefined;
  }

  return {
    provider: candidate.provider,
    model: candidate.model,
    providerEndpoint: candidate.providerEndpoint,
    proxyPort: candidate.proxyPort,
  };
}

export function loadConfig(): VexConfig {
  ensureConfigDir();
  const defaults = getDefaultConfig();

  if (!existsSync(CONFIG_FILE)) {
    logger.debug("Config file not found, using defaults");
    return defaults;
  }

  try {
    const raw = readFileSync(CONFIG_FILE, "utf-8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;

    // Validate version
    if (parsed.version !== 1) {
      logger.warn(`Unknown config version ${parsed.version}, using defaults`);
      return defaults;
    }

    const {
      watchlist: _legacyWatchlist,
      ...parsedWithoutLegacy
    } = parsed;

    // Deep merge with defaults to handle missing fields
    return {
      ...defaults,
      ...parsedWithoutLegacy,
      chain: {
        ...defaults.chain,
        ...((parsed.chain as Record<string, unknown> | undefined) ?? {}),
      },
      wallet: {
        ...defaults.wallet,
        ...((parsed.wallet as Record<string, unknown> | undefined) ?? {}),
      },
      solana: {
        ...defaults.solana,
        ...((parsed.solana as Record<string, unknown> | undefined) ?? {}),
      },
      services: {
        ...defaults.services,
        ...((parsed.services as Record<string, unknown> | undefined) ?? {}),
      },
      ...(parsed.polymarket && typeof parsed.polymarket === "object" && !Array.isArray(parsed.polymarket) ? { polymarket: parsed.polymarket as VexConfig["polymarket"] } : {}),
      ...(parseClaudeConfig(parsed.claude) ? { claude: parseClaudeConfig(parsed.claude) } : {}),
    };
  } catch (err) {
    logger.error(`Failed to parse config: ${err}`);
    return defaults;
  }
}

export function saveConfig(config: VexConfig): void {
  ensureConfigDir();

  const dir = dirname(CONFIG_FILE);
  const tmpFile = join(dir, `.config.tmp.${Date.now()}.json`);

  try {
    // Atomic write: write to temp, then rename
    writeFileSync(tmpFile, JSON.stringify(config, null, 2), "utf-8");
    renameSync(tmpFile, CONFIG_FILE);
    logger.debug(`Config saved to ${CONFIG_FILE}`);
  } catch (err) {
    // Cleanup temp file if rename failed
    try {
      if (existsSync(tmpFile)) {
        unlinkSync(tmpFile);
      }
    } catch {
      // Ignore cleanup errors
    }
    throw err;
  }
}

export function configExists(): boolean {
  return existsSync(CONFIG_FILE);
}

// ── Partial patch ────────────────────────────────────────────────────

/**
 * Shape accepted by {@link saveConfigPatch} — every top-level section is
 * optional, and for object-valued sections (chain, services, …) the patch
 * only needs to mention the fields it wants to override. `wallet`, `claude`,
 * and `polymarket` follow the same rule.
 *
 * This is NOT a `DeepPartial<VexConfig>` — we keep the nesting explicit at
 * one level so the merge code stays simple and the call sites stay typed.
 */
export type VexConfigPatch = {
  chain?: Partial<VexConfig["chain"]>;
  wallet?: Partial<VexConfig["wallet"]>;
  solana?: Partial<VexConfig["solana"]>;
  services?: Partial<VexConfig["services"]>;
  polymarket?: NonNullable<VexConfig["polymarket"]>;
  claude?: NonNullable<VexConfig["claude"]>;
};

/**
 * Apply a partial config patch — loads current config (merged with defaults),
 * shallow-merges each provided section, and atomically writes the result.
 * Intended for UI editors (shell settings panel) that only know about a
 * subset of fields.
 *
 * Returns the persisted config so the caller can refresh any cached view.
 */
export function saveConfigPatch(patch: VexConfigPatch): VexConfig {
  const current = loadConfig();
  const next: VexConfig = {
    ...current,
    ...(patch.chain ? { chain: { ...current.chain, ...patch.chain } } : {}),
    ...(patch.wallet ? { wallet: { ...current.wallet, ...patch.wallet } } : {}),
    ...(patch.solana ? { solana: { ...current.solana, ...patch.solana } } : {}),
    ...(patch.services ? { services: { ...current.services, ...patch.services } } : {}),
    ...(patch.polymarket ? { polymarket: { ...(current.polymarket ?? {}), ...patch.polymarket } } : {}),
    ...(patch.claude ? { claude: { ...(current.claude ?? {} as VexConfig["claude"]), ...patch.claude } as VexConfig["claude"] } : {}),
  };
  saveConfig(next);
  return next;
}
