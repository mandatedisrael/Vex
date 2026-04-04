/**
 * Shared 0G Compute operations.
 *
 * Thin wrappers around SDK calls used by both CLI commands (`0g-compute.ts`)
 * and the interactive wizard (`0g-compute-wizard.ts`).
 * No CLI output — callers handle UI.
 */

import type { ZGComputeNetworkBroker } from "@0glabs/0g-serving-broker";
import { parseUnits } from "viem";
import { withSuppressedConsole } from "./bridge.js";
import { normalizeSubAccount, normalizeLedger, type NormalizedSubAccount, type NormalizedLedger } from "./account.js";
import { calculateProviderPricing, formatPricePerMTokens, type ProviderPricing } from "./pricing.js";
import { saveComputeState } from "./readiness.js";
import logger from "../../utils/logger.js";

// ── Types ────────────────────────────────────────────────────────────

export interface ServiceDetail {
  provider: string;
  model: string;
  serviceType: string;
  url: string;
  inputPrice: bigint;
  outputPrice: bigint;
  [key: string]: unknown;
}

export interface ServiceMetadata {
  model: string;
  endpoint: string;
  [key: string]: unknown;
}

export interface ApiKeyInfo {
  tokenId: number;
  createdAt: number;
  expiresAt: number;
  rawToken: string;
}

// ── Service discovery ────────────────────────────────────────────────

export async function listChatServices(broker: ZGComputeNetworkBroker): Promise<ServiceDetail[]> {
  const all = await withSuppressedConsole(() =>
    broker.inference.listServiceWithDetail()
  ) as unknown as ServiceDetail[];
  return all.filter(s => s.serviceType === "chatbot");
}

// ── Ledger operations ────────────────────────────────────────────────

export async function depositToLedger(broker: ZGComputeNetworkBroker, amount: string): Promise<void> {
  let ledgerExists = false;
  try {
    await withSuppressedConsole(() => broker.ledger.getLedger());
    ledgerExists = true;
  } catch { /* no ledger */ }

  if (ledgerExists) {
    await withSuppressedConsole(() => broker.ledger.depositFund(Number(amount)));
  } else {
    await withSuppressedConsole(() => broker.ledger.addLedger(Number(amount)));
  }
  logger.debug(`[0G Compute] Deposited ${amount} 0G to ledger`);
}

export async function getLedgerBalance(broker: ZGComputeNetworkBroker): Promise<NormalizedLedger | null> {
  try {
    const ledger = await withSuppressedConsole(() => broker.ledger.getLedger());
    return normalizeLedger(ledger);
  } catch {
    return null;
  }
}

export async function fundProvider(
  broker: ZGComputeNetworkBroker,
  provider: string,
  amount: string,
): Promise<void> {
  const amountWei = parseUnits(amount, 18);
  await withSuppressedConsole(() =>
    broker.ledger.transferFund(provider, "inference", amountWei)
  );
  logger.debug(`[0G Compute] Funded ${amount} 0G to provider ${provider.slice(0, 10)}...`);
}

export async function getSubAccountBalance(
  broker: ZGComputeNetworkBroker,
  provider: string,
): Promise<NormalizedSubAccount | null> {
  try {
    const account = await withSuppressedConsole(() =>
      broker.inference.getAccount(provider)
    );
    return normalizeSubAccount(account);
  } catch {
    return null;
  }
}

export async function hasLedger(broker: ZGComputeNetworkBroker): Promise<boolean> {
  try {
    await withSuppressedConsole(() => broker.ledger.getLedger());
    return true;
  } catch {
    return false;
  }
}

// ── Provider operations ──────────────────────────────────────────────

export async function ackProviderSigner(
  broker: ZGComputeNetworkBroker,
  provider: string,
): Promise<void> {
  await withSuppressedConsole(() =>
    broker.inference.acknowledgeProviderSigner(provider)
  );
  logger.debug(`[0G Compute] Acknowledged provider signer: ${provider.slice(0, 10)}...`);
}

export async function isProviderAcked(
  broker: ZGComputeNetworkBroker,
  provider: string,
): Promise<boolean> {
  return withSuppressedConsole(() => broker.inference.acknowledged(provider));
}

export async function getServiceMetadata(
  broker: ZGComputeNetworkBroker,
  provider: string,
): Promise<ServiceMetadata> {
  return await withSuppressedConsole(() =>
    broker.inference.getServiceMetadata(provider)
  ) as ServiceMetadata;
}

// ── API key operations ───────────────────────────────────────────────

export async function createApiKey(
  broker: ZGComputeNetworkBroker,
  provider: string,
  tokenId = 0,
): Promise<ApiKeyInfo> {
  return await withSuppressedConsole(() =>
    broker.inference.requestProcessor.createApiKey(provider, {
      tokenId,
      expiresIn: 0,
    })
  ) as ApiKeyInfo;
}

// ── ACK with readback ────────────────────────────────────────────────

export async function ackWithReadback(
  broker: ZGComputeNetworkBroker,
  provider: string,
  timeoutMs = 120_000,
  pollMs = 5_000,
): Promise<boolean> {
  try {
    await ackProviderSigner(broker, provider);
  } catch {
    // May already be acknowledged
  }

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const confirmed = await isProviderAcked(broker, provider);
      if (confirmed) return true;
    } catch {
      // Retry
    }
    await new Promise(r => setTimeout(r, pollMs));
  }

  return false;
}
