/**
 * Zod response schemas for the Jupiter Prediction API (codex-002).
 *
 * These gate the SHAPE of prediction responses at the HTTP boundary before any
 * value feeds transaction signing. The write endpoints (`/orders`,
 * `DELETE /positions(/:id)`, `/positions/:id/claim`) return a `transaction`
 * blob that `service.ts` hands to `signAndSendVersionedTx`, so the blob is
 * validated FIRMLY as standard base64 when present.
 *
 * ERROR-PATH PRESERVATION: the service treats a FALSEY transaction value
 * (`null` or `""`) as a DOMAIN error (`requireTransaction` → HTTP_REQUEST_FAILED,
 * service.ts:79-90, used at :101). The prediction wire carries no `errorCode`/
 * `errorMessage` companion field, so the schema must accept a falsey transaction
 * value UNCONDITIONALLY — it must NOT pre-empt that domain mapping with
 * HTTP_RESPONSE_INVALID. The `transaction` KEY is still required (it is present
 * in every wire response, never absent); only its VALUE may be `""`/`null`.
 * Hence the refine allows `""`/`null` and enforces base64 only for a non-empty
 * string.
 *
 * Every object `.passthrough()`es unknown keys: prediction services forward the
 * raw upstream body downstream, so forward-compatible fields must survive.
 *
 * Schemas are NOT the type source of truth — the wire interfaces in `types/`
 * stay canonical. Each client function keeps its declared return type, so `tsc`
 * verifies `z.infer<schema>` is assignable to the interface.
 *
 * Zod gates shape only; it cannot prove a transaction is economically safe.
 * Downstream deserialize/sign checks remain authoritative for that.
 */

import { z } from "zod";
import { base64String, isBase64 } from "../../../shared/schemas.js";

// ── Shared building blocks ─────────────────────────────────────────

const paginationSchema = z
  .object({
    start: z.number(),
    end: z.number(),
    total: z.number(),
    hasNext: z.boolean(),
  })
  .passthrough();

const eventMetadataSchema = z
  .object({
    eventId: z.string(),
    title: z.string().optional(),
    subtitle: z.string().optional(),
    slug: z.string().optional(),
    series: z.string().optional(),
    closeTime: z.string().optional(),
    imageUrl: z.string().optional(),
    isLive: z.boolean().optional(),
  })
  .passthrough();

const marketMetadataSchema = z
  .object({
    marketId: z.string(),
    eventId: z.string().optional(),
    title: z.string().optional(),
    subtitle: z.string().optional(),
    description: z.string().optional(),
    status: z.string().optional(),
    result: z.string().optional(),
    closeTime: z.number().optional(),
    openTime: z.number().optional(),
    isTeamMarket: z.boolean().optional(),
    rulesPrimary: z.string().optional(),
    rulesSecondary: z.string().optional(),
  })
  .passthrough();

const marketPricingSchema = z
  .object({
    buyYesPriceUsd: z.number().nullable().optional(),
    buyNoPriceUsd: z.number().nullable().optional(),
    sellYesPriceUsd: z.number().nullable().optional(),
    sellNoPriceUsd: z.number().nullable().optional(),
    volume: z.number().optional(),
  })
  .passthrough();

const marketSchema = z
  .object({
    marketId: z.string(),
    status: z.string(),
    result: z.string().nullable(),
    openTime: z.number(),
    closeTime: z.number(),
    resolveAt: z.number().nullable(),
    marketResultPubkey: z.string().nullable().optional(),
    imageUrl: z.string().nullable().optional(),
    metadata: marketMetadataSchema.optional(),
    pricing: marketPricingSchema.optional(),
  })
  .passthrough();

const eventSchema = z
  .object({
    eventId: z.string(),
    isActive: z.boolean(),
    isLive: z.boolean(),
    category: z.string(),
    subcategory: z.string(),
    tags: z.array(z.string()).optional(),
    metadata: eventMetadataSchema.optional(),
    markets: z.array(marketSchema).optional(),
    volumeUsd: z.string(),
    closeCondition: z.string(),
    beginAt: z.string().nullable(),
    rulesPdf: z.string(),
  })
  .passthrough();

// ── Events ─────────────────────────────────────────────────────────

export const jupiterPredictionEventSchema = eventSchema;

export const jupiterPredictionEventsResponseSchema = z
  .object({
    data: z.array(eventSchema),
    pagination: paginationSchema,
  })
  .passthrough();

export const jupiterPredictionSearchEventsResponseSchema = z
  .object({ data: z.array(eventSchema) })
  .passthrough();

export const jupiterPredictionSuggestedEventsResponseSchema = z
  .object({ data: z.array(eventSchema) })
  .passthrough();

// ── Markets ────────────────────────────────────────────────────────

export const jupiterPredictionMarketResponseSchema = marketSchema;

export const jupiterPredictionEventMarketsResponseSchema = z
  .object({
    data: z.array(marketSchema),
    pagination: paginationSchema,
  })
  .passthrough();

// ── Orderbook / Trading status ─────────────────────────────────────

const orderbookLevelSchema = z.tuple([z.number(), z.number()]);
const orderbookDollarLevelSchema = z.tuple([z.string(), z.number()]);

export const jupiterPredictionOrderbookResponseSchema = z
  .object({
    yes: z.array(orderbookLevelSchema),
    no: z.array(orderbookLevelSchema),
    yes_dollars: z.array(orderbookDollarLevelSchema),
    no_dollars: z.array(orderbookDollarLevelSchema),
  })
  .passthrough()
  .nullable();

export const jupiterPredictionTradingStatusResponseSchema = z
  .object({ trading_active: z.boolean() })
  .passthrough();

// ── Orders ─────────────────────────────────────────────────────────

const orderSchema = z
  .object({
    pubkey: z.string(),
    owner: z.string(),
    ownerPubkey: z.string(),
    market: z.string(),
    marketId: z.string(),
    marketIdHash: z.string(),
    eventId: z.string(),
    position: z.string(),
    status: z.string(),
    isYes: z.boolean(),
    isBuy: z.boolean(),
    createdAt: z.number(),
    updatedAt: z.number(),
    contracts: z.string(),
    maxFillPriceUsd: z.string(),
    maxBuyPriceUsd: z.string().nullable(),
    minSellPriceUsd: z.string().nullable(),
    filledAt: z.number(),
    filledContracts: z.string(),
    avgFillPriceUsd: z.string(),
    settled: z.boolean(),
    orderId: z.string(),
    sizeUsd: z.string(),
    eventMetadata: eventMetadataSchema,
    marketMetadata: marketMetadataSchema,
    externalOrderId: z.string(),
    bump: z.number(),
  })
  .passthrough();

export const jupiterPredictionOrderResponseSchema = orderSchema;

export const jupiterPredictionOrdersResponseSchema = z
  .object({
    data: z.array(orderSchema),
    pagination: paginationSchema,
  })
  .passthrough();

const orderStatusHistoryItemSchema = z
  .object({
    eventType: z.string(),
    status: z.string(),
    rawStatus: z.string(),
    timestamp: z.number(),
    signature: z.string(),
    externalOrderId: z.string(),
    orderId: z.string(),
  })
  .passthrough();

export const jupiterPredictionOrderStatusResponseSchema = z
  .object({
    orderPubkey: z.string(),
    status: z.string(),
    latestEventType: z.string(),
    latestSignature: z.string(),
    externalOrderId: z.string(),
    orderId: z.string(),
    history: z.array(orderStatusHistoryItemSchema),
  })
  .passthrough();

// ── Positions ──────────────────────────────────────────────────────

const positionSchema = z
  .object({
    pubkey: z.string(),
    owner: z.string(),
    ownerPubkey: z.string(),
    market: z.string(),
    marketId: z.string(),
    marketIdHash: z.string(),
    isYes: z.boolean(),
    contracts: z.string(),
    totalCostUsd: z.string(),
    sizeUsd: z.string(),
    valueUsd: z.string().nullable(),
    avgPriceUsd: z.string(),
    markPriceUsd: z.string().nullable(),
    sellPriceUsd: z.string().nullable(),
    pnlUsd: z.string().nullable(),
    pnlUsdPercent: z.number().nullable(),
    pnlUsdAfterFees: z.string().nullable(),
    pnlUsdAfterFeesPercent: z.number().nullable(),
    openOrders: z.number(),
    feesPaidUsd: z.string(),
    realizedPnlUsd: z.number(),
    claimed: z.boolean(),
    claimedUsd: z.string(),
    openedAt: z.number(),
    updatedAt: z.number(),
    claimableAt: z.number().nullable(),
    payoutUsd: z.string(),
    bump: z.number(),
    eventId: z.string(),
    eventMetadata: eventMetadataSchema,
    marketMetadata: marketMetadataSchema,
    settlementDate: z.number().nullable(),
    claimable: z.boolean(),
  })
  .passthrough();

export const jupiterPredictionPositionResponseSchema = positionSchema;

export const jupiterPredictionPositionsResponseSchema = z
  .object({
    data: z.array(positionSchema),
    pagination: paginationSchema,
  })
  .passthrough();

// ── History ────────────────────────────────────────────────────────

const historyEventSchema = z
  .object({
    id: z.number(),
    eventType: z.string(),
    signature: z.string(),
    slot: z.string(),
    timestamp: z.number(),
    orderPubkey: z.string(),
    positionPubkey: z.string(),
    marketId: z.string(),
    ownerPubkey: z.string(),
    keeperPubkey: z.string(),
    externalOrderId: z.string(),
    orderId: z.string(),
    isBuy: z.boolean(),
    isYes: z.boolean(),
    contracts: z.string(),
    filledContracts: z.string(),
    contractsSettled: z.string(),
    maxFillPriceUsd: z.string(),
    avgFillPriceUsd: z.string(),
    maxBuyPriceUsd: z.string().nullable(),
    minSellPriceUsd: z.string().nullable(),
    depositAmountUsd: z.string(),
    totalCostUsd: z.string(),
    feeUsd: z.string().nullable(),
    grossProceedsUsd: z.string(),
    netProceedsUsd: z.string(),
    transferAmountToken: z.string().nullable(),
    realizedPnl: z.string().nullable(),
    realizedPnlBeforeFees: z.string().nullable(),
    payoutAmountUsd: z.string(),
    eventId: z.string(),
    marketMetadata: marketMetadataSchema,
    eventMetadata: eventMetadataSchema,
  })
  .passthrough();

export const jupiterPredictionHistoryResponseSchema = z
  .object({
    data: z.array(historyEventSchema),
    pagination: paginationSchema,
  })
  .passthrough();

// ── Profile / PnL ──────────────────────────────────────────────────

export const jupiterPredictionProfileResponseSchema = z
  .object({
    ownerPubkey: z.string(),
    realizedPnlUsd: z.string(),
    totalVolumeUsd: z.string(),
    predictionsCount: z.string(),
    correctPredictions: z.string(),
    wrongPredictions: z.string(),
    totalActiveContracts: z.string(),
    totalPositionsValueUsd: z.string(),
  })
  .passthrough();

const pnlHistoryPointSchema = z
  .object({
    timestamp: z.number(),
    realizedPnlUsd: z.string(),
  })
  .passthrough();

export const jupiterPredictionPnlHistoryResponseSchema = z
  .object({
    ownerPubkey: z.string(),
    history: z.array(pnlHistoryPointSchema),
  })
  .passthrough();

// ── Trades ─────────────────────────────────────────────────────────

const tradeSchema = z
  .object({
    id: z.number(),
    ownerPubkey: z.string(),
    marketId: z.string(),
    message: z.string(),
    timestamp: z.number(),
    action: z.string(),
    side: z.string(),
    eventTitle: z.string(),
    marketTitle: z.string(),
    amountUsd: z.string(),
    priceUsd: z.string(),
    eventImageUrl: z.string(),
    eventId: z.string(),
  })
  .passthrough();

export const jupiterPredictionTradesResponseSchema = z
  .object({ data: z.array(tradeSchema) })
  .passthrough();

// ── Leaderboards ───────────────────────────────────────────────────

const leaderboardSummaryPeriodSchema = z
  .object({
    totalVolumeUsd: z.string(),
    predictionsCount: z.number(),
  })
  .passthrough();

const leaderboardEntrySchema = z
  .object({
    ownerPubkey: z.string(),
    realizedPnlUsd: z.string(),
    totalVolumeUsd: z.string(),
    predictionsCount: z.number(),
    correctPredictions: z.number(),
    wrongPredictions: z.number(),
    winRatePct: z.string(),
    period: z.string(),
    periodStart: z.string().nullable(),
    periodEnd: z.string().nullable(),
  })
  .passthrough();

export const jupiterPredictionLeaderboardsResponseSchema = z
  .object({
    data: z.array(leaderboardEntrySchema),
    summary: z
      .object({
        all_time: leaderboardSummaryPeriodSchema,
        weekly: leaderboardSummaryPeriodSchema,
        monthly: leaderboardSummaryPeriodSchema,
      })
      .passthrough(),
  })
  .passthrough();

// ── Vault ──────────────────────────────────────────────────────────

export const jupiterPredictionVaultInfoResponseSchema = z
  .object({
    pubkey: z.string(),
    data: z.record(z.string(), z.string()),
    vaultBalance: z.string(),
  })
  .passthrough();

// ── Transaction meta & write responses (FINANCIAL) ─────────────────

const transactionMetaSchema = z
  .object({
    blockhash: z.string(),
    lastValidBlockHeight: z.number(),
  })
  .passthrough();

/** `JupiterPredictionTxMetaFields` shape (txMeta + flat blockhash fields). */
const txMetaFields = {
  txMeta: transactionMetaSchema.nullable().optional(),
  blockhash: z.string().optional(),
  lastValidBlockHeight: z.number().optional(),
} as const;

/**
 * A signing-bound transaction blob. Standard base64 when present, but a FALSEY
 * value (null / "") must pass: the service maps it to a domain
 * HTTP_REQUEST_FAILED ("did not return an executable transaction",
 * service.ts:79-90). Rejecting it here would shadow that domain error with
 * HTTP_RESPONSE_INVALID, hiding the real cause from callers. Unlike the swaps
 * template, the prediction wire has no `errorCode` companion, so "" is allowed
 * unconditionally rather than only-alongside-an-error-field.
 */
const transactionBlobRefine = (t: string | null): boolean =>
  t === null || t === "" || isBase64(t);

const transactionBlobMessage =
  "transaction must be base64 when present (falsey passes for the domain error path)";

const createOrderDetailsSchema = z
  .object({
    orderPubkey: z.string().nullable(),
    orderAtaPubkey: z.string().nullable(),
    userPubkey: z.string(),
    marketId: z.string(),
    marketIdHash: z.string(),
    positionPubkey: z.string(),
    isBuy: z.boolean(),
    isYes: z.boolean(),
    contracts: z.string(),
    newContracts: z.string(),
    maxBuyPriceUsd: z.string().nullable(),
    minSellPriceUsd: z.string().nullable(),
    externalOrderId: z.string().nullable(),
    orderCostUsd: z.string(),
    newAvgPriceUsd: z.string(),
    newSizeUsd: z.string(),
    newPayoutUsd: z.string(),
    estimatedProtocolFeeUsd: z.string(),
    estimatedVenueFeeUsd: z.string(),
    estimatedTotalFeeUsd: z.string(),
  })
  .passthrough();

export const jupiterPredictionCreateOrderResponseSchema = z
  .object({
    ...txMetaFields,
    // base64 | null normally; "" / null pass for the falsey-tx domain error.
    transaction: z
      .string()
      .nullable()
      .refine(transactionBlobRefine, { message: transactionBlobMessage }),
    externalOrderId: z.string().nullable(),
    order: createOrderDetailsSchema,
  })
  .passthrough();

const claimPositionDetailsSchema = z
  .object({
    positionPubkey: z.string(),
    marketPubkey: z.string(),
    userPubkey: z.string(),
    ownerPubkey: z.string(),
    isYes: z.boolean(),
    contracts: z.string(),
    payoutAmountUsd: z.string(),
  })
  .passthrough();

export const jupiterPredictionClaimPositionResponseSchema = z
  .object({
    ...txMetaFields,
    // The wire type is `string` (not nullable) but the service still treats ""
    // as the falsey-tx domain error, so "" must pass; non-empty must be base64.
    transaction: z
      .string()
      .refine((t) => t === "" || isBase64(t), { message: transactionBlobMessage }),
    position: claimPositionDetailsSchema,
  })
  .passthrough();

/**
 * `DELETE /positions` close-all — an array whose items are EITHER a create-order
 * response (`order` field) or a claim response (`position` field). Each item's
 * transaction is executed by the service, so the financial blob is firm per
 * branch; the union mirrors `JupiterPredictionCloseAllPositionsItem`.
 */
export const jupiterPredictionCloseAllPositionsResponseSchema = z
  .object({
    data: z.array(
      z.union([
        jupiterPredictionCreateOrderResponseSchema,
        jupiterPredictionClaimPositionResponseSchema,
      ]),
    ),
  })
  .passthrough();
