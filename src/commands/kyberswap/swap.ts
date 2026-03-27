/**
 * `echoclaw kyberswap swap` — sell and quote via KyberSwap Aggregator.
 *
 * KyberSwap only supports exact-input (amountIn). No swap buy.
 * Execution model: --dry-run (quote only) or --yes (execute).
 */

import { Command } from "commander";
import { formatUnits, parseUnits, type Hex, type Address } from "viem";
import { getKyberAggregatorClient } from "../../tools/kyberswap/aggregator/client.js";
import { META_AGGREGATION_ROUTER_V2, NATIVE_TOKEN_ADDRESS } from "../../tools/kyberswap/constants.js";
import { getKyberEvmClients, ensureKyberAllowance, verifyRouterAddress, sendKyberTransaction } from "../../tools/kyberswap/evm-utils.js";
import { resolveChain, resolveTokenMetadata, formatUsd, formatGas, requireFeature } from "./helpers.js";
import { slugToChainId } from "../../tools/kyberswap/chains.js";
import { requireWalletAndKeystore } from "../../tools/wallet/auth.js";
import { EchoError, ErrorCodes } from "../../errors.js";
import { parseIntSafe, validateSlippage } from "../../utils/validation.js";
import { isHeadless, writeJsonSuccess } from "../../utils/output.js";
import { spinner, successBox, infoBox, colors } from "../../utils/ui.js";

function formatTokenAmount(amount: string, decimals: number): string {
  return formatUnits(BigInt(amount), decimals);
}

export function createSwapSubcommand(): Command {
  const swap = new Command("swap")
    .description("Token swap via KyberSwap Aggregator (18 chains, 400+ DEXs)")
    .exitOverride();

  // ── swap sell ─────────────────────────────────────────────────────

  swap
    .command("sell <tokenIn> <tokenOut>")
    .description("Sell exact amount of tokenIn for tokenOut")
    .requiredOption("--chain <chain>", "Chain slug or alias")
    .requiredOption("--amount-in <amount>", "Amount of tokenIn to sell (human-readable)")
    .option("--slippage-bps <bps>", "Slippage tolerance in basis points", "50")
    .option("--recipient <address>", "Recipient address (defaults to wallet)")
    .option("--permit <data>", "EIP-2612 permit signature (hex) for gasless approval")
    .option("--dry-run", "Show quote without executing")
    .option("--yes", "Confirm the transaction")
    .option("--approve-exact", "Approve exact amount instead of unlimited")
    .action(async (tokenIn: string, tokenOut: string, options: {
      chain: string; amountIn: string; slippageBps: string;
      recipient?: string; permit?: string; dryRun?: boolean; yes?: boolean; approveExact?: boolean;
    }) => {
      const slug = resolveChain(options.chain);
      requireFeature(slug, "aggregator");
      const chainId = slugToChainId(slug);
      const slippageBps = validateSlippage(parseIntSafe(options.slippageBps, "slippageBps"));

      // Resolve token addresses
      const spin = spinner("Resolving tokens...");
      spin.start();

      const tokenInMeta = await resolveTokenMetadata(tokenIn, chainId);
      const tokenOutMeta = await resolveTokenMetadata(tokenOut, chainId);
      const tokenInAddr = tokenInMeta.address;
      const tokenOutAddr = tokenOutMeta.address;
      const amountInRaw = parseUnits(options.amountIn, tokenInMeta.decimals).toString();

      spin.text = "Finding best route...";

      const client = getKyberAggregatorClient();
      const routeResponse = await client.getRoute(slug, {
        tokenIn: tokenInAddr,
        tokenOut: tokenOutAddr,
        amountIn: amountInRaw,
      });

      const { routeSummary, routerAddress } = routeResponse.data;
      const routeAmountIn = formatTokenAmount(routeSummary.amountIn, tokenInMeta.decimals);
      const routeAmountOut = formatTokenAmount(routeSummary.amountOut, tokenOutMeta.decimals);
      spin.succeed("Route found");

      // Display quote
      const quoteInfo =
        `Sell: ${colors.value(routeAmountIn)} ${tokenInMeta.symbol}\n` +
        `Receive: ~${colors.value(routeAmountOut)} ${tokenOutMeta.symbol}\n` +
        `Value: ${formatUsd(routeSummary.amountInUsd)} → ${formatUsd(routeSummary.amountOutUsd)}\n` +
        `Gas: ${formatGas(routeSummary.gas, routeSummary.gasUsd)}\n` +
        `Route: ${routeSummary.route.length} path(s) via ${routeSummary.route.flat().map(s => s.exchange).filter((v, i, a) => a.indexOf(v) === i).join(", ")}\n` +
        `Router: ${routerAddress}\n` +
        `Slippage: ${(slippageBps / 100).toFixed(2)}%`;

      if (options.dryRun) {
        if (isHeadless()) {
          writeJsonSuccess({
            dryRun: true, chain: slug, chainId, tokenIn: tokenInAddr, tokenOut: tokenOutAddr,
            tokenInSymbol: tokenInMeta.symbol, tokenOutSymbol: tokenOutMeta.symbol,
            tokenInDecimals: tokenInMeta.decimals, tokenOutDecimals: tokenOutMeta.decimals,
            requestedAmountIn: options.amountIn,
            amountIn: routeSummary.amountIn, amountOut: routeSummary.amountOut,
            amountInNormalized: routeAmountIn, amountOutNormalized: routeAmountOut,
            amountInUsd: routeSummary.amountInUsd, amountOutUsd: routeSummary.amountOutUsd,
            gas: routeSummary.gas, gasUsd: routeSummary.gasUsd,
            routerAddress, routeID: routeSummary.routeID,
          });
        } else {
          infoBox("Swap Quote (Dry Run)", quoteInfo);
        }
        return;
      }

      if (!options.yes) {
        throw new EchoError(ErrorCodes.CONFIRMATION_REQUIRED, "Add --yes to confirm (or --dry-run to preview)");
      }

      // Execute swap
      const { address, privateKey } = requireWalletAndKeystore();
      verifyRouterAddress(routerAddress, META_AGGREGATION_ROUTER_V2);

      const { publicClient, walletClient } = getKyberEvmClients(slug, privateKey as Hex);

      const recipient = options.recipient ? (options.recipient as Address) : address;

      // Approve if non-native token (skip if EIP-2612 permit provided)
      if (!options.permit && tokenInAddr.toLowerCase() !== NATIVE_TOKEN_ADDRESS.toLowerCase()) {
        const spinApprove = spinner("Checking allowance...");
        spinApprove.start();
        const approvalResult = await ensureKyberAllowance(
          publicClient, walletClient,
          tokenInAddr, routerAddress,
          BigInt(routeSummary.amountIn),
          options.approveExact,
        );
        spinApprove.succeed(approvalResult ? "Token approved" : "Allowance sufficient");
      }

      // Build encoded tx
      const spinBuild = spinner("Building transaction...");
      spinBuild.start();

      const buildResponse = await client.buildRoute(slug, {
        routeSummary,
        sender: address,
        recipient,
        slippageTolerance: slippageBps,
        permit: options.permit,
      });

      spinBuild.succeed("Transaction built");

      // Send
      const spinSend = spinner("Sending transaction...");
      spinSend.start();

      const txHash = await sendKyberTransaction(publicClient, walletClient, {
        to: buildResponse.data.routerAddress,
        data: buildResponse.data.data as Hex,
        value: BigInt(buildResponse.data.transactionValue),
      });
      const executedAmountIn = formatTokenAmount(buildResponse.data.amountIn, tokenInMeta.decimals);
      const executedAmountOut = formatTokenAmount(buildResponse.data.amountOut, tokenOutMeta.decimals);

      spinSend.succeed("Swap executed");

      if (isHeadless()) {
        writeJsonSuccess({
          txHash, chain: slug, chainId, tokenIn: tokenInAddr, tokenOut: tokenOutAddr,
          tokenInSymbol: tokenInMeta.symbol, tokenOutSymbol: tokenOutMeta.symbol,
          tokenInDecimals: tokenInMeta.decimals, tokenOutDecimals: tokenOutMeta.decimals,
          amountIn: buildResponse.data.amountIn, amountOut: buildResponse.data.amountOut,
          amountInNormalized: executedAmountIn, amountOutNormalized: executedAmountOut,
          amountInUsd: buildResponse.data.amountInUsd, amountOutUsd: buildResponse.data.amountOutUsd,
          routerAddress: buildResponse.data.routerAddress, recipient,
        });
      } else {
        successBox("Swap Executed", `${quoteInfo}\nTx: ${colors.info(txHash)}`);
      }
    });

  // ── swap quote ────────────────────────────────────────────────────

  swap
    .command("quote <tokenIn> <tokenOut>")
    .description("Quote swap route (read-only, no wallet needed)")
    .requiredOption("--chain <chain>", "Chain slug or alias")
    .requiredOption("--amount-in <amount>", "Amount of tokenIn (human-readable)")
    .action(async (tokenIn: string, tokenOut: string, options: { chain: string; amountIn: string }) => {
      const slug = resolveChain(options.chain);
      requireFeature(slug, "aggregator");
      const chainId = slugToChainId(slug);

      const spin = spinner("Finding best route...");
      spin.start();

      const tokenInMeta = await resolveTokenMetadata(tokenIn, chainId);
      const tokenOutMeta = await resolveTokenMetadata(tokenOut, chainId);
      const tokenInAddr = tokenInMeta.address;
      const tokenOutAddr = tokenOutMeta.address;
      const amountInRaw = parseUnits(options.amountIn, tokenInMeta.decimals).toString();

      const client = getKyberAggregatorClient();
      const routeResponse = await client.getRoute(slug, {
        tokenIn: tokenInAddr, tokenOut: tokenOutAddr, amountIn: amountInRaw,
      });

      const { routeSummary, routerAddress } = routeResponse.data;
      const routeAmountIn = formatTokenAmount(routeSummary.amountIn, tokenInMeta.decimals);
      const routeAmountOut = formatTokenAmount(routeSummary.amountOut, tokenOutMeta.decimals);
      spin.succeed("Route found");

      if (isHeadless()) {
        writeJsonSuccess({
          chain: slug, chainId, tokenIn: tokenInAddr, tokenOut: tokenOutAddr,
          tokenInSymbol: tokenInMeta.symbol, tokenOutSymbol: tokenOutMeta.symbol,
          tokenInDecimals: tokenInMeta.decimals, tokenOutDecimals: tokenOutMeta.decimals,
          requestedAmountIn: options.amountIn,
          amountIn: routeSummary.amountIn, amountOut: routeSummary.amountOut,
          amountInNormalized: routeAmountIn, amountOutNormalized: routeAmountOut,
          amountInUsd: routeSummary.amountInUsd, amountOutUsd: routeSummary.amountOutUsd,
          gas: routeSummary.gas, gasUsd: routeSummary.gasUsd,
          routerAddress, routeID: routeSummary.routeID,
          exchanges: routeSummary.route.flat().map(s => s.exchange).filter((v, i, a) => a.indexOf(v) === i),
        });
      } else {
        const exchanges = routeSummary.route.flat().map(s => s.exchange).filter((v, i, a) => a.indexOf(v) === i);
        infoBox("Swap Quote", [
          `Sell: ${colors.value(routeAmountIn)} ${tokenInMeta.symbol}`,
          `Receive: ~${colors.value(routeAmountOut)} ${tokenOutMeta.symbol}`,
          `Value: ${formatUsd(routeSummary.amountInUsd)} → ${formatUsd(routeSummary.amountOutUsd)}`,
          `Gas: ${formatGas(routeSummary.gas, routeSummary.gasUsd)}`,
          `Route: ${routeSummary.route.length} path(s) via ${exchanges.join(", ")}`,
          `Router: ${routerAddress}`,
        ].join("\n"));
      }
    });

  return swap;
}
