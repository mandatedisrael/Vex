/**
 * Relay (api.relay.link) response schemas + types.
 *
 * Relay is a KEYLESS cross-chain bridge (no API key). Every response is treated
 * as untrusted and Zod-validated at the client boundary. We validate STRICTLY
 * the fields Vex acts on (a step's tx `to`/`data`/`value`/`chainId`) and stay
 * tolerant (passthrough) on the rest so a benign API addition never breaks us.
 *
 * Shapes confirmed live 2026-07-05 (GET /chains, POST /quote, GET
 * /intents/status/v3).
 */

import { z } from "zod";

const HexAddress = z.string().regex(/^0x[0-9a-fA-F]{40}$/, "expected 0x-address");
const HexData = z.string().regex(/^0x[0-9a-fA-F]*$/, "expected 0x-hex");

// ── GET /chains ──────────────────────────────────────────────────────────────

export const RelayCurrencySchema = z
  .object({
    id: z.string().optional(),
    symbol: z.string().optional(),
    name: z.string().optional(),
    address: z.string().optional(),
    decimals: z.number().optional(),
    supportsBridging: z.boolean().optional(),
  })
  .passthrough();

export const RelayChainSchema = z
  .object({
    id: z.number(),
    name: z.string(),
    displayName: z.string().optional(),
    depositEnabled: z.boolean().optional(),
    disabled: z.boolean().optional(),
    vmType: z.string().optional(),
    currency: RelayCurrencySchema.optional(),
  })
  .passthrough();
export type RelayChain = z.infer<typeof RelayChainSchema>;

export const RelayChainsResponseSchema = z.object({
  chains: z.array(RelayChainSchema),
});

// ── POST /quote ──────────────────────────────────────────────────────────────

/** An EVM transaction a step asks the wallet to broadcast. */
export const RelayStepItemDataSchema = z
  .object({
    from: HexAddress.optional(),
    to: HexAddress,
    value: z.string().default("0"),
    data: HexData.default("0x"),
    chainId: z.number(),
    gas: z.union([z.string(), z.number()]).optional(),
    maxFeePerGas: z.union([z.string(), z.number()]).optional(),
    maxPriorityFeePerGas: z.union([z.string(), z.number()]).optional(),
  })
  .passthrough();
export type RelayStepItemData = z.infer<typeof RelayStepItemDataSchema>;

export const RelayStepItemSchema = z
  .object({
    status: z.string().optional(),
    // `data` is present for kind:"transaction"; absent/other for signature steps.
    data: RelayStepItemDataSchema.optional(),
    check: z
      .object({ endpoint: z.string().optional(), method: z.string().optional() })
      .passthrough()
      .optional(),
  })
  .passthrough();

export const RelayStepSchema = z
  .object({
    id: z.string(),
    action: z.string().optional(),
    description: z.string().optional(),
    kind: z.string(),
    requestId: z.string().optional(),
    items: z.array(RelayStepItemSchema),
  })
  .passthrough();
export type RelayStep = z.infer<typeof RelayStepSchema>;

/**
 * One side of the quote's `details` (`currencyIn` / `currencyOut`) — the
 * currency metadata (symbol/decimals) + human-readable `amountFormatted` the
 * bridge handler records in its trade capture. Tolerant: Relay may omit any
 * of it; the capture falls back to addresses / raw amounts.
 */
export const RelayQuoteDetailsSideSchema = z
  .object({
    currency: RelayCurrencySchema.optional(),
    amount: z.string().optional(),
    amountFormatted: z.string().optional(),
  })
  .passthrough();
export type RelayQuoteDetailsSide = z.infer<typeof RelayQuoteDetailsSideSchema>;

export const RelayQuoteDetailsSchema = z
  .object({
    currencyIn: RelayQuoteDetailsSideSchema.optional(),
    currencyOut: RelayQuoteDetailsSideSchema.optional(),
  })
  .passthrough();

export const RelayQuoteResponseSchema = z
  .object({
    steps: z.array(RelayStepSchema),
    fees: z.record(z.string(), z.unknown()).optional(),
    details: RelayQuoteDetailsSchema.optional(),
  })
  .passthrough();
export type RelayQuoteResponse = z.infer<typeof RelayQuoteResponseSchema>;

// ── GET /intents/status/v3 ───────────────────────────────────────────────────

export const RelayStatusResponseSchema = z
  .object({
    status: z.string(),
    details: z.unknown().optional(),
    txHashes: z.array(z.string()).optional(),
    destinationTxHashes: z.array(z.string()).optional(),
  })
  .passthrough();
export type RelayStatusResponse = z.infer<typeof RelayStatusResponseSchema>;

/** Terminal Relay intent states — polling stops here. */
export const RELAY_TERMINAL_STATUSES = new Set(["success", "failure", "refund"]);

// ── Quote request ────────────────────────────────────────────────────────────

export interface RelayQuoteRequest {
  user: string;
  recipient: string;
  refundTo: string;
  originChainId: number;
  destinationChainId: number;
  originCurrency: string;
  destinationCurrency: string;
  amount: string;
  tradeType: "EXACT_INPUT" | "EXACT_OUTPUT";
  slippageTolerance?: string;
}
