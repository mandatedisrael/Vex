/**
 * Pendle viem client factory (Ethereum mainnet, public + wallet).
 *
 * Self-contained (not coupled to another venue): builds an Ethereum-mainnet viem
 * chain from a keyless public RPC. Gas is estimated fresh at send time (viem
 * default) — never cached.
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  type Account,
  type Chain,
  type Hex,
  type PublicClient,
  type Transport,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { PENDLE_CHAIN_ID, PENDLE_ETHEREUM_RPC_URL } from "./constants.js";

const RPC_TIMEOUT_MS = 30_000;
const RPC_RETRY_COUNT = 2;

const ETHEREUM_CHAIN: Chain = {
  id: PENDLE_CHAIN_ID,
  name: "Ethereum",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [PENDLE_ETHEREUM_RPC_URL] } },
};

export interface PendleEvmClients {
  publicClient: PublicClient<Transport, Chain>;
  walletClient: WalletClient<Transport, Chain, Account>;
}

/** Read-only Ethereum public client (balances / allowance / metadata). */
export function getPendlePublicClient(): PublicClient<Transport, Chain> {
  return createPublicClient({
    chain: ETHEREUM_CHAIN,
    transport: http(PENDLE_ETHEREUM_RPC_URL, { timeout: RPC_TIMEOUT_MS, retryCount: RPC_RETRY_COUNT }),
  }) as PublicClient<Transport, Chain>;
}

/** Public + wallet clients for broadcast. Decrypts nothing beyond the passed key. */
export function getPendleEvmClients(privateKey: Hex): PendleEvmClients {
  const publicClient = getPendlePublicClient();
  const walletClient = createWalletClient({
    account: privateKeyToAccount(privateKey),
    chain: ETHEREUM_CHAIN,
    transport: http(PENDLE_ETHEREUM_RPC_URL, { timeout: RPC_TIMEOUT_MS, retryCount: RPC_RETRY_COUNT }),
  }) as WalletClient<Transport, Chain, Account>;
  return { publicClient, walletClient };
}
