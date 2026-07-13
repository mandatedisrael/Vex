/** Hyperliquid main IPC: policy acknowledgement, risk proposals, and positions. */

import { HyperliquidInfoClient } from "@tools/hyperliquid/info.js";
import { hyperliquidPolicySchema } from "@vex-lib/hyperliquid-policy.js";
import { Decimal } from "decimal.js";
import { z } from "zod";
import { resolveHyperliquidNetwork } from "@tools/hyperliquid/constants.js";
import { CH, EV } from "@shared/ipc/channels.js";
import { err, ok, type Result } from "@shared/ipc/result.js";
import {
  hyperliquidPositionsDtoSchema,
  hyperliquidPositionsReadInputSchema,
  hyperliquidCandlesDtoSchema,
  hyperliquidCandlesReadInputSchema,
  hyperliquidMarketsDtoSchema,
  hyperliquidMarketsReadInputSchema,
  hyperliquidBookDtoSchema,
  hyperliquidBookReadInputSchema,
  type HyperliquidCandlesDto,
  type HyperliquidMarketsDto,
  type HyperliquidBookDto,
  hyperliquidRiskAcknowledgementInputSchema,
  hyperliquidRiskProposalConfirmInputSchema,
  hyperliquidSessionRiskPolicyDtoSchema,
  hyperliquidSessionRiskPolicyReadInputSchema,
  hyperliquidSessionRiskPolicySetInputSchema,
  hyperliquidRiskProposalDtoSchema,
  hyperliquidRiskProposalsDtoSchema,
  hyperliquidRiskProposalsReadInputSchema,
  hyperliquidWorkspaceExitInputSchema,
  hyperliquidWorkspaceModeDtoSchema,
  hyperliquidWorkspaceModeReadInputSchema,
  hyperliquidWorkspaceModeEventSchema,
  hyperliquidWatchLiveInputSchema,
  hyperliquidWatchLiveDtoSchema,
  hyperliquidUnwatchLiveInputSchema,
  hyperliquidUnwatchLiveDtoSchema,
  type HyperliquidPositionsDto,
  type HyperliquidRiskProposalDto,
  type HyperliquidRiskProposalsDto,
  type HyperliquidSessionRiskPolicyDto,
  type HyperliquidWorkspaceModeEvent,
  type HyperliquidWorkspaceModeDto,
  type HyperliquidWatchLiveDto,
  type HyperliquidUnwatchLiveDto,
} from "@shared/schemas/hyperliquid.js";
import { preferencesSchema, type Preferences } from "@shared/schemas/preferences.js";
import { broadcastToAllWindows } from "../lifecycle/broadcast.js";
import { getSessionById, getSessionWalletScope } from "../database/sessions-db.js";
import {
  activateHyperliquidRiskProposal,
  createAdjustedHyperliquidRiskProposal,
  getHyperliquidSessionRiskPolicy,
  getHyperliquidPositions,
  listHyperliquidRiskProposals,
  setHyperliquidSessionRiskPolicy,
} from "../database/hyperliquid-db.js";
import { log } from "../logger/index.js";
import { setActiveHyperliquidPolicyOverlay } from "../hyperliquid/policy-provider.js";
import { canonicalCandleDecimal } from "../hyperliquid/candle-decimal.js";
import {
  requestHyperliquidWorkspaceMode,
  resolveHyperliquidWorkspaceMode,
} from "../hyperliquid/workspace-mode.js";
import {
  getHyperliquidLiveFeed,
  type HyperliquidLiveFeedController,
} from "../market/hyperliquid-live-feed-service.js";
import { preferencesStore } from "../preferences/store.js";
import { registerHandler } from "./register-handler.js";
import type { WebContents } from "electron";

const hyperliquidMetaSchema = z.object({
  universe: z.array(z.object({
    name: z.string(),
    maxLeverage: z.union([z.number(), z.string()]),
  }).passthrough()),
}).passthrough();

const candleProviderSchema = z.array(z.object({
  t: z.number().int().nonnegative(),
  o: z.string(), h: z.string(), l: z.string(), c: z.string(), v: z.string(),
}).passthrough()).max(1_000);
const CANDLE_CACHE_MS = 30_000;
const CANDLE_WINDOWS_MS = {
  "1m": 6 * 60 * 60 * 1_000,
  "5m": 24 * 60 * 60 * 1_000,
  "15m": 3 * 24 * 60 * 60 * 1_000,
  "1h": 7 * 24 * 60 * 60 * 1_000,
  "4h": 30 * 24 * 60 * 60 * 1_000,
  "1d": 180 * 24 * 60 * 60 * 1_000,
} as const;
const candleCache = new Map<string, { readonly expiresAt: number; readonly value: HyperliquidCandlesDto }>();
// The asset-picker metrics feed refreshes every 5s; the cache must not starve
// a renderer polling at that cadence.
const MARKETS_CACHE_MS = 5_000;
const BOOK_CACHE_MS = 2_000;
let marketsCache: { readonly expiresAt: number; readonly value: HyperliquidMarketsDto } | null = null;
const bookCache = new Map<string, { readonly expiresAt: number; readonly value: HyperliquidBookDto }>();

const marketsProviderSchema = z.tuple([
  z.object({
    universe: z.array(z.object({
      name: z.string(),
      maxLeverage: z.union([z.number(), z.string()]),
      szDecimals: z.number().int().nonnegative(),
    }).passthrough()).max(500),
  }).passthrough(),
  z.array(z.object({
    markPx: z.string(),
    prevDayPx: z.string().nullable().optional(),
    openInterest: z.string(),
    funding: z.string().nullable().optional(),
    dayNtlVlm: z.string().nullable().optional(),
  }).passthrough()).max(500),
]);

const bookProviderSchema = z.object({
  levels: z.tuple([
    z.array(z.object({ px: z.string(), sz: z.string(), n: z.number().int().nonnegative() }).passthrough()).max(200),
    z.array(z.object({ px: z.string(), sz: z.string(), n: z.number().int().nonnegative() }).passthrough()).max(200),
  ]),
  time: z.number().int().nonnegative(),
}).passthrough();

function unavailable(message: string, correlationId: string) {
  return err({
    code: "internal.unexpected",
    domain: "hyperliquid",
    message,
    retryable: true,
    userActionable: true,
    redacted: true,
    correlationId,
  });
}

async function requireExistingHyperliquidSession(
  sessionId: string,
  correlationId: string,
) {
  const session = await getSessionById(sessionId);
  if (!session.ok) return session;
  if (session.data !== null) return null;
  return err({
    code: "validation.invalid_input",
    domain: "hyperliquid",
    message: "The requested session no longer exists.",
    retryable: false,
    userActionable: true,
    redacted: true,
    correlationId,
  });
}

async function withUpdatedHyperliquidPreferences(
  update: (preferences: Preferences["hyperliquid"]) => Preferences["hyperliquid"],
): Promise<Preferences> {
  const current = await preferencesStore.load();
  return preferencesStore.update({ hyperliquid: update(current.hyperliquid) });
}

async function maxLeverageForCoin(coin: string): Promise<number | null> {
  const raw = await new HyperliquidInfoClient({ network: resolveHyperliquidNetwork() }).meta();
  const meta = hyperliquidMetaSchema.safeParse(raw);
  if (!meta.success) return null;
  for (const entry of meta.data.universe) {
    if (entry.name !== coin) continue;
    const max = typeof entry.maxLeverage === "number"
      ? entry.maxLeverage
      : Number(entry.maxLeverage);
    return Number.isSafeInteger(max) && max >= 1 ? max : null;
  }
  return null;
}

async function validateProposalLeverage(
  proposal: HyperliquidRiskProposalDto,
  correlationId: string,
) {
  try {
    const maxLeverage = await maxLeverageForCoin(proposal.coin);
    if (maxLeverage === null) {
      return unavailable(
        "Unable to verify this market's maximum leverage. Retry when Hyperliquid market data is available.",
        correlationId,
      );
    }
    if (proposal.policy.leverageCapDefault > maxLeverage) {
      return err({
        code: "validation.invalid_input",
        domain: "hyperliquid",
        message: `The selected leverage exceeds ${proposal.coin}'s current maximum of ${maxLeverage}x.`,
        retryable: false,
        userActionable: true,
        redacted: true,
        correlationId,
      });
    }
    return null;
  } catch (cause) {
    log.warn("[ipc:hyperliquid] max leverage validation failed", cause);
    return unavailable(
      "Unable to verify this market's maximum leverage. Retry when Hyperliquid market data is available.",
      correlationId,
    );
  }
}

/** An all-core-perps session cap must be valid for every currently listed core perp. */
async function validateSessionPolicyLeverage(
  leverageCapDefault: number,
  correlationId: string,
): Promise<Result<never> | null> {
  try {
    const raw = await new HyperliquidInfoClient({ network: resolveHyperliquidNetwork() }).meta();
    const meta = hyperliquidMetaSchema.safeParse(raw);
    if (!meta.success) {
      return unavailable(
        "Unable to verify the current Hyperliquid leverage limit. Retry when market data is available.",
        correlationId,
      );
    }
    const bounds = meta.data.universe.flatMap((entry) => {
      const value = typeof entry.maxLeverage === "number" ? entry.maxLeverage : Number(entry.maxLeverage);
      return Number.isSafeInteger(value) && value >= 1 ? [value] : [];
    });
    // The session cap is asset-AGNOSTIC: the protection gate always clamps
    // per order to min(cap, that asset's maxLeverage), so the only honest
    // venue bound here is the HIGHEST max across the universe. (Math.min
    // would let one 3x micro-cap forbid a 10x cap on 40x BTC.)
    const assetAgnosticMax = bounds.length === 0 ? null : Math.max(...bounds);
    if (assetAgnosticMax === null) {
      return unavailable(
        "Unable to verify the current Hyperliquid leverage limit. Retry when market data is available.",
        correlationId,
      );
    }
    if (leverageCapDefault > assetAgnosticMax) {
      return err({
        code: "validation.invalid_input",
        domain: "hyperliquid",
        message: `The selected leverage exceeds the current all-market maximum of ${assetAgnosticMax}x.`,
        retryable: false,
        userActionable: true,
        redacted: true,
        correlationId,
      });
    }
    return null;
  } catch (cause) {
    log.warn("[ipc:hyperliquid] session policy leverage validation failed", cause);
    return unavailable(
      "Unable to verify the current Hyperliquid leverage limit. Retry when market data is available.",
      correlationId,
    );
  }
}

function registerPositionsHandler(): () => void {
  return registerHandler({
    channel: CH.hyperliquid.getPositions,
    domain: "hyperliquid",
    inputSchema: hyperliquidPositionsReadInputSchema,
    outputSchema: hyperliquidPositionsDtoSchema,
    handle: (input, ctx): Promise<Result<HyperliquidPositionsDto>> =>
      getHyperliquidPositions(input.sessionId, ctx.requestId),
  });
}

function registerCandlesHandler(): () => void {
  return registerHandler({
    channel: CH.hyperliquid.getCandles,
    domain: "hyperliquid",
    inputSchema: hyperliquidCandlesReadInputSchema,
    outputSchema: hyperliquidCandlesDtoSchema,
    handle: async (input, ctx): Promise<Result<HyperliquidCandlesDto>> => {
      // Require a real server-resolved session before serving public market data
      // so a hostile renderer cannot use this bridge as a generic network proxy.
      const sessionError = await requireExistingHyperliquidSession(input.sessionId, ctx.requestId);
      if (sessionError !== null) return sessionError;
      const coin = input.coin.trim().toUpperCase();
      const cacheKey = `${coin}\u0000${input.interval}`;
      const cached = candleCache.get(cacheKey);
      if (cached !== undefined && cached.expiresAt > Date.now()) return ok(cached.value);
      try {
        const now = Date.now();
        const raw = await new HyperliquidInfoClient({ network: resolveHyperliquidNetwork() }).candleSnapshot({
          coin,
          interval: input.interval,
          startTime: now - CANDLE_WINDOWS_MS[input.interval],
          endTime: now,
        });
        const parsed = candleProviderSchema.safeParse(raw);
        if (!parsed.success) return unavailable("Hyperliquid returned an invalid candle snapshot. Retry shortly.", ctx.requestId);
        const candidate = {
          coin,
          interval: input.interval,
          candles: parsed.data.map((candle) => ({
            openTimeMs: candle.t,
            open: canonicalCandleDecimal(candle.o), high: canonicalCandleDecimal(candle.h),
            low: canonicalCandleDecimal(candle.l), close: canonicalCandleDecimal(candle.c),
            volume: canonicalCandleDecimal(candle.v),
          })),
          fetchedAt: new Date(now).toISOString(),
        };
        const value = hyperliquidCandlesDtoSchema.parse(candidate);
        candleCache.set(cacheKey, { expiresAt: now + CANDLE_CACHE_MS, value });
        return ok(value);
      } catch (cause) {
        log.warn("[ipc:hyperliquid] candle snapshot failed", cause);
        return unavailable("Unable to load Hyperliquid candles. Retry shortly.", ctx.requestId);
      }
    },
  });
}

function canonicalMarketDecimal(value: string, allowNegative = false): string {
  const decimal = new Decimal(value);
  if (!decimal.isFinite() || (!allowNegative && decimal.isNegative())) {
    throw new Error("invalid market decimal");
  }
  return decimal.toFixed();
}

function canonicalNullableMarketDecimal(value: string | null | undefined, allowNegative = false): string | null {
  return value === null || value === undefined ? null : canonicalMarketDecimal(value, allowNegative);
}

function mapHyperliquidMarkets(raw: unknown): HyperliquidMarketsDto {
  const parsed = marketsProviderSchema.parse(raw);
  const [meta, contexts] = parsed;
  if (meta.universe.length !== contexts.length) {
    throw new Error("Hyperliquid market metadata/context lengths did not match");
  }
  return hyperliquidMarketsDtoSchema.parse(meta.universe.map((asset, index) => {
    const context = contexts[index];
    if (context === undefined) throw new Error("Hyperliquid market context was missing");
    const maxLeverage = typeof asset.maxLeverage === "number"
      ? asset.maxLeverage
      : Number(asset.maxLeverage);
    if (!Number.isSafeInteger(maxLeverage) || maxLeverage < 1) {
      throw new Error("Hyperliquid market max leverage was invalid");
    }
    const markPx = new Decimal(context.markPx);
    const prevDayPx = context.prevDayPx === null || context.prevDayPx === undefined
      ? null
      : new Decimal(context.prevDayPx);
    if (!markPx.isFinite() || markPx.isNegative() || (prevDayPx !== null && (!prevDayPx.isFinite() || prevDayPx.lte(0)))) {
      throw new Error("Hyperliquid market price was invalid");
    }
    return {
      coin: asset.name,
      maxLeverage,
      markPx: markPx.toFixed(),
      change24hPct: prevDayPx === null ? null : markPx.minus(prevDayPx).div(prevDayPx).mul(100).toFixed(),
      openInterestUsd: markPx.mul(canonicalMarketDecimal(context.openInterest)).toFixed(),
      fundingRate8hPct: canonicalNullableMarketDecimal(context.funding, true) === null
        ? null
        : new Decimal(context.funding ?? "0").mul(8).toFixed(),
      dayNtlVlmUsd: canonicalNullableMarketDecimal(context.dayNtlVlm),
      szDecimals: asset.szDecimals,
    };
  }));
}

function mapHyperliquidBook(raw: unknown): HyperliquidBookDto {
  const parsed = bookProviderSchema.parse(raw);
  const mapLevels = (levels: ReadonlyArray<{ readonly px: string; readonly sz: string; readonly n: number }>) =>
    levels.map((level) => ({
      px: canonicalMarketDecimal(level.px),
      sz: canonicalMarketDecimal(level.sz),
      n: level.n,
    }));
  return hyperliquidBookDtoSchema.parse({
    levels: { bids: mapLevels(parsed.levels[0]), asks: mapLevels(parsed.levels[1]) },
    time: parsed.time,
  });
}

function registerMarketsHandler(): () => void {
  return registerHandler({
    channel: CH.hyperliquid.getMarkets,
    domain: "hyperliquid",
    inputSchema: hyperliquidMarketsReadInputSchema,
    outputSchema: hyperliquidMarketsDtoSchema,
    handle: async (input, ctx): Promise<Result<HyperliquidMarketsDto>> => {
      const sessionError = await requireExistingHyperliquidSession(input.sessionId, ctx.requestId);
      if (sessionError !== null) return sessionError;
      const now = Date.now();
      if (marketsCache !== null && marketsCache.expiresAt > now) return ok(marketsCache.value);
      try {
        const raw = await new HyperliquidInfoClient({ network: resolveHyperliquidNetwork() }).metaAndAssetCtxs();
        const value = mapHyperliquidMarkets(raw);
        marketsCache = { expiresAt: now + MARKETS_CACHE_MS, value };
        return ok(value);
      } catch (cause) {
        log.warn("[ipc:hyperliquid] markets read failed", cause);
        return unavailable("Unable to load Hyperliquid markets. Retry shortly.", ctx.requestId);
      }
    },
  });
}

function registerBookHandler(): () => void {
  return registerHandler({
    channel: CH.hyperliquid.getBook,
    domain: "hyperliquid",
    inputSchema: hyperliquidBookReadInputSchema,
    outputSchema: hyperliquidBookDtoSchema,
    handle: async (input, ctx): Promise<Result<HyperliquidBookDto>> => {
      const sessionError = await requireExistingHyperliquidSession(input.sessionId, ctx.requestId);
      if (sessionError !== null) return sessionError;
      const coin = input.coin.trim().toUpperCase();
      const cached = bookCache.get(coin);
      if (cached !== undefined && cached.expiresAt > Date.now()) return ok(cached.value);
      try {
        const raw = await new HyperliquidInfoClient({ network: resolveHyperliquidNetwork() }).l2Book(coin);
        const value = mapHyperliquidBook(raw);
        bookCache.set(coin, { expiresAt: Date.now() + BOOK_CACHE_MS, value });
        return ok(value);
      } catch (cause) {
        log.warn("[ipc:hyperliquid] order-book read failed", cause);
        return unavailable("Unable to load the Hyperliquid order book. Retry shortly.", ctx.requestId);
      }
    },
  });
}

function registerWorkspaceModeHandler(): () => void {
  return registerHandler({
    channel: CH.hyperliquid.getWorkspaceMode,
    domain: "hyperliquid",
    inputSchema: hyperliquidWorkspaceModeReadInputSchema,
    outputSchema: hyperliquidWorkspaceModeDtoSchema,
    handle: async (input, ctx): Promise<Result<HyperliquidWorkspaceModeDto>> => {
      const sessionError = await requireExistingHyperliquidSession(input.sessionId, ctx.requestId);
      if (sessionError !== null) return sessionError;
      const preferences = await preferencesStore.load();
      return ok(hyperliquidWorkspaceModeDtoSchema.parse({
        mode: resolveHyperliquidWorkspaceMode(input.sessionId),
        acknowledged: preferences.hyperliquid.riskAcknowledgedAt !== null,
      }));
    },
  });
}

function registerRiskProposalsReadHandler(): () => void {
  return registerHandler({
    channel: CH.hyperliquid.listRiskProposals,
    domain: "hyperliquid",
    inputSchema: hyperliquidRiskProposalsReadInputSchema,
    outputSchema: hyperliquidRiskProposalsDtoSchema,
    handle: async (input, ctx): Promise<Result<HyperliquidRiskProposalsDto>> => {
      const proposals = await listHyperliquidRiskProposals(input.sessionId, ctx.requestId);
      return proposals.ok
        ? ok({ sessionId: input.sessionId, proposals: [...proposals.data] })
        : proposals;
    },
  });
}

function registerAcknowledgeRiskHandler(): () => void {
  return registerHandler({
    channel: CH.hyperliquid.acknowledgeRisk,
    domain: "hyperliquid",
    inputSchema: hyperliquidRiskAcknowledgementInputSchema,
    outputSchema: preferencesSchema,
    handle: async (): Promise<Result<Preferences>> => {
      const preferences = await withUpdatedHyperliquidPreferences((hyperliquid) => ({
        ...hyperliquid,
        riskAcknowledgedAt: new Date().toISOString(),
      }));
      return ok(preferencesSchema.parse(preferences));
    },
  });
}

function registerExitWorkspaceHandler(): () => void {
  return registerHandler({
    channel: CH.hyperliquid.exitWorkspace,
    domain: "hyperliquid",
    inputSchema: hyperliquidWorkspaceExitInputSchema,
    outputSchema: hyperliquidWorkspaceModeEventSchema,
    handle: async (input): Promise<Result<HyperliquidWorkspaceModeEvent>> => {
      // The renderer can request only an exit, but still must name an existing
      // server-resolved session. This avoids exposing the main controller as a
      // generic state-changing IPC endpoint for arbitrary identifiers.
      const scope = await getSessionWalletScope(input.sessionId);
      if (!scope.ok) return scope;
      return ok(await requestHyperliquidWorkspaceMode(input.sessionId, "normal"));
    },
  });
}

function registerConfirmRiskProposalHandler(): () => void {
  return registerHandler({
    channel: CH.hyperliquid.confirmRiskProposal,
    domain: "hyperliquid",
    inputSchema: hyperliquidRiskProposalConfirmInputSchema,
    outputSchema: hyperliquidRiskProposalDtoSchema,
    handle: async (input, ctx): Promise<Result<HyperliquidRiskProposalDto>> => {
      const proposals = await listHyperliquidRiskProposals(input.sessionId, ctx.requestId);
      if (!proposals.ok) return proposals;
      const source = proposals.data.find((proposal) => proposal.proposalId === input.proposalId);
      if (source === undefined || source.status !== "proposed") {
        return err({
          code: "validation.invalid_input",
          domain: "hyperliquid",
          message: "That Hyperliquid risk proposal is no longer available.",
          retryable: false,
          userActionable: true,
          redacted: true,
          correlationId: ctx.requestId,
        });
      }

      const adjusted = input.adjustments === null
        ? ok(source)
        : await createAdjustedHyperliquidRiskProposal(
          input.sessionId,
          source.proposalId,
          input.adjustments,
          ctx.requestId,
        );
      if (!adjusted.ok) return adjusted;

      const leverageError = await validateProposalLeverage(adjusted.data, ctx.requestId);
      if (leverageError !== null) return leverageError;

      const activated = await activateHyperliquidRiskProposal(
        input.sessionId,
        adjusted.data.proposalId,
        ctx.requestId,
      );
      if (!activated.ok) return activated;

      const scope = await getSessionWalletScope(input.sessionId);
      if (!scope.ok || scope.data.evm === null) {
        return unavailable(
          "Unable to resolve the selected wallet for this Hyperliquid risk policy.",
          ctx.requestId,
        );
      }
      await setActiveHyperliquidPolicyOverlay({
        sessionId: input.sessionId,
        walletAddress: scope.data.evm.address,
        proposalId: activated.data.proposalId,
        policy: activated.data.policy,
        expiresAt: activated.data.expiresAt,
      });
      broadcastToAllWindows(EV.hyperliquid.riskProposalUpdate, activated.data);
      return activated;
    },
  });
}

function registerSetSessionRiskPolicyHandler(): () => void {
  return registerHandler({
    channel: CH.hyperliquid.setSessionRiskPolicy,
    domain: "hyperliquid",
    inputSchema: hyperliquidSessionRiskPolicySetInputSchema,
    outputSchema: hyperliquidRiskProposalDtoSchema,
    handle: async (input, ctx): Promise<Result<HyperliquidRiskProposalDto>> => {
      // Resolve the trusted wallet before touching exchange metadata or the
      // policy table. The renderer cannot create a policy for another wallet.
      const scope = await getSessionWalletScope(input.sessionId);
      if (!scope.ok) return scope;
      if (scope.data.evm === null) {
        return err({
          code: "validation.invalid_input",
          domain: "hyperliquid",
          message: "Select an EVM wallet for this session before setting Hyperliquid risk.",
          retryable: false,
          userActionable: true,
          redacted: true,
          correlationId: ctx.requestId,
        });
      }
      const leverageError = await validateSessionPolicyLeverage(input.leverageCapDefault, ctx.requestId);
      if (leverageError !== null) return leverageError;
      const activated = await setHyperliquidSessionRiskPolicy(input.sessionId, {
        leverageCapDefault: input.leverageCapDefault,
        perOrderNotionalPct: input.perOrderNotionalPct,
        totalNotionalPct: input.totalNotionalPct,
      }, ctx.requestId);
      if (!activated.ok) return activated;
      await setActiveHyperliquidPolicyOverlay({
        sessionId: input.sessionId,
        walletAddress: scope.data.evm.address,
        proposalId: activated.data.proposalId,
        policy: activated.data.policy,
        expiresAt: activated.data.expiresAt,
      });
      broadcastToAllWindows(EV.hyperliquid.riskProposalUpdate, activated.data);
      return activated;
    },
  });
}

function registerGetSessionRiskPolicyHandler(): () => void {
  return registerHandler({
    channel: CH.hyperliquid.getSessionRiskPolicy,
    domain: "hyperliquid",
    inputSchema: hyperliquidSessionRiskPolicyReadInputSchema,
    outputSchema: hyperliquidSessionRiskPolicyDtoSchema,
    handle: async (input, ctx): Promise<Result<HyperliquidSessionRiskPolicyDto>> => {
      const preferences = await preferencesStore.load();
      return getHyperliquidSessionRiskPolicy(
        input.sessionId,
        hyperliquidPolicySchema.parse(preferences.hyperliquid.policy),
        ctx.requestId,
      );
    },
  });
}

// Owner (webContents) → live-feed cleanup is attached exactly once per sender.
// A closed window must never leak a subscription, so the first watchLive from a
// sender registers a one-shot 'destroyed' release. WeakSet keys off the live
// WebContents so a destroyed sender is not retained.
const liveFeedTrackedSenders = new WeakSet<WebContents>();

function attachLiveFeedOwnerCleanup(feed: HyperliquidLiveFeedController, sender: WebContents): void {
  if (liveFeedTrackedSenders.has(sender)) return;
  liveFeedTrackedSenders.add(sender);
  const ownerId = sender.id;
  sender.once("destroyed", () => {
    void feed
      .releaseOwner(ownerId)
      .catch((cause) => log.warn("[ipc:hyperliquid] live feed owner release failed", cause));
  });
}

function registerWatchLiveHandler(): () => void {
  return registerHandler({
    channel: CH.hyperliquid.watchLive,
    domain: "hyperliquid",
    inputSchema: hyperliquidWatchLiveInputSchema,
    outputSchema: hyperliquidWatchLiveDtoSchema,
    handle: async (input, ctx): Promise<Result<HyperliquidWatchLiveDto>> => {
      const sessionError = await requireExistingHyperliquidSession(input.sessionId, ctx.requestId);
      if (sessionError !== null) return sessionError;
      const feed = getHyperliquidLiveFeed();
      if (feed === null) {
        return unavailable("The Hyperliquid live feed is not running. Retry shortly.", ctx.requestId);
      }
      const sender = ctx.event.sender;
      attachLiveFeedOwnerCleanup(feed, sender);
      try {
        const watchId = await feed.watch(sender.id, input.coin, input.interval);
        return ok({ watchId });
      } catch (cause) {
        log.warn("[ipc:hyperliquid] live watch failed", cause);
        return unavailable("Unable to start the Hyperliquid live feed for this market. Retry shortly.", ctx.requestId);
      }
    },
  });
}

function registerUnwatchLiveHandler(): () => void {
  return registerHandler({
    channel: CH.hyperliquid.unwatchLive,
    domain: "hyperliquid",
    inputSchema: hyperliquidUnwatchLiveInputSchema,
    outputSchema: hyperliquidUnwatchLiveDtoSchema,
    handle: async (input, ctx): Promise<Result<HyperliquidUnwatchLiveDto>> => {
      const sessionError = await requireExistingHyperliquidSession(input.sessionId, ctx.requestId);
      if (sessionError !== null) return sessionError;
      const feed = getHyperliquidLiveFeed();
      if (feed === null) return ok({ released: false });
      const released = await feed.unwatch(ctx.event.sender.id, input.watchId);
      return ok({ released });
    },
  });
}

export function registerHyperliquidHandlers(): Array<() => void> {
  return [
    registerPositionsHandler(),
    registerCandlesHandler(),
    registerMarketsHandler(),
    registerBookHandler(),
    registerWorkspaceModeHandler(),
    registerRiskProposalsReadHandler(),
    registerAcknowledgeRiskHandler(),
    registerConfirmRiskProposalHandler(),
    registerSetSessionRiskPolicyHandler(),
    registerGetSessionRiskPolicyHandler(),
    registerExitWorkspaceHandler(),
    registerWatchLiveHandler(),
    registerUnwatchLiveHandler(),
  ];
}
