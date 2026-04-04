/**
 * ChainScan public API client.
 * Thin wrappers over fetchEtherscanApi / fetchCustomApi with input validation.
 */

import { EchoError, ErrorCodes } from "../../errors.js";
import { CHAINSCAN_DEFAULTS } from "./constants.js";
import {
  validateAddress,
  validateTxHash,
  validateAddressBatch,
  validateHashBatch,
  validatePagination,
  validateStatsPagination,
  validateTag,
} from "./validation.js";
import type {
  ChainScanTx,
  ChainScanTokenTransfer,
  ChainScanNftTransfer,
  ChainScanBalanceMulti,
  ChainScanTxStatus,
  ChainScanTxReceipt,
  ChainScanContractSource,
  ChainScanContractCreation,
  ChainScanDecodedMethod,
  ChainScanDecodedRaw,
  ChainScanTokenHolderStat,
  ChainScanTokenTransferStat,
  ChainScanUniqueParticipantStat,
  ChainScanTopAddress,
  PaginationOpts,
  StatsPaginationOpts,
} from "./types.js";
import { fetchEtherscanApi, fetchCustomApi } from "./transport.js";

// --- Public API ---

export const chainscanClient = {
  // === Account ===

  getBalance(address: string, tag?: string): Promise<string> {
    const addr = validateAddress(address);
    const validTag = validateTag(tag);
    return fetchEtherscanApi<string>({
      module: "account",
      action: "balance",
      address: addr.toLowerCase(),
      tag: validTag,
    });
  },

  getBalanceMulti(addresses: string[], tag?: string): Promise<ChainScanBalanceMulti[]> {
    const validated = validateAddressBatch(addresses, CHAINSCAN_DEFAULTS.MAX_BATCH_BALANCE);
    const validTag = validateTag(tag);
    return fetchEtherscanApi<ChainScanBalanceMulti[]>({
      module: "account",
      action: "balancemulti",
      address: validated.map(a => a.toLowerCase()).join(","),
      tag: validTag,
    });
  },

  getTransactions(address: string, opts?: PaginationOpts): Promise<ChainScanTx[]> {
    const addr = validateAddress(address);
    const pag = validatePagination(opts);
    return fetchEtherscanApi<ChainScanTx[]>({
      module: "account",
      action: "txlist",
      address: addr.toLowerCase(),
      startblock: pag.startblock ?? "0",
      endblock: pag.endblock ?? "99999999",
      page: String(pag.page),
      offset: String(pag.offset),
      sort: pag.sort,
    });
  },

  getTokenTransfers(address: string, opts?: PaginationOpts & { contractaddress?: string }): Promise<ChainScanTokenTransfer[]> {
    const addr = validateAddress(address);
    const pag = validatePagination(opts);
    const params: Record<string, string> = {
      module: "account",
      action: "tokentx",
      address: addr.toLowerCase(),
      startblock: pag.startblock ?? "0",
      endblock: pag.endblock ?? "99999999",
      page: String(pag.page),
      offset: String(pag.offset),
      sort: pag.sort,
    };
    if (opts?.contractaddress) {
      params.contractaddress = validateAddress(opts.contractaddress, "contractaddress").toLowerCase();
    }
    return fetchEtherscanApi<ChainScanTokenTransfer[]>(params);
  },

  getNftTransfers(address: string, opts?: PaginationOpts & { contractaddress?: string }): Promise<ChainScanNftTransfer[]> {
    const addr = validateAddress(address);
    const pag = validatePagination(opts);
    const params: Record<string, string> = {
      module: "account",
      action: "tokennfttx",
      address: addr.toLowerCase(),
      startblock: pag.startblock ?? "0",
      endblock: pag.endblock ?? "99999999",
      page: String(pag.page),
      offset: String(pag.offset),
      sort: pag.sort,
    };
    if (opts?.contractaddress) {
      params.contractaddress = validateAddress(opts.contractaddress, "contractaddress").toLowerCase();
    }
    return fetchEtherscanApi<ChainScanNftTransfer[]>(params);
  },

  getTokenBalance(address: string, contractAddress: string): Promise<string> {
    const addr = validateAddress(address);
    const contract = validateAddress(contractAddress, "contractAddress");
    return fetchEtherscanApi<string>({
      module: "account",
      action: "tokenbalance",
      address: addr.toLowerCase(),
      contractaddress: contract.toLowerCase(),
      tag: "latest",
    });
  },

  // === Transaction verification ===

  getTxStatus(txHash: string): Promise<ChainScanTxStatus> {
    const hash = validateTxHash(txHash);
    return fetchEtherscanApi<ChainScanTxStatus>({
      module: "transaction",
      action: "getstatus",
      txhash: hash,
    });
  },

  getTxReceiptStatus(txHash: string): Promise<ChainScanTxReceipt> {
    const hash = validateTxHash(txHash);
    return fetchEtherscanApi<ChainScanTxReceipt>({
      module: "transaction",
      action: "gettxreceiptstatus",
      txhash: hash,
    });
  },

  // === Contract intel ===

  getContractAbi(address: string): Promise<string> {
    const addr = validateAddress(address);
    return fetchEtherscanApi<string>({
      module: "contract",
      action: "getabi",
      address: addr.toLowerCase(),
    });
  },

  getContractSource(address: string): Promise<ChainScanContractSource[]> {
    const addr = validateAddress(address);
    return fetchEtherscanApi<ChainScanContractSource[]>({
      module: "contract",
      action: "getsourcecode",
      address: addr.toLowerCase(),
    });
  },

  getContractCreation(addresses: string[]): Promise<ChainScanContractCreation[]> {
    const validated = validateAddressBatch(addresses, CHAINSCAN_DEFAULTS.MAX_BATCH_ADDRESSES);
    return fetchEtherscanApi<ChainScanContractCreation[]>({
      module: "contract",
      action: "getcontractcreation",
      contractaddresses: validated.map(a => a.toLowerCase()).join(","),
    });
  },

  // === Decode ===

  decodeByHashes(hashes: string[]): Promise<ChainScanDecodedMethod[]> {
    const validated = validateHashBatch(hashes, CHAINSCAN_DEFAULTS.MAX_BATCH_DECODE);
    return fetchCustomApi<ChainScanDecodedMethod[]>(
      "/util/decode/method",
      { hashes: validated.join(",") }
    );
  },

  decodeRaw(contracts: string[], inputs: string[]): Promise<ChainScanDecodedRaw[]> {
    if (contracts.length !== inputs.length) {
      throw new EchoError(
        ErrorCodes.INVALID_AMOUNT,
        `contracts (${contracts.length}) and inputs (${inputs.length}) must have same length`
      );
    }
    const validatedContracts = validateAddressBatch(contracts, CHAINSCAN_DEFAULTS.MAX_BATCH_DECODE);
    return fetchCustomApi<ChainScanDecodedRaw[]>(
      "/util/decode/method/raw",
      {
        contracts: validatedContracts.map(a => a.toLowerCase()).join(","),
        inputs: inputs.join(","),
      }
    );
  },

  // === Token supply ===

  getTokenSupply(contractAddress: string): Promise<string> {
    const addr = validateAddress(contractAddress, "contractAddress");
    return fetchEtherscanApi<string>({
      module: "stats",
      action: "tokensupply",
      contractaddress: addr.toLowerCase(),
    });
  },

  // === Meme coin intel (statistics endpoints) ===

  async getTokenHolderStats(contract: string, opts?: StatsPaginationOpts): Promise<ChainScanTokenHolderStat[]> {
    const addr = validateAddress(contract, "contract");
    const pag = validateStatsPagination(opts);
    const params: Record<string, string> = {
      contract: addr.toLowerCase(),
      skip: String(pag.skip),
      limit: String(pag.limit),
      sort: pag.sort.toUpperCase(),
    };
    if (pag.minTimestamp) params.minTimestamp = pag.minTimestamp;
    if (pag.maxTimestamp) params.maxTimestamp = pag.maxTimestamp;
    const res = await fetchCustomApi<{ list: ChainScanTokenHolderStat[] }>("/statistics/token/holder", params);
    return res.list;
  },

  async getTokenTransferStats(contract: string, opts?: StatsPaginationOpts): Promise<ChainScanTokenTransferStat[]> {
    const addr = validateAddress(contract, "contract");
    const pag = validateStatsPagination(opts);
    const params: Record<string, string> = {
      contract: addr.toLowerCase(),
      skip: String(pag.skip),
      limit: String(pag.limit),
      sort: pag.sort.toUpperCase(),
    };
    if (pag.minTimestamp) params.minTimestamp = pag.minTimestamp;
    if (pag.maxTimestamp) params.maxTimestamp = pag.maxTimestamp;
    const res = await fetchCustomApi<{ list: ChainScanTokenTransferStat[] }>("/statistics/token/transfer", params);
    return res.list;
  },

  async getTokenUniqueParticipants(contract: string, opts?: StatsPaginationOpts): Promise<ChainScanUniqueParticipantStat[]> {
    const addr = validateAddress(contract, "contract");
    const pag = validateStatsPagination(opts);
    const params: Record<string, string> = {
      contract: addr.toLowerCase(),
      skip: String(pag.skip),
      limit: String(pag.limit),
      sort: pag.sort.toUpperCase(),
    };
    if (pag.minTimestamp) params.minTimestamp = pag.minTimestamp;
    if (pag.maxTimestamp) params.maxTimestamp = pag.maxTimestamp;
    const res = await fetchCustomApi<{ list: ChainScanUniqueParticipantStat[] }>("/statistics/token/unique/participant", params);
    return res.list;
  },

  async getTopTokenSenders(spanType: "24h" | "3d" | "7d" = "24h"): Promise<ChainScanTopAddress[]> {
    const res = await fetchCustomApi<{ list: ChainScanTopAddress[] }>("/statistics/top/token/sender", { spanType });
    return res.list;
  },

  async getTopTokenReceivers(spanType: "24h" | "3d" | "7d" = "24h"): Promise<ChainScanTopAddress[]> {
    const res = await fetchCustomApi<{ list: ChainScanTopAddress[] }>("/statistics/top/token/receiver", { spanType });
    return res.list;
  },

  async getTopTokenParticipants(spanType: "24h" | "3d" | "7d" = "24h"): Promise<ChainScanTopAddress[]> {
    const res = await fetchCustomApi<{ list: ChainScanTopAddress[] }>("/statistics/top/token/participant", { spanType });
    return res.list;
  },
};
