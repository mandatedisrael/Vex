/**
 * Shared PRIVATE building blocks for the Jupiter Prediction API response
 * schemas (codex-002). Single-sourced here so the resource modules
 * (events / markets / orders / positions / transactions / …) reuse the exact
 * same base shapes instead of duplicating them.
 *
 * `marketSchema` / `eventSchema` / `orderSchema` / `positionSchema` are each
 * BOTH a private base (referenced by other resources) AND aliased to a
 * `jupiterPrediction*Schema` export from their resource module — the base is
 * defined ONCE here; the resource module re-exports the alias.
 *
 * Every object `.passthrough()`es unknown keys: prediction services forward the
 * raw upstream body downstream, so forward-compatible fields must survive.
 *
 * Zod gates shape only; it cannot prove a transaction is economically safe.
 * Downstream deserialize/sign checks remain authoritative for that.
 */

import { z } from "zod";
import { isBase64 } from "../../../../shared/schemas.js";

// ── Shared building blocks ─────────────────────────────────────────

export const paginationSchema = z
  .object({
    start: z.number(),
    end: z.number(),
    total: z.number(),
    hasNext: z.boolean(),
  })
  .passthrough();

export const eventMetadataSchema = z
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

export const marketMetadataSchema = z
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

export const marketSchema = z
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

export const eventSchema = z
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

export const orderSchema = z
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

export const positionSchema = z
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

// ── Transaction meta & write-response shared pieces (FINANCIAL) ────

const transactionMetaSchema = z
  .object({
    blockhash: z.string(),
    lastValidBlockHeight: z.number(),
  })
  .passthrough();

/** `JupiterPredictionTxMetaFields` shape (txMeta + flat blockhash fields). */
export const txMetaFields = {
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
export const transactionBlobRefine = (t: string | null): boolean =>
  t === null || t === "" || isBase64(t);

export const transactionBlobMessage =
  "transaction must be base64 when present (falsey passes for the domain error path)";
