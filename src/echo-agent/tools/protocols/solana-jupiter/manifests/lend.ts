import type { ProtocolToolManifest } from "../../types.js";
import { SOLANA_LEND_DISCOVERY } from "../../embeddings/solana-jupiter/lend.js";

export const LEND_TOOLS: readonly ProtocolToolManifest[] = [
  {
    toolId: "solana.lend.rates",
    namespace: "solana",
    lifecycle: "active",
    description: "Get lending rates — APY (supply + rewards), TVL, total supply per token.",
    mutating: false,
    params: [],
    exampleParams: {},
    requiresEnv: "JUPITER_API_KEY",
    discovery: SOLANA_LEND_DISCOVERY["solana.lend.rates"],
  },
  {
    toolId: "solana.lend.positions",
    namespace: "solana",
    lifecycle: "active",
    description: "Get lending positions and accrued earnings for a wallet.",
    mutating: false,
    params: [
      { key: "address", type: "string", required: true, description: "Wallet address." },
    ],
    exampleParams: { address: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM" },
    requiresEnv: "JUPITER_API_KEY",
    discovery: SOLANA_LEND_DISCOVERY["solana.lend.positions"],
  },
  {
    toolId: "solana.lend.deposit",
    namespace: "solana",
    lifecycle: "active",
    description: "Deposit tokens into Jupiter Lend Earn vault.",
    mutating: true,
    params: [
      { key: "asset", type: "string", required: true, description: "Token address to deposit." },
      { key: "amount", type: "string", required: true, description: "Amount in atomic units." },
    ],
    exampleParams: { asset: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", amount: "1000000" },
    requiresEnv: "JUPITER_API_KEY",
    discovery: SOLANA_LEND_DISCOVERY["solana.lend.deposit"],
  },
  {
    toolId: "solana.lend.withdraw",
    namespace: "solana",
    lifecycle: "active",
    description: "Withdraw tokens from Jupiter Lend Earn vault.",
    mutating: true,
    params: [
      { key: "asset", type: "string", required: true, description: "Token address to withdraw." },
      { key: "amount", type: "string", required: true, description: "Amount in atomic units." },
    ],
    exampleParams: { asset: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", amount: "1000000" },
    requiresEnv: "JUPITER_API_KEY",
    discovery: SOLANA_LEND_DISCOVERY["solana.lend.withdraw"],
  },
];
