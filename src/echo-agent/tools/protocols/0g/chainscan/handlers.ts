/**
 * ChainScan (0G Network) protocol handlers — direct TS client calls.
 *
 * All handlers import from @tools/chainscan/client.
 * All read-only — no wallet, no signing, no mutations.
 * Requires CHAINSCAN_API_KEY env var.
 */

import { chainscanClient } from "@tools/chainscan/client.js";
import type { ToolResult } from "../../../types.js";
import type { ProtocolHandler } from "../../types.js";

// ── Helpers ──────────────────────────────────────────────────────

function str(p: Record<string, unknown>, k: string): string {
  const v = p[k]; return typeof v === "string" ? v : "";
}
function num(p: Record<string, unknown>, k: string): number | undefined {
  const v = p[k]; return typeof v === "number" ? v : undefined;
}
function ok(data: unknown): ToolResult {
  return { success: true, output: JSON.stringify(data, null, 2), data: data as Record<string, unknown> };
}
function fail(msg: string): ToolResult {
  return { success: false, output: msg };
}

function paginationOpts(p: Record<string, unknown>) {
  return {
    page: num(p, "page"),
    offset: num(p, "offset"),
    sort: str(p, "sort") as "asc" | "desc" || undefined,
    startblock: num(p, "startblock"),
    endblock: num(p, "endblock"),
  };
}

function statsPaginationOpts(p: Record<string, unknown>) {
  return {
    skip: num(p, "skip"),
    limit: num(p, "limit"),
    sort: str(p, "sort") as "asc" | "desc" || undefined,
    minTimestamp: num(p, "minTimestamp"),
    maxTimestamp: num(p, "maxTimestamp"),
  };
}

function spanType(p: Record<string, unknown>): "24h" | "3d" | "7d" {
  const v = str(p, "spanType");
  if (v === "3d" || v === "7d") return v;
  return "24h";
}

// ── Handler map ──────────────────────────────────────────────────

export const CHAINSCAN_HANDLERS: Record<string, ProtocolHandler> = {
  // ── Account ───────────────────────────────────────────────────

  "chainscan.account.balance": async (p) => {
    const address = str(p, "address");
    if (!address) return fail("Missing required: address");
    const balance = await chainscanClient.getBalance(address, str(p, "tag") || undefined);
    return ok({ address, balance });
  },

  "chainscan.account.balanceMulti": async (p) => {
    const raw = str(p, "addresses");
    if (!raw) return fail("Missing required: addresses");
    const addresses = raw.split(",").map(a => a.trim()).filter(Boolean);
    const balances = await chainscanClient.getBalanceMulti(addresses, str(p, "tag") || undefined);
    return ok({ count: balances.length, balances });
  },

  "chainscan.account.transactions": async (p) => {
    const address = str(p, "address");
    if (!address) return fail("Missing required: address");
    const txs = await chainscanClient.getTransactions(address, paginationOpts(p));
    return ok({ address, count: txs.length, transactions: txs });
  },

  "chainscan.account.tokenTransfers": async (p) => {
    const address = str(p, "address");
    if (!address) return fail("Missing required: address");
    const contractaddress = str(p, "contractaddress") || undefined;
    const transfers = await chainscanClient.getTokenTransfers(address, { ...paginationOpts(p), contractaddress });
    return ok({ address, count: transfers.length, transfers });
  },

  "chainscan.account.nftTransfers": async (p) => {
    const address = str(p, "address");
    if (!address) return fail("Missing required: address");
    const contractaddress = str(p, "contractaddress") || undefined;
    const transfers = await chainscanClient.getNftTransfers(address, { ...paginationOpts(p), contractaddress });
    return ok({ address, count: transfers.length, transfers });
  },

  "chainscan.account.tokenBalance": async (p) => {
    const address = str(p, "address"), contractAddress = str(p, "contractAddress");
    if (!address || !contractAddress) return fail("Missing required: address, contractAddress");
    const balance = await chainscanClient.getTokenBalance(address, contractAddress);
    return ok({ address, contractAddress, balance });
  },

  // ── Transaction ───────────────────────────────────────────────

  "chainscan.tx.status": async (p) => {
    const txHash = str(p, "txHash");
    if (!txHash) return fail("Missing required: txHash");
    const status = await chainscanClient.getTxStatus(txHash);
    return ok({ txHash, ...status });
  },

  "chainscan.tx.receipt": async (p) => {
    const txHash = str(p, "txHash");
    if (!txHash) return fail("Missing required: txHash");
    const receipt = await chainscanClient.getTxReceiptStatus(txHash);
    return ok({ txHash, ...receipt });
  },

  // ── Contract ──────────────────────────────────────────────────

  "chainscan.contract.abi": async (p) => {
    const address = str(p, "address");
    if (!address) return fail("Missing required: address");
    const abi = await chainscanClient.getContractAbi(address);
    return ok({ address, abi });
  },

  "chainscan.contract.source": async (p) => {
    const address = str(p, "address");
    if (!address) return fail("Missing required: address");
    const sources = await chainscanClient.getContractSource(address);
    return ok({ address, count: sources.length, sources });
  },

  "chainscan.contract.creation": async (p) => {
    const raw = str(p, "addresses");
    if (!raw) return fail("Missing required: addresses");
    const addresses = raw.split(",").map(a => a.trim()).filter(Boolean);
    const creations = await chainscanClient.getContractCreation(addresses);
    return ok({ count: creations.length, creations });
  },

  // ── Decode ────────────────────────────────────────────────────

  "chainscan.decode.byHashes": async (p) => {
    const raw = str(p, "hashes");
    if (!raw) return fail("Missing required: hashes");
    const hashes = raw.split(",").map(h => h.trim()).filter(Boolean);
    const decoded = await chainscanClient.decodeByHashes(hashes);
    return ok({ count: decoded.length, decoded });
  },

  "chainscan.decode.raw": async (p) => {
    const contractsRaw = str(p, "contracts"), inputsRaw = str(p, "inputs");
    if (!contractsRaw || !inputsRaw) return fail("Missing required: contracts, inputs");
    const contracts = contractsRaw.split(",").map(c => c.trim()).filter(Boolean);
    const inputs = inputsRaw.split(",").map(i => i.trim()).filter(Boolean);
    const decoded = await chainscanClient.decodeRaw(contracts, inputs);
    return ok({ count: decoded.length, decoded });
  },

  // ── Token ─────────────────────────────────────────────────────

  "chainscan.token.supply": async (p) => {
    const contractAddress = str(p, "contractAddress");
    if (!contractAddress) return fail("Missing required: contractAddress");
    const supply = await chainscanClient.getTokenSupply(contractAddress);
    return ok({ contractAddress, totalSupply: supply });
  },

  // ── Statistics ────────────────────────────────────────────────

  "chainscan.stats.holders": async (p) => {
    const contract = str(p, "contract");
    if (!contract) return fail("Missing required: contract");
    const stats = await chainscanClient.getTokenHolderStats(contract, statsPaginationOpts(p));
    return ok({ contract, count: stats.length, stats });
  },

  "chainscan.stats.transfers": async (p) => {
    const contract = str(p, "contract");
    if (!contract) return fail("Missing required: contract");
    const stats = await chainscanClient.getTokenTransferStats(contract, statsPaginationOpts(p));
    return ok({ contract, count: stats.length, stats });
  },

  "chainscan.stats.participants": async (p) => {
    const contract = str(p, "contract");
    if (!contract) return fail("Missing required: contract");
    const stats = await chainscanClient.getTokenUniqueParticipants(contract, statsPaginationOpts(p));
    return ok({ contract, count: stats.length, stats });
  },

  "chainscan.stats.topSenders": async (p) => {
    const span = spanType(p);
    const top = await chainscanClient.getTopTokenSenders(span);
    return ok({ spanType: span, count: top.length, top });
  },

  "chainscan.stats.topReceivers": async (p) => {
    const span = spanType(p);
    const top = await chainscanClient.getTopTokenReceivers(span);
    return ok({ spanType: span, count: top.length, top });
  },

  "chainscan.stats.topParticipants": async (p) => {
    const span = spanType(p);
    const top = await chainscanClient.getTopTokenParticipants(span);
    return ok({ spanType: span, count: top.length, top });
  },
};
