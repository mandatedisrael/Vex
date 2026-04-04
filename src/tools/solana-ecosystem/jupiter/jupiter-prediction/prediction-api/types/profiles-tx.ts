/**
 * Jupiter Prediction API — profile, PnL, leaderboards, trades, vault,
 * transaction meta, and execution result types.
 */

import type { TransferResult } from "../../../../shared/types.js";

// ── Profile ────────────────────────────────────────────────────────

export interface JupiterPredictionProfileResponse {
  ownerPubkey: string;
  realizedPnlUsd: string;
  totalVolumeUsd: string;
  predictionsCount: string;
  correctPredictions: string;
  wrongPredictions: string;
  totalActiveContracts: string;
  totalPositionsValueUsd: string;
}

export interface JupiterPredictionPnlHistoryPoint {
  timestamp: number;
  realizedPnlUsd: string;
}

export interface JupiterPredictionPnlHistoryResponse {
  ownerPubkey: string;
  history: JupiterPredictionPnlHistoryPoint[];
}

// ── Trades ─────────────────────────────────────────────────────────

export interface JupiterPredictionTrade {
  id: number;
  ownerPubkey: string;
  marketId: string;
  message: string;
  timestamp: number;
  action: "buy" | "sell" | (string & {});
  side: "yes" | "no" | (string & {});
  eventTitle: string;
  marketTitle: string;
  amountUsd: string;
  priceUsd: string;
  eventImageUrl: string;
  eventId: string;
}

export interface JupiterPredictionTradesResponse {
  data: JupiterPredictionTrade[];
}

// ── Leaderboards ───────────────────────────────────────────────────

export interface JupiterPredictionLeaderboardSummaryPeriod {
  totalVolumeUsd: string;
  predictionsCount: number;
}

export interface JupiterPredictionLeaderboardEntry {
  ownerPubkey: string;
  realizedPnlUsd: string;
  totalVolumeUsd: string;
  predictionsCount: number;
  correctPredictions: number;
  wrongPredictions: number;
  winRatePct: string;
  period: string;
  periodStart: string | null;
  periodEnd: string | null;
}

export interface JupiterPredictionLeaderboardsResponse {
  data: JupiterPredictionLeaderboardEntry[];
  summary: {
    all_time: JupiterPredictionLeaderboardSummaryPeriod;
    weekly: JupiterPredictionLeaderboardSummaryPeriod;
    monthly: JupiterPredictionLeaderboardSummaryPeriod;
  };
}

// ── Vault ──────────────────────────────────────────────────────────

export interface JupiterPredictionVaultInfoResponse {
  pubkey: string;
  data: Record<string, string>;
  vaultBalance: string;
}

// ── Transaction meta & execution ───────────────────────────────────

export interface JupiterPredictionTransactionMeta {
  blockhash: string;
  lastValidBlockHeight: number;
}

export interface JupiterPredictionTxMetaFields {
  txMeta?: JupiterPredictionTransactionMeta | null;
  blockhash?: string;
  lastValidBlockHeight?: number;
}

export interface JupiterPredictionCreateOrderDetails {
  orderPubkey: string | null;
  orderAtaPubkey: string | null;
  userPubkey: string;
  marketId: string;
  marketIdHash: string;
  positionPubkey: string;
  isBuy: boolean;
  isYes: boolean;
  contracts: string;
  newContracts: string;
  maxBuyPriceUsd: string | null;
  minSellPriceUsd: string | null;
  externalOrderId: string | null;
  orderCostUsd: string;
  newAvgPriceUsd: string;
  newSizeUsd: string;
  newPayoutUsd: string;
  estimatedProtocolFeeUsd: string;
  estimatedVenueFeeUsd: string;
  estimatedTotalFeeUsd: string;
}

export interface JupiterPredictionCreateOrderResponse extends JupiterPredictionTxMetaFields {
  transaction: string | null;
  externalOrderId: string | null;
  order: JupiterPredictionCreateOrderDetails;
}

export interface JupiterPredictionClaimPositionDetails {
  positionPubkey: string;
  marketPubkey: string;
  userPubkey: string;
  ownerPubkey: string;
  isYes: boolean;
  contracts: string;
  payoutAmountUsd: string;
}

export interface JupiterPredictionClaimPositionResponse extends JupiterPredictionTxMetaFields {
  transaction: string;
  position: JupiterPredictionClaimPositionDetails;
}

export type JupiterPredictionCloseAllPositionsItem =
  | JupiterPredictionCreateOrderResponse
  | JupiterPredictionClaimPositionResponse;

export interface JupiterPredictionCloseAllPositionsResponse {
  data: JupiterPredictionCloseAllPositionsItem[];
}

export interface JupiterPredictionExecutionResult<T> extends TransferResult {
  signer: string;
  raw: T;
}

export interface JupiterPredictionCloseAllExecutionItem
  extends JupiterPredictionExecutionResult<JupiterPredictionCloseAllPositionsItem> {
  kind: "order" | "claim";
}

export interface JupiterPredictionCloseAllExecutionResult {
  signer: string;
  results: JupiterPredictionCloseAllExecutionItem[];
  raw: JupiterPredictionCloseAllPositionsResponse;
}
