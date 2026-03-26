/**
 * Automatic trade capture from successful CLI execution results.
 *
 * Captures immutable execution facts from known mutating command families.
 * Reasoning, lifecycle updates, and P&L enrichment still flow through
 * the manual `trade_log` tool.
 */

import { createHash } from "node:crypto";
import { solanaExplorerUrl } from "../tools/chains/solana/validation.js";
import logger from "../utils/logger.js";
import * as tradesRepo from "./db/repos/trades.js";
import { normalizePortfolioChain } from "./portfolio-chains.js";
import type { TradeEntry, TradeStatus, TradeType } from "./types.js";

type TradeMutation = {
  id?: string;
  timestamp?: string;
  type?: TradeType;
  chain?: string;
  status?: TradeStatus;
  input?: TradeEntry["input"];
  output?: TradeEntry["output"];
  pnl?: TradeEntry["pnl"];
  meta?: Partial<TradeEntry["meta"]>;
  reasoning?: string;
  signature?: string;
  explorerUrl?: string;
};

const SUPPORTED_CAPTURE_COMMANDS = [
  "solana_swap_execute",
  "solana_predict_buy",
  "solana_predict_sell",
  "solana_predict_claim",
  "solana_stake_delegate",
  "solana_stake_withdraw",
  "solana_stake_claim-mev",
  "solana_lend_deposit",
  "solana_lend_withdraw",
  "khalani_bridge",
  "kyberswap_swap_sell",
  "jaine_swap_sell",
  "jaine_swap_buy",
  "slop_trade_buy",
  "slop_trade_sell",
] as const;

const COMMAND_TOKENS: Map<string, string[]> = new Map(
  SUPPORTED_CAPTURE_COMMANDS.map((command) => [command, command.replace(/_/g, " ").split(/\s+/)]),
);

const PREFIX_DETECTION_ORDER = [...COMMAND_TOKENS.entries()]
  .sort((a, b) => b[1].length - a[1].length);

interface ParsedCliInvocation {
  positionals: string[];
  options: Map<string, string | boolean>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function toStringValue(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function getNestedRecord(source: Record<string, unknown>, key: string): Record<string, unknown> | null {
  const value = source[key];
  return isRecord(value) ? value : null;
}

function normalizeSuccessPayload(output: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(output) as unknown;
    if (!isRecord(parsed)) return null;
    if (parsed.success === true) return parsed;

    // Backward-compatible safety for any older ok/data envelopes.
    if (parsed.ok === true) {
      const data = getNestedRecord(parsed, "data");
      return data ? { success: true, ...data } : { success: true };
    }

    return null;
  } catch {
    return null;
  }
}

function parseCliInvocation(command: string, argv: string[]): ParsedCliInvocation {
  const commandTokens = COMMAND_TOKENS.get(command) ?? command.replace(/_/g, " ").split(/\s+/);
  const args = argv.slice(commandTokens.length);
  const positionals: string[] = [];
  const options = new Map<string, string | boolean>();

  for (let i = 0; i < args.length; i++) {
    const token = args[i];
    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }

    if (token.includes("=")) {
      const [flag, value] = token.split(/=(.*)/s, 2);
      options.set(flag, value === "" ? true : value);
      continue;
    }

    const next = args[i + 1];
    if (next && !next.startsWith("--")) {
      options.set(token, next);
      i++;
      continue;
    }

    options.set(token, true);
  }

  return { positionals, options };
}

function getOptionString(options: Map<string, string | boolean>, flag: string): string | undefined {
  const value = options.get(flag);
  return typeof value === "string" ? value : undefined;
}

function getOptionNumber(options: Map<string, string | boolean>, flag: string): number | undefined {
  const value = getOptionString(options, flag);
  return value ? asNumber(value) : undefined;
}

function makeHashedTradeId(type: string, chain: string, executionKey: string): string {
  const digest = createHash("sha1")
    .update(`${type}:${chain}:${executionKey}`)
    .digest("hex")
    .slice(0, 20);
  return `trade_${digest}`;
}

export function deriveTradeIdFromTrade(trade: Partial<Pick<TradeEntry, "type" | "chain" | "signature" | "explorerUrl">> & {
  meta?: Partial<TradeEntry["meta"]>;
}): string | null {
  if (!trade.type || !trade.chain) return null;

  const executionKey = [
    trade.meta?.positionPubkey,
    trade.signature,
    trade.meta?.orderId,
    trade.meta?.routeId ? `${trade.meta.routeId}:${trade.meta.sourceChain ?? trade.chain}` : undefined,
    trade.explorerUrl,
  ].find((value): value is string => typeof value === "string" && value.trim().length > 0);

  if (!executionKey) return null;
  return makeHashedTradeId(trade.type, trade.chain, executionKey);
}

export function detectCapturedTradeCommand(argv: string[]): string | null {
  for (const [command, tokens] of PREFIX_DETECTION_ORDER) {
    if (argv.length < tokens.length) continue;
    const matches = tokens.every((token, index) => argv[index] === token);
    if (matches) return command;
  }
  return null;
}

function getSignature(payload: Record<string, unknown>): string | undefined {
  return asString(payload.signature) ?? asString(payload.txHash);
}

function makeTrade(
  type: TradeType,
  chain: string,
  status: TradeStatus,
  input: TradeEntry["input"],
  output: TradeEntry["output"],
  extras: Omit<TradeMutation, "type" | "chain" | "status" | "input" | "output"> = {},
): TradeMutation {
  return { type, chain, status, input, output, ...extras };
}

function buildTradeMutations(
  command: string,
  payload: Record<string, unknown>,
  invocation: ParsedCliInvocation,
): TradeMutation[] {
  const signature = getSignature(payload);
  const explorerUrl = asString(payload.explorerUrl);
  const slippageBps = getOptionNumber(invocation.options, "--slippage-bps");

  switch (command) {
    case "solana_swap_execute":
      return [
        makeTrade(
          "swap",
          "solana",
          "executed",
          {
            token: asString(payload.inputToken) ?? invocation.positionals[0] ?? "unknown",
            amount: asString(payload.inputAmount) ?? getOptionString(invocation.options, "--amount") ?? "0",
          },
          {
            token: asString(payload.outputToken) ?? invocation.positionals[1] ?? "unknown",
            amount: asString(payload.outputAmount) ?? "0",
          },
          {
            signature,
            explorerUrl,
            meta: { dex: "jupiter", slippageBps },
          },
        ),
      ];

    case "solana_predict_buy": {
      const positionPubkey = asString(payload.positionPubkey);
      const sideRaw = asString(payload.side)?.toLowerCase();
      return [
        makeTrade(
          "prediction",
          "solana",
          "open",
          {
            token: "USDC",
            amount: asString(payload.amount) ?? getOptionString(invocation.options, "--amount") ?? "0",
          },
          {
            token: sideRaw === "no" ? "NO" : "YES",
            amount: "0",
          },
          {
            signature,
            explorerUrl: explorerUrl ?? (signature ? solanaExplorerUrl(signature) : undefined),
            meta: {
              marketId: asString(payload.marketId) ?? invocation.positionals[0],
              side: sideRaw === "no" ? "no" : "yes",
              positionPubkey,
            },
          },
        ),
      ];
    }

    case "solana_predict_sell":
    case "solana_predict_claim": {
      const positionPubkey = invocation.positionals[0] ?? asString(payload.positionPubkey);
      return [
        makeTrade(
          "prediction",
          "solana",
          command === "solana_predict_claim" ? "claimed" : "closed",
          { token: "POSITION", amount: "1" },
          { token: "USDC", amount: "0" },
          {
            signature,
            explorerUrl: explorerUrl ?? (signature ? solanaExplorerUrl(signature) : undefined),
            meta: { positionPubkey },
          },
        ),
      ];
    }

    case "solana_stake_delegate":
      return [
        makeTrade(
          "stake",
          "solana",
          "executed",
          {
            token: "SOL",
            amount: getOptionString(invocation.options, "--amount") ?? "0",
          },
          {
            token: "STAKE",
            amount: getOptionString(invocation.options, "--amount") ?? "0",
          },
          {
            signature,
            explorerUrl,
            meta: {
              action: "delegate",
              stakeAccount: asString(payload.stakeAccount),
            },
          },
        ),
      ];

    case "solana_stake_withdraw":
      return [
        makeTrade(
          "stake",
          "solana",
          "executed",
          {
            token: "STAKE",
            amount: getOptionString(invocation.options, "--amount") ?? "all",
          },
          {
            token: "SOL",
            amount: getOptionString(invocation.options, "--amount") ?? "all",
          },
          {
            signature,
            explorerUrl,
            meta: {
              action: "withdraw",
              stakeAccount: invocation.positionals[0],
            },
          },
        ),
      ];

    case "solana_stake_claim-mev": {
      const claimed = payload.claimed;
      if (!Array.isArray(claimed)) return [];
      return claimed
        .filter(isRecord)
        .map((entry) => {
          const claimedSignature = asString(entry.signature);
          const claimedSol = asNumber(entry.claimedSol);
          return makeTrade(
            "stake",
            "solana",
            "executed",
            {
              token: "MEV",
              amount: claimedSol != null ? String(claimedSol) : "0",
            },
            {
              token: "SOL",
              amount: claimedSol != null ? String(claimedSol) : "0",
            },
            {
              signature: claimedSignature,
              explorerUrl: claimedSignature ? solanaExplorerUrl(claimedSignature) : undefined,
              meta: {
                action: "claim-mev",
                stakeAccount: asString(entry.stakeAccount),
              },
            },
          );
        });
    }

    case "solana_lend_deposit":
    case "solana_lend_withdraw": {
      const token = asString(payload.token) ?? invocation.positionals[0] ?? "unknown";
      const amount = asString(payload.amount) ?? getOptionString(invocation.options, "--amount") ?? "0";
      const action = command === "solana_lend_deposit" ? "deposit" : "withdraw";
      return [
        makeTrade(
          "lend",
          "solana",
          "executed",
          { token, amount },
          { token, amount },
          {
            signature,
            explorerUrl,
            meta: { action },
          },
        ),
      ];
    }

    case "khalani_bridge": {
      const sourceChain = normalizePortfolioChain(
        getOptionString(invocation.options, "--from-chain")
          ?? toStringValue(payload.sourceChainId)
          ?? "unknown",
      );
      const destChain = normalizePortfolioChain(
        getOptionString(invocation.options, "--to-chain")
          ?? toStringValue(payload.destinationChainId)
          ?? "unknown",
      );
      return [
        makeTrade(
          "bridge",
          sourceChain,
          "pending",
          {
            token: getOptionString(invocation.options, "--from-token") ?? "unknown",
            amount: getOptionString(invocation.options, "--amount") ?? "0",
          },
          {
            token: getOptionString(invocation.options, "--to-token") ?? "unknown",
            amount: "0",
          },
          {
            signature,
            explorerUrl,
            meta: {
              sourceChain,
              destChain,
              routeId: asString(payload.routeId),
              orderId: asString(payload.orderId),
            },
          },
        ),
      ];
    }

    case "kyberswap_swap_sell":
      return [
        makeTrade(
          "swap",
          normalizePortfolioChain(asString(payload.chain) ?? getOptionString(invocation.options, "--chain") ?? "unknown"),
          "executed",
          {
            token: invocation.positionals[0] ?? asString(payload.tokenIn) ?? "unknown",
            amount: asString(payload.amountInNormalized) ?? asString(payload.amountIn) ?? getOptionString(invocation.options, "--amount-in") ?? "0",
          },
          {
            token: invocation.positionals[1] ?? asString(payload.tokenOut) ?? "unknown",
            amount: asString(payload.amountOutNormalized) ?? asString(payload.amountOut) ?? "0",
          },
          {
            signature,
            explorerUrl,
            meta: { dex: "kyberswap", slippageBps },
          },
        ),
      ];

    case "jaine_swap_sell":
      return [
        makeTrade(
          "swap",
          "0g",
          "executed",
          {
            token: invocation.positionals[0] ?? asString(payload.tokenIn) ?? "unknown",
            amount: asString(payload.amountIn) ?? getOptionString(invocation.options, "--amount-in") ?? "0",
          },
          {
            token: invocation.positionals[1] ?? asString(payload.tokenOut) ?? "unknown",
            amount: asString(payload.amountOutExpected) ?? asString(payload.amountOut) ?? "0",
          },
          {
            signature,
            explorerUrl,
            meta: { dex: "jaine", slippageBps },
          },
        ),
      ];

    case "jaine_swap_buy":
      return [
        makeTrade(
          "swap",
          "0g",
          "executed",
          {
            token: invocation.positionals[0] ?? asString(payload.tokenIn) ?? "unknown",
            amount: asString(payload.amountInExpected) ?? asString(payload.amountInMaximum) ?? "0",
          },
          {
            token: invocation.positionals[1] ?? asString(payload.tokenOut) ?? "unknown",
            amount: asString(payload.amountOut) ?? "0",
          },
          {
            signature,
            explorerUrl,
            meta: { dex: "jaine", slippageBps },
          },
        ),
      ];

    case "slop_trade_buy": {
      const quote = getNestedRecord(payload, "quote");
      return [
        makeTrade(
          "bonding",
          "0g",
          "executed",
          {
            token: "0G",
            amount: asString(quote?.ogUsed) ?? getOptionString(invocation.options, "--amount-og") ?? "0",
          },
          {
            token: asString(payload.symbol) ?? asString(payload.token) ?? "unknown",
            amount: asString(quote?.tokensOut) ?? "0",
          },
          {
            signature,
            explorerUrl,
            meta: {
              bondingToken: asString(payload.token),
              slippageBps,
            },
          },
        ),
      ];
    }

    case "slop_trade_sell": {
      const quote = getNestedRecord(payload, "quote");
      return [
        makeTrade(
          "bonding",
          "0g",
          "executed",
          {
            token: asString(payload.symbol) ?? asString(payload.token) ?? "unknown",
            amount: asString(quote?.tokensSold) ?? getOptionString(invocation.options, "--amount-tokens") ?? "0",
          },
          {
            token: "0G",
            amount: asString(quote?.ogOutNet) ?? "0",
          },
          {
            signature,
            explorerUrl,
            meta: {
              bondingToken: asString(payload.token),
              slippageBps,
            },
          },
        ),
      ];
    }

    default:
      return [];
  }
}

function mergeTrade(existing: TradeEntry | null, mutation: TradeMutation, id: string): TradeEntry | null {
  const type = mutation.type ?? existing?.type;
  const chain = mutation.chain ?? existing?.chain;
  const status = mutation.status ?? existing?.status;

  const shouldPreservePredictionPosition =
    existing?.type === "prediction"
    && (mutation.status === "closed" || mutation.status === "claimed");

  const input = shouldPreservePredictionPosition
    ? existing?.input ?? mutation.input
    : mutation.input ?? existing?.input;

  const output = shouldPreservePredictionPosition
    ? existing?.output ?? mutation.output
    : mutation.output ?? existing?.output;

  if (!type || !chain || !status || !input || !output) {
    return null;
  }

  return {
    id,
    timestamp: existing?.timestamp ?? mutation.timestamp ?? new Date().toISOString(),
    type,
    chain,
    status,
    input,
    output,
    pnl: mutation.pnl ?? existing?.pnl,
    meta: { ...(existing?.meta ?? {}), ...(mutation.meta ?? {}) },
    reasoning: mutation.reasoning ?? existing?.reasoning,
    signature: mutation.signature ?? existing?.signature,
    explorerUrl: mutation.explorerUrl ?? existing?.explorerUrl,
  };
}

async function persistTradeMutation(mutation: TradeMutation): Promise<TradeEntry | null> {
  const id = mutation.id ?? deriveTradeIdFromTrade({
    type: mutation.type,
    chain: mutation.chain,
    signature: mutation.signature,
    explorerUrl: mutation.explorerUrl,
    meta: mutation.meta,
  });

  if (!id) {
    logger.warn("trade.capture.skipped", {
      reason: "missing_identity",
      type: mutation.type,
      chain: mutation.chain,
      meta: mutation.meta,
    });
    return null;
  }

  const existing = await tradesRepo.getTradeById(id);
  const merged = mergeTrade(existing, mutation, id);
  if (!merged) {
    logger.warn("trade.capture.skipped", {
      reason: "incomplete_trade",
      id,
      type: mutation.type,
      chain: mutation.chain,
    });
    return null;
  }

  await tradesRepo.addTrade(merged);
  return merged;
}

export async function captureTradeFromResult(
  command: string,
  argv: string[],
  output: string,
): Promise<TradeEntry[]> {
  const resolvedCommand = COMMAND_TOKENS.has(command) ? command : detectCapturedTradeCommand(argv);
  if (!resolvedCommand) return [];

  const payload = normalizeSuccessPayload(output);
  if (!payload || asBoolean(payload.dryRun) === true) return [];

  const invocation = parseCliInvocation(resolvedCommand, argv);
  const mutations = buildTradeMutations(resolvedCommand, payload, invocation);
  if (mutations.length === 0) return [];

  const saved: TradeEntry[] = [];
  for (const mutation of mutations) {
    const trade = await persistTradeMutation(mutation);
    if (trade) saved.push(trade);
  }

  if (saved.length > 0) {
    logger.info("trade.capture.saved", { command: resolvedCommand, count: saved.length });
  }

  return saved;
}
