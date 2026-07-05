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
import type { KhalaniChain } from "./types.js";
import { getChainRpcUrl } from "./chains.js";

const EVM_RPC_TIMEOUT_MS = 30_000;
const EVM_RPC_RETRY_COUNT = 2;

function toViemChain(chain: KhalaniChain, rpcUrl: string): Chain {
  return {
    id: chain.id,
    name: chain.name,
    nativeCurrency: chain.nativeCurrency,
    rpcUrls: { default: { http: [rpcUrl] } },
    blockExplorers: chain.blockExplorers?.default
      ? {
          default: {
            name: chain.blockExplorers.default.name,
            url: chain.blockExplorers.default.url,
          },
        }
      : undefined,
  };
}

// Explicit return annotations (mirroring kyberswap/evm/config.ts): viem's
// inferred client types reference internal action modules and are not
// portable across declaration emit (TS2742).
export function createDynamicWalletClient(
  chain: KhalaniChain,
  chains: KhalaniChain[],
  privateKey: Hex,
): WalletClient<Transport, Chain, Account> {
  const rpcUrl = getChainRpcUrl(chain.id, chains);
  return createWalletClient({
    account: privateKeyToAccount(privateKey),
    chain: toViemChain(chain, rpcUrl),
    transport: http(rpcUrl, { timeout: EVM_RPC_TIMEOUT_MS, retryCount: EVM_RPC_RETRY_COUNT }),
  }) as WalletClient<Transport, Chain, Account>;
}

export function createDynamicPublicClient(
  chain: KhalaniChain,
  chains: KhalaniChain[],
): PublicClient<Transport, Chain> {
  const rpcUrl = getChainRpcUrl(chain.id, chains);
  return createPublicClient({
    chain: toViemChain(chain, rpcUrl),
    transport: http(rpcUrl, { timeout: EVM_RPC_TIMEOUT_MS, retryCount: EVM_RPC_RETRY_COUNT }),
  }) as PublicClient<Transport, Chain>;
}
