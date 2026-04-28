import type { ProtocolToolManifest } from "../../types.js";
import { POLYMARKET_BRIDGE_DISCOVERY } from "../../embeddings/polymarket/bridge.js";

export const BRIDGE_TOOLS: readonly ProtocolToolManifest[] = [
  {
    toolId: "polymarket.bridge.assets",
    namespace: "polymarket",
    lifecycle: "active",
    description: "List supported chains and tokens for Polymarket bridge — chain IDs, token addresses, decimals, minimum checkout amount in USD.",
    mutating: false,
    params: [],
    exampleParams: {},
    discovery: POLYMARKET_BRIDGE_DISCOVERY["polymarket.bridge.assets"],
  },
  {
    toolId: "polymarket.bridge.deposit",
    namespace: "polymarket",
    lifecycle: "active",
    description: "Create a deposit address for funding Polymarket account. Returns EVM, Solana, and/or BTC deposit addresses.",
    mutating: true,
    params: [
      { key: "address", type: "string", required: true, description: "Your Polymarket (Polygon) wallet address." },
    ],
    exampleParams: { address: "0x1234..." },
    discovery: POLYMARKET_BRIDGE_DISCOVERY["polymarket.bridge.deposit"],
  },
  {
    toolId: "polymarket.bridge.withdraw",
    namespace: "polymarket",
    lifecycle: "active",
    description: "Create a withdrawal from Polymarket to another chain. Returns deposit address to send USDC.e to.",
    mutating: true,
    params: [
      { key: "address", type: "string", required: true, description: "Your Polymarket (Polygon) wallet address." },
      { key: "toChainId", type: "string", required: true, description: "Destination chain ID." },
      { key: "toTokenAddress", type: "string", required: true, description: "Destination token address." },
      { key: "recipientAddr", type: "string", required: true, description: "Recipient address on destination chain." },
    ],
    exampleParams: { address: "0x1234...", toChainId: "1", toTokenAddress: "0xA0b8...", recipientAddr: "0x5678..." },
    discovery: POLYMARKET_BRIDGE_DISCOVERY["polymarket.bridge.withdraw"],
  },
  {
    toolId: "polymarket.bridge.quote",
    namespace: "polymarket",
    lifecycle: "active",
    description: "Get bridge quote — estimated output, fees, checkout time for a cross-chain transfer to/from Polymarket.",
    mutating: false,
    params: [
      { key: "fromAmountBaseUnit", type: "string", required: true, description: "Input amount in smallest units (e.g. USDC 6 decimals: 1000000 = 1 USDC)." },
      { key: "fromChainId", type: "string", required: true, description: "Source chain ID." },
      { key: "fromTokenAddress", type: "string", required: true, description: "Source token address." },
      { key: "recipientAddress", type: "string", required: true, description: "Recipient address on destination chain." },
      { key: "toChainId", type: "string", required: true, description: "Destination chain ID." },
      { key: "toTokenAddress", type: "string", required: true, description: "Destination token address." },
    ],
    exampleParams: { fromAmountBaseUnit: "10000000", fromChainId: "1", fromTokenAddress: "0xA0b8...", recipientAddress: "0x1234...", toChainId: "137", toTokenAddress: "0x2791..." },
    discovery: POLYMARKET_BRIDGE_DISCOVERY["polymarket.bridge.quote"],
  },
  {
    toolId: "polymarket.bridge.status",
    namespace: "polymarket",
    lifecycle: "active",
    description: "Check status of bridge transactions for an address — DEPOSIT_DETECTED, PROCESSING, COMPLETED, FAILED.",
    mutating: false,
    params: [
      { key: "address", type: "string", required: true, description: "Deposit or withdrawal address to check." },
    ],
    exampleParams: { address: "0x1234..." },
    discovery: POLYMARKET_BRIDGE_DISCOVERY["polymarket.bridge.status"],
  },
];
