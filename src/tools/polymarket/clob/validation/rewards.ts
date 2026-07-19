/**
 * Rewards / rebates / simplified-markets CLOB validators.
 *
 * These nine endpoints (`getSimplifiedMarkets`, `getRebates`,
 * `getActiveRewards`, `getMarketRewards`, `getMultiMarketRewards`,
 * `getUserEarnings`, `getUserTotalEarnings`, `getUserRewardPercentages`,
 * `getUserEarningsMarkets` in `../client.ts`) used a `(raw) => raw` identity
 * parser: the provider response reached `handlers-rewards.ts` (`ok(data)` →
 * `ToolResult`, shown to the user/LLM near-verbatim) completely unvalidated.
 *
 * Unlike the LENIENT-DEFAULTING order/trade/price validators in this
 * directory (a malformed field never fails the whole response), these are
 * pure informational reporting data — reward/rebate/earnings figures and
 * market metadata — where silently defaulting a garbled number to `0` would
 * misrepresent a real value to the user. So each schema is STRICT: a
 * missing/wrong-typed required field, or a pagination/nested array beyond its
 * bound, rejects the WHOLE response with a plain `Error`, matching the
 * "Expected X" convention used across `../validation.ts`. Unknown keys are
 * ACCEPTED but STRIPPED (zod's default): these parsed responses are serialized
 * near-verbatim into tool output / the LLM transcript, so unmodeled provider
 * content must never ride along unbounded. A new provider field the client
 * wants to surface gets modeled here first — forward-tolerant, never
 * forward-leaking.
 *
 * Bounds: `MAX_PAGE_ITEMS` mirrors the Polymarket API's own documented
 * page-size ceiling (500) for pagination arrays. `MAX_NESTED_ITEMS` bounds the
 * per-entry collections (tokens / reward configs / rates / per-asset
 * earnings) generously above any realistic market shape — exceeding it is
 * rejected the same way, since a single entry can only carry a handful of
 * tokens or reward-config rows in practice.
 */

import { z } from "zod";
import type {
  SimplifiedMarket, PaginatedSimplifiedMarkets,
  RebateEntry,
  RewardsConfigItem, CurrentReward, PaginatedCurrentRewards,
  RewardsToken, MarketReward, PaginatedMarketRewards,
  MultiMarketInfo, PaginatedMultiMarketInfo,
  UserEarning, PaginatedUserEarnings,
  UserTotalEarningEntry, UserRewardPercentages,
  AssetEarning, UserRewardsMarket, PaginatedUserRewardsMarkets,
} from "../types.js";

// ── Bounds ────────────────────────────────────────────────────────────

const MAX_PAGE_ITEMS = 500; // matches the API's own documented max page_size/limit
const MAX_NESTED_ITEMS = 100; // tokens / rewards_config / rates / per-asset earnings per entry
const MAX_ID_LEN = 100; // condition_id / token_id / asset+maker address / event+market id
const MAX_SLUG_LEN = 300; // slugs, dates, outcome labels, cursors
const MAX_TEXT_LEN = 2000; // question / group_item_title free text
const MAX_URL_LEN = 2000; // image URLs

const idString = z.string().max(MAX_ID_LEN);
const slugString = z.string().max(MAX_SLUG_LEN);
const textString = z.string().max(MAX_TEXT_LEN);
const urlString = z.string().max(MAX_URL_LEN);

// ── Shared nested shapes ────────────────────────────────────────────────

const rewardsTokenSchema: z.ZodType<RewardsToken> = z.object({
  token_id: idString,
  outcome: slugString,
  price: z.number(),
});

const rewardsConfigItemSchema: z.ZodType<RewardsConfigItem> = z.object({
  id: z.number(),
  asset_address: idString,
  start_date: slugString,
  end_date: slugString,
  rate_per_day: z.number(),
  total_rewards: z.number(),
  remaining_reward_amount: z.number().optional(),
  total_days: z.number().optional(),
});

// ── Simplified markets ──────────────────────────────────────────────────

const simplifiedMarketSchema: z.ZodType<SimplifiedMarket> = z.object({
  condition_id: idString,
  rewards: z.object({
    rates: z.array(z.object({
      asset_address: idString,
      rewards_daily_rate: z.number(),
    })).max(MAX_NESTED_ITEMS),
    min_size: z.number(),
    max_spread: z.number(),
  }),
  tokens: z.array(z.object({
    token_id: idString,
    outcome: slugString,
    price: z.number(),
    winner: z.boolean(),
  })).max(MAX_NESTED_ITEMS),
  active: z.boolean(),
  closed: z.boolean(),
  archived: z.boolean(),
  accepting_orders: z.boolean(),
});

const paginatedSimplifiedMarketsSchema: z.ZodType<PaginatedSimplifiedMarkets> = z.object({
  limit: z.number(),
  next_cursor: slugString,
  count: z.number(),
  data: z.array(simplifiedMarketSchema).max(MAX_PAGE_ITEMS),
});

export function validateSimplifiedMarketsResponse(raw: unknown): PaginatedSimplifiedMarkets {
  const parsed = paginatedSimplifiedMarketsSchema.safeParse(raw);
  if (!parsed.success) throw new Error("Expected simplified markets response");
  return parsed.data;
}

// ── Rebates ─────────────────────────────────────────────────────────────

const rebateEntrySchema: z.ZodType<RebateEntry> = z.object({
  date: slugString,
  condition_id: idString,
  asset_address: idString,
  maker_address: idString,
  rebated_fees_usdc: slugString,
});

const rebatesResponseSchema = z.array(rebateEntrySchema).max(MAX_PAGE_ITEMS);

export function validateRebatesResponse(raw: unknown): RebateEntry[] {
  const parsed = rebatesResponseSchema.safeParse(raw);
  if (!parsed.success) throw new Error("Expected rebates array");
  return parsed.data;
}

// ── Rewards (public) ────────────────────────────────────────────────────

const currentRewardSchema: z.ZodType<CurrentReward> = z.object({
  condition_id: idString,
  rewards_max_spread: z.number(),
  rewards_min_size: z.number(),
  rewards_config: z.array(rewardsConfigItemSchema).max(MAX_NESTED_ITEMS),
  sponsored_daily_rate: z.number().optional(),
  sponsors_count: z.number().optional(),
  native_daily_rate: z.number().optional(),
  total_daily_rate: z.number().optional(),
});

const paginatedCurrentRewardsSchema: z.ZodType<PaginatedCurrentRewards> = z.object({
  limit: z.number(),
  count: z.number(),
  next_cursor: slugString,
  data: z.array(currentRewardSchema).max(MAX_PAGE_ITEMS),
});

export function validateCurrentRewardsResponse(raw: unknown): PaginatedCurrentRewards {
  const parsed = paginatedCurrentRewardsSchema.safeParse(raw);
  if (!parsed.success) throw new Error("Expected current rewards response");
  return parsed.data;
}

const marketRewardSchema: z.ZodType<MarketReward> = z.object({
  condition_id: idString,
  question: textString,
  market_slug: slugString,
  event_slug: slugString,
  image: urlString,
  rewards_max_spread: z.number(),
  rewards_min_size: z.number(),
  market_competitiveness: z.number(),
  tokens: z.array(rewardsTokenSchema).max(MAX_NESTED_ITEMS),
  rewards_config: z.array(rewardsConfigItemSchema).max(MAX_NESTED_ITEMS),
});

const paginatedMarketRewardsSchema: z.ZodType<PaginatedMarketRewards> = z.object({
  limit: z.number(),
  count: z.number(),
  next_cursor: slugString,
  data: z.array(marketRewardSchema).max(MAX_PAGE_ITEMS),
});

export function validateMarketRewardsResponse(raw: unknown): PaginatedMarketRewards {
  const parsed = paginatedMarketRewardsSchema.safeParse(raw);
  if (!parsed.success) throw new Error("Expected market rewards response");
  return parsed.data;
}

const multiMarketInfoSchema: z.ZodType<MultiMarketInfo> = z.object({
  condition_id: idString,
  event_id: idString,
  event_slug: slugString,
  created_at: slugString,
  group_item_title: textString,
  image: urlString,
  market_competitiveness: z.number(),
  market_id: idString,
  market_slug: slugString,
  one_day_price_change: z.number(),
  question: textString,
  rewards_max_spread: z.number(),
  rewards_min_size: z.number(),
  spread: z.number(),
  end_date: slugString,
  tokens: z.array(rewardsTokenSchema).max(MAX_NESTED_ITEMS),
  volume_24hr: z.number(),
  rewards_config: z.array(rewardsConfigItemSchema).max(MAX_NESTED_ITEMS),
});

const paginatedMultiMarketInfoSchema: z.ZodType<PaginatedMultiMarketInfo> = z.object({
  limit: z.number(),
  count: z.number(),
  next_cursor: slugString,
  data: z.array(multiMarketInfoSchema).max(MAX_PAGE_ITEMS),
});

export function validateMultiMarketRewardsResponse(raw: unknown): PaginatedMultiMarketInfo {
  const parsed = paginatedMultiMarketInfoSchema.safeParse(raw);
  if (!parsed.success) throw new Error("Expected multi-market rewards response");
  return parsed.data;
}

// ── Rewards (authenticated) ─────────────────────────────────────────────

const userEarningSchema: z.ZodType<UserEarning> = z.object({
  date: slugString,
  condition_id: idString,
  asset_address: idString,
  maker_address: idString,
  earnings: z.number(),
  asset_rate: z.number(),
});

const paginatedUserEarningsSchema: z.ZodType<PaginatedUserEarnings> = z.object({
  limit: z.number(),
  count: z.number(),
  next_cursor: slugString,
  data: z.array(userEarningSchema).max(MAX_PAGE_ITEMS),
});

export function validateUserEarningsResponse(raw: unknown): PaginatedUserEarnings {
  const parsed = paginatedUserEarningsSchema.safeParse(raw);
  if (!parsed.success) throw new Error("Expected user earnings response");
  return parsed.data;
}

const userTotalEarningEntrySchema: z.ZodType<UserTotalEarningEntry> = z.object({
  date: slugString,
  asset_address: idString,
  maker_address: idString,
  earnings: z.number(),
  asset_rate: z.number(),
});

const userTotalEarningsResponseSchema = z.array(userTotalEarningEntrySchema).max(MAX_PAGE_ITEMS);

export function validateUserTotalEarningsResponse(raw: unknown): UserTotalEarningEntry[] {
  const parsed = userTotalEarningsResponseSchema.safeParse(raw);
  if (!parsed.success) throw new Error("Expected user total earnings array");
  return parsed.data;
}

const userRewardPercentagesSchema = z.record(slugString, z.number());

export function validateUserRewardPercentagesResponse(raw: unknown): UserRewardPercentages {
  const parsed = userRewardPercentagesSchema.safeParse(raw);
  if (!parsed.success || Object.keys(parsed.data).length > MAX_PAGE_ITEMS) {
    throw new Error("Expected user reward percentages response");
  }
  return parsed.data;
}

const assetEarningSchema: z.ZodType<AssetEarning> = z.object({
  asset_address: idString,
  earnings: z.number(),
  asset_rate: z.number(),
});

const userRewardsMarketSchema: z.ZodType<UserRewardsMarket> = z.object({
  condition_id: idString,
  market_id: idString,
  event_id: idString,
  question: textString,
  market_slug: slugString,
  event_slug: slugString,
  image: urlString,
  rewards_max_spread: z.number(),
  rewards_min_size: z.number(),
  volume_24hr: z.number(),
  spread: z.number(),
  market_competitiveness: z.number(),
  tokens: z.array(rewardsTokenSchema).max(MAX_NESTED_ITEMS),
  rewards_config: z.array(rewardsConfigItemSchema).max(MAX_NESTED_ITEMS),
  maker_address: idString,
  earning_percentage: z.number(),
  earnings: z.array(assetEarningSchema).max(MAX_NESTED_ITEMS),
});

const paginatedUserRewardsMarketsSchema: z.ZodType<PaginatedUserRewardsMarkets> = z.object({
  limit: z.number(),
  count: z.number(),
  total_count: z.number(),
  next_cursor: slugString,
  data: z.array(userRewardsMarketSchema).max(MAX_PAGE_ITEMS),
});

export function validateUserEarningsMarketsResponse(raw: unknown): PaginatedUserRewardsMarkets {
  const parsed = paginatedUserRewardsMarketsSchema.safeParse(raw);
  if (!parsed.success) throw new Error("Expected user earnings/markets response");
  return parsed.data;
}
