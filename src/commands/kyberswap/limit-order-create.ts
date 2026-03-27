/**
 * `echoclaw kyberswap limit-order create` — create gasless limit order.
 */

import { Command } from "commander";
import type { Hex, Address } from "viem";
import { formatUnits, parseUnits } from "viem";
import { getKyberLimitOrderClient } from "../../tools/kyberswap/limit-order/client.js";
import { signEip712Message } from "../../tools/kyberswap/limit-order/signing.js";
import { resolveChain, resolveTokenMetadata, requireFeature } from "./helpers.js";
import { slugToChainId } from "../../tools/kyberswap/chains.js";
import { requireWalletAndKeystore } from "../../tools/wallet/auth.js";
import { EchoError, ErrorCodes } from "../../errors.js";
import { isHeadless, writeJsonSuccess } from "../../utils/output.js";
import { spinner, successBox, infoBox, colors } from "../../utils/ui.js";

/** Parse duration string like "1h", "30m", "7d" to seconds from now. */
function parseExpiry(input: string): number {
  const match = input.match(/^(\d+)(m|h|d)$/);
  if (!match) throw new EchoError(ErrorCodes.KYBER_MALFORMED_PARAMS, `Invalid expiry: "${input}". Use format: 30m, 1h, 7d`);
  const [, num, unit] = match;
  const multiplier = unit === "m" ? 60 : unit === "h" ? 3600 : 86400;
  return Math.floor(Date.now() / 1000) + parseInt(num, 10) * multiplier;
}

export function createLimitOrderCreateAction(): Command {
  return new Command("create")
    .description("Create a gasless limit order (EIP-712 signed, off-chain)")
    .requiredOption("--chain <chain>", "Chain slug or alias")
    .requiredOption("--maker-asset <token>", "Token to sell (address or symbol)")
    .requiredOption("--taker-asset <token>", "Token to receive (address or symbol)")
    .requiredOption("--making-amount <amount>", "Amount to sell (human-readable)")
    .requiredOption("--taking-amount <amount>", "Amount to receive (human-readable)")
    .requiredOption("--expires <duration>", "Expiry duration (e.g. 1h, 30m, 7d)")
    .option("--dry-run", "Preview order without creating")
    .option("--yes", "Confirm order creation")
    .exitOverride()
    .action(async (options: {
      chain: string; makerAsset: string; takerAsset: string;
      makingAmount: string; takingAmount: string; expires: string;
      dryRun?: boolean; yes?: boolean;
    }) => {
      const slug = resolveChain(options.chain);
      requireFeature(slug, "limitOrder");
      const chainId = slugToChainId(slug);
      const expiredAt = parseExpiry(options.expires);

      const spin = spinner("Resolving tokens...");
      spin.start();

      const makerMeta = await resolveTokenMetadata(options.makerAsset, chainId);
      const takerMeta = await resolveTokenMetadata(options.takerAsset, chainId);
      const makerAsset = makerMeta.address;
      const takerAsset = takerMeta.address;

      const makingAmount = parseUnits(options.makingAmount, makerMeta.decimals).toString();
      const takingAmount = parseUnits(options.takingAmount, takerMeta.decimals).toString();

      spin.text = "Getting sign message...";

      const client = getKyberLimitOrderClient();

      // Get unsigned EIP-712 message (works without wallet)
      const { address: walletAddress } = requireWalletAndKeystore();

      const eip712 = await client.getSignMessage({
        chainId: String(chainId),
        makerAsset,
        takerAsset,
        maker: walletAddress,
        makingAmount,
        takingAmount,
        expiredAt,
      });

      spin.succeed("Order prepared");

      const orderInfo =
        `Chain: ${slug} (${chainId})\n` +
        `Sell: ${colors.value(options.makingAmount)} ${makerMeta.symbol} (${makerMeta.decimals} dec)\n` +
        `Receive: ${colors.value(options.takingAmount)} ${takerMeta.symbol} (${takerMeta.decimals} dec)\n` +
        `Expires: ${new Date(expiredAt * 1000).toISOString()}\n` +
        `Maker: ${walletAddress}`;

      if (options.dryRun) {
        if (isHeadless()) {
          writeJsonSuccess({
            dryRun: true, chain: slug, chainId, makerAsset, takerAsset,
            makingAmount, takingAmount, expiredAt, maker: walletAddress,
          });
        } else {
          infoBox("Limit Order Preview (Dry Run)", orderInfo);
        }
        return;
      }

      if (!options.yes) {
        throw new EchoError(ErrorCodes.CONFIRMATION_REQUIRED, "Add --yes to confirm (or --dry-run to preview)");
      }

      // Sign EIP-712 message (AFTER --yes check)
      const spinSign = spinner("Signing order...");
      spinSign.start();

      const { privateKey } = requireWalletAndKeystore();
      const signature = await signEip712Message(privateKey as Hex, eip712);

      spinSign.text = "Submitting order...";

      const result = await client.createOrder({
        chainId: String(chainId),
        makerAsset,
        takerAsset,
        maker: walletAddress,
        makingAmount,
        takingAmount,
        expiredAt,
        salt: eip712.message.salt,
        signature,
      });

      spinSign.succeed("Order created");

      if (isHeadless()) {
        writeJsonSuccess({
          orderId: result.orderId, chain: slug, chainId,
          makerAsset, takerAsset, makingAmount, takingAmount,
          expiredAt, maker: walletAddress,
        });
      } else {
        successBox("Limit Order Created", `${orderInfo}\nOrder ID: ${colors.info(String(result.orderId))}`);
      }
    });
}
