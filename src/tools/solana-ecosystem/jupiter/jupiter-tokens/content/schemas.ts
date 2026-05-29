/**
 * Zod response schemas for the Jupiter Token Content API (codex-002 Phase 1).
 *
 * Content is display/metadata (token summaries, social feed) — none of it
 * feeds transaction signing — so the schemas mirror the wire interfaces in
 * `types.ts` and `.passthrough()` unknown keys (every wire interface carries a
 * `[key: string]: unknown` index signature, so passthrough keeps shape parity
 * and forward-compat). The interfaces in `types.ts` stay canonical; each
 * client fn's declared return type makes tsc verify assignability.
 */

import { z } from "zod";

const contentUserSchema = z
  .object({
    id: z.string().nullable(),
    username: z.string().nullable(),
    role: z.string().nullable(),
  })
  .passthrough();

const contentSummarySchema = z
  .object({
    summaryFull: z.string().nullable(),
    summaryShort: z.string().nullable(),
    updatedAt: z.string(),
    citations: z.array(z.string()),
  })
  .passthrough();

const contentItemSchema = z
  .object({
    contentId: z.string(),
    content: z.string(),
    contentType: z.enum(["text", "tweet"]),
    status: z.enum(["pending", "approved"]),
    source: z.string().nullable(),
    submittedAt: z.string(),
    submittedBy: contentUserSchema,
    updatedAt: z.string().nullable(),
    updatedBy: contentUserSchema,
    postedAt: z.string().nullable(),
  })
  .passthrough();

const contentByMintSchema = z
  .object({
    mint: z.string(),
    contents: z.array(contentItemSchema),
    tokenSummary: contentSummarySchema.nullable(),
    newsSummary: contentSummarySchema.nullable(),
  })
  .passthrough();

export const jupiterTokenContentMultipleMintsResponseSchema = z
  .object({
    data: z.array(contentByMintSchema),
  })
  .passthrough();

const contentPaginationSchema = z
  .object({
    limit: z.number(),
    total: z.number(),
    page: z.number(),
    totalPages: z.number(),
  })
  .passthrough();

const contentFeedDataSchema = z
  .object({
    contents: z.array(contentItemSchema),
    tokenSummary: contentSummarySchema.nullable(),
    newsSummary: contentSummarySchema.nullable(),
    pagination: contentPaginationSchema,
  })
  .passthrough();

export const jupiterTokenContentFeedResponseSchema = z
  .object({
    data: contentFeedDataSchema,
  })
  .passthrough();

const contentSummariesByMintSchema = z
  .object({
    mint: z.string(),
    tokenSummary: contentSummarySchema.nullable(),
    newsSummary: contentSummarySchema.nullable(),
  })
  .passthrough();

export const jupiterTokenContentSummariesResponseSchema = z
  .object({
    data: z.array(contentSummariesByMintSchema),
  })
  .passthrough();
