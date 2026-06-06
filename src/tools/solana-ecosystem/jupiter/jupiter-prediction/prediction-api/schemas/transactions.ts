/**
 * Jupiter Prediction write-response schemas (codex-002) — FINANCIAL.
 *
 * The write endpoints (`/orders`, `DELETE /positions(/:id)`,
 * `/positions/:id/claim`) return a `transaction` blob that `service.ts` hands to
 * `signAndSendVersionedTx`, so the blob is validated FIRMLY as standard base64
 * when present.
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
 */

import { z } from "zod";
import { isBase64 } from "../../../../shared/schemas.js";
import {
  transactionBlobMessage,
  transactionBlobRefine,
  txMetaFields,
} from "./_shared.js";

// ── Transaction meta & write responses (FINANCIAL) ─────────────────

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
