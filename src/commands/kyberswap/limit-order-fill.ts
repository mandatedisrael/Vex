/**
 * `echoclaw kyberswap limit-order fill` — fill a limit order as taker.
 */

import { Command } from "commander";
import type { Hex, Address } from "viem";
import { getKyberLimitOrderTakerClient } from "../../tools/kyberswap/limit-order/taker-client.js";
import { DSLO_PROTOCOL } from "../../tools/kyberswap/constants.js";
import { getKyberEvmClients, ensureKyberAllowance, sendKyberTransaction } from "../../tools/kyberswap/evm-utils.js";
import { resolveChain, requireFeature } from "./helpers.js";
import { slugToChainId } from "../../tools/kyberswap/chains.js";
import { requireWalletAndKeystore } from "../../tools/wallet/auth.js";
import { EchoError, ErrorCodes } from "../../errors.js";
import { parseIntSafe } from "../../utils/validation.js";
import { isHeadless, writeJsonSuccess } from "../../utils/output.js";
import { spinner, successBox, infoBox, colors } from "../../utils/ui.js";

export function createLimitOrderFillAction(): Command {
  return new Command("fill")
    .description("Fill a limit order as taker (on-chain, costs gas)")
    .argument("<orderId>", "Order ID to fill")
    .requiredOption("--chain <chain>", "Chain slug or alias")
    .requiredOption("--taking-amount <amount>", "Amount to take (atomic, smallest units)")
    .requiredOption("--threshold <amount>", "Minimum acceptable making amount (atomic, smallest units)")
    .option("--dry-run", "Preview fill without executing")
    .option("--yes", "Confirm fill execution")
    .exitOverride()
    .action(async (orderIdStr: string, options: {
      chain: string; takingAmount: string; threshold: string;
      dryRun?: boolean; yes?: boolean;
    }) => {
      const slug = resolveChain(options.chain);
      requireFeature(slug, "limitOrder");
      const chainId = slugToChainId(slug);
      const orderId = parseIntSafe(orderIdStr, "orderId");

      const { address, privateKey } = requireWalletAndKeystore();
      const takerClient = getKyberLimitOrderTakerClient();

      const spin = spinner("Getting operator signature...");
      spin.start();

      const { operatorSignatures } = await takerClient.getOperatorSignature(String(chainId), [orderId]);

      if (operatorSignatures.length === 0) {
        spin.fail("No operator signature available");
        throw new EchoError(ErrorCodes.KYBER_LO_FILL_FAILED, "Operator signature not available for this order.");
      }

      spin.text = "Encoding fill transaction...";

      const encoded = await takerClient.encodeFillOrder({
        orderId,
        takingAmount: options.takingAmount,
        thresholdAmount: options.threshold,
        target: address as Address,
        operatorSignature: operatorSignatures[0],
      });

      spin.succeed("Fill transaction encoded");

      const fillInfo = [
        `Chain: ${slug} (${chainId})`,
        `Order: #${orderId}`,
        `Taking Amount: ${options.takingAmount}`,
        `Threshold: ${options.threshold}`,
        `Target: ${address}`,
      ].join("\n");

      if (options.dryRun) {
        if (isHeadless()) {
          writeJsonSuccess({
            dryRun: true, chain: slug, chainId, orderId,
            takingAmount: options.takingAmount, threshold: options.threshold,
            encodedData: encoded.encodedData,
            routerAddress: encoded.routerAddress,
          });
        } else {
          infoBox("Fill Order Preview (Dry Run)", fillInfo);
        }
        return;
      }

      if (!options.yes) {
        throw new EchoError(ErrorCodes.CONFIRMATION_REQUIRED, "Add --yes to confirm (or --dry-run to preview)");
      }

      const { publicClient, walletClient } = getKyberEvmClients(slug, privateKey as Hex);

      const spinSend = spinner("Sending fill transaction...");
      spinSend.start();

      const txHash = await sendKyberTransaction(publicClient, walletClient, {
        to: (encoded.routerAddress ?? DSLO_PROTOCOL) as Address,
        data: encoded.encodedData as Hex,
      });

      spinSend.succeed("Order filled");

      if (isHeadless()) {
        writeJsonSuccess({ orderId, chain: slug, chainId, txHash });
      } else {
        successBox("Limit Order Filled", `${fillInfo}\nTx: ${colors.info(txHash)}`);
      }
    });
}
