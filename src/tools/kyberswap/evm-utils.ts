/**
 * KyberSwap multi-chain EVM utilities — barrel re-export.
 */

export { ERC20_ABI, DEFAULT_RPC, RPC_TIMEOUT_MS, RPC_RETRY_COUNT, toViemChain } from "./evm/config.js";
export type { KyberEvmClients } from "./evm/config.js";
export { getKyberEvmClients, getKyberPublicClient } from "./evm/config.js";

export type { Erc20Metadata, ApproveResult } from "./evm/erc20.js";
export {
  readErc20Metadata,
  validateKyberSpender,
  verifyRouterAddress,
  ensureKyberAllowance,
  sendKyberTransaction,
  sendKyberTransactionWithReceipt,
} from "./evm/erc20.js";

export { ensureErc721Approval, ensureErc1155ApprovalForAll } from "./evm/nft.js";

export { extractMintedNftId, extractErc1155Position } from "./evm/receipt-logs.js";
