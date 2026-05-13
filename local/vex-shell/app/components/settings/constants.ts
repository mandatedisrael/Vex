import type { VexConfig, VexConfigPatch } from "../../../../../src/config/store.js";
import type { SettingsTabId } from "../../state/store.js";

export const TAB_LABELS: Record<SettingsTabId, string> = {
  provider: "Provider",
  session: "Session",
  mission: "Mission",
  approvals: "Approvals",
  tools: "Tools",
  knowledge: "Knowledge",
  subagents: "Subagents",
  diagnostics: "Diagnostics",
  services: "Services",
  env: "Env",
  config: "Config",
  advanced: "Advanced",
};

export const ENV_FIELDS: ReadonlyArray<{ key: string; secret: boolean }> = [
  { key: "VEX_DB_URL", secret: false },
  { key: "VEX_KEYSTORE_PASSWORD", secret: true },
  { key: "JUPITER_API_KEY", secret: true },
  { key: "EMBEDDING_BASE_URL", secret: false },
  { key: "EMBEDDING_MODEL", secret: false },
  { key: "EMBEDDING_DIM", secret: false },
  { key: "EMBEDDING_PROVIDER", secret: false },
  { key: "AGENT_PROVIDER", secret: false },
  { key: "AGENT_MODEL", secret: false },
  { key: "AGENT_CONTEXT_LIMIT", secret: false },
  { key: "AGENT_MAX_OUTPUT_TOKENS", secret: false },
  { key: "AGENT_TEMPERATURE", secret: false },
  { key: "OPENROUTER_API_KEY", secret: true },
  { key: "TAVILY_API_KEY", secret: true },
  { key: "RETTIWT_API_KEY", secret: true },
  { key: "POLYMARKET_API_KEY", secret: true },
  { key: "POLYMARKET_API_SECRET", secret: true },
  { key: "POLYMARKET_PASSPHRASE", secret: true },
  { key: "DISCOVERY_QUERY_PRIVACY", secret: false },
  { key: "LOG_LEVEL", secret: false },
  { key: "LOG_FORMAT", secret: false },
];

export const ADVANCED_FIELDS: ReadonlyArray<{ key: string; hint: string }> = [
  { key: "SUBAGENT_MAX_CONCURRENT", hint: "1..20, default 5" },
  { key: "SUBAGENT_CONTEXT_LIMIT", hint: "1000..2_000_000, default 16_384" },
  { key: "SUBAGENT_MAX_OUTPUT_TOKENS", hint: "256..128_000, default = agent max" },
  { key: "SUBAGENT_TEMPERATURE", hint: "0..2, default = agent temp" },
  { key: "SUBAGENT_MAX_ITERATIONS", hint: "1..200, default 25" },
  { key: "SUBAGENT_TIMEOUT_MS", hint: "10_000..1_800_000, default 300_000" },
];

export const CONFIG_FIELDS: ReadonlyArray<{
  key: string;
  read: (cfg: VexConfig) => string;
  patch: (value: string) => VexConfigPatch;
}> = [
  {
    key: "chain.rpcUrl",
    read: (c) => c.chain.rpcUrl,
    patch: (v) => ({ chain: { rpcUrl: v } }),
  },
  {
    key: "solana.rpcUrl",
    read: (c) => c.solana.rpcUrl,
    patch: (v) => ({ solana: { rpcUrl: v } }),
  },
  {
    key: "services.vexApiUrl",
    read: (c) => c.services.vexApiUrl,
    patch: (v) => ({ services: { vexApiUrl: v } }),
  },
  {
    key: "services.khalaniApiUrl",
    read: (c) => c.services.khalaniApiUrl,
    patch: (v) => ({ services: { khalaniApiUrl: v } }),
  },
  {
    key: "services.dexScreenerApiUrl",
    read: (c) => c.services.dexScreenerApiUrl,
    patch: (v) => ({ services: { dexScreenerApiUrl: v } }),
  },
  {
    key: "services.kyberswapAggregatorUrl",
    read: (c) => c.services.kyberswapAggregatorUrl,
    patch: (v) => ({ services: { kyberswapAggregatorUrl: v } }),
  },
  {
    key: "polymarket.clobBaseUrl",
    read: (c) => c.polymarket?.clobBaseUrl ?? "",
    patch: (v) => ({ polymarket: { clobBaseUrl: v } }),
  },
  {
    key: "polymarket.gammaBaseUrl",
    read: (c) => c.polymarket?.gammaBaseUrl ?? "",
    patch: (v) => ({ polymarket: { gammaBaseUrl: v } }),
  },
];
