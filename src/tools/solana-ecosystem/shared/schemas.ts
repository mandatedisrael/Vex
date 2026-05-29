/**
 * Shared Zod primitives for Solana-ecosystem (Jupiter) HTTP response schemas
 * (codex-002). Centralised so every client validates wire shapes the SAME way
 * instead of copying regex variants.
 *
 * These gate SHAPE at the HTTP boundary before values feed transaction
 * signing; they do not prove economic safety — downstream deserialize/sign
 * checks remain authoritative.
 */

import { z } from "zod";
import type {
  SolanaInstructionAccountMeta,
  SolanaInstructionWire,
} from "./types.js";

/** A non-empty string (mirrors the hand-written `asString` semantics). */
export const nonEmptyString = z.string().min(1);

/**
 * Standard base64 (NOT base64url). Length must be a multiple of 4 (with
 * padding), so impossible encodings like "A" are rejected. Jupiter tx blobs +
 * instruction `data` use standard base64.
 */
export const isBase64 = (s: string): boolean =>
  /^[A-Za-z0-9+/]+={0,2}$/.test(s) && s.length % 4 === 0;

export const base64String = z
  .string()
  .min(1)
  .refine(isBase64, "expected standard base64");

/** Solana base58 public key (32–44 chars). */
export const solanaPubkey = z
  .string()
  .regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/, "expected base58 Solana pubkey");

/** `SolanaInstructionAccountMeta` wire shape. */
export const solanaInstructionAccountSchema: z.ZodType<SolanaInstructionAccountMeta> =
  z
    .object({
      pubkey: solanaPubkey,
      isWritable: z.boolean(),
      isSigner: z.boolean(),
    })
    .passthrough();

/** `SolanaInstructionWire` shape (programId + accounts + base64 data). */
export const solanaInstructionWireSchema: z.ZodType<SolanaInstructionWire> = z
  .object({
    programId: solanaPubkey,
    accounts: z.array(solanaInstructionAccountSchema),
    data: base64String,
  })
  .passthrough();
