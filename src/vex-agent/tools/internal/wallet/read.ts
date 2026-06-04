/**
 * Wallet read handler — live balance snapshot for configured wallets.
 */

import { z } from "zod";
import { resolveSelectedAddress } from "./resolve.js";
import {
  type BalanceChainSelection,
  getSelectedChainIdsForFamily,
  getTokenBalancesAcrossChains,
  parseBalanceChainSelection,
} from "@tools/khalani/balances.js";
import type { ChainFamily } from "@tools/khalani/types.js";

import type { ToolResult } from "../../types.js";
import type { InternalToolContext } from "../types.js";
import { fail, ok } from "../types.js";

const WalletReadArgs = z.object({
  wallet: z.enum(["eip155", "solana", "all"]).optional().default("all"),
  // Empty / whitespace-only `chainIds` is treated as omission (scan all chains).
  // LLM serializers often emit `""` for "no value" — see plan PR-balance-toolkit.
  chainIds: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z.string().trim().min(1, { message: "chainIds must be a non-empty comma-separated string" }).optional(),
  ),
}).strict();

interface WalletSnapshot {
  wallet: ChainFamily;
  address: string;
  tokenCount: number;
  totalUsd: number;
  scannedChainIds: number[];
  chainErrors: Array<{ chainId: number; chainName?: string; message: string }>;
  tokens: unknown[];
}

// ── wallet_balances ─────────────────────────────────────────────

export async function handleWalletBalances(
  params: Record<string, unknown>,
  context: InternalToolContext,
): Promise<ToolResult> {
  const parsed = WalletReadArgs.safeParse(params);
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    return fail(`wallet_balances: ${firstIssue?.message ?? "invalid arguments"}`);
  }

  let selection: BalanceChainSelection;
  try {
    selection = await parseBalanceChainSelection(parsed.data.chainIds);
  } catch (err) {
    return fail(`wallet_balances: ${err instanceof Error ? err.message : String(err)}`);
  }
  const walletFamilies = requestedWalletFamilies(parsed.data.wallet);
  const snapshots: WalletSnapshot[] = [];
  const walletErrors: Array<{ wallet: ChainFamily; message: string }> = [];

  for (const family of walletFamilies) {
    const chainIds = getSelectedChainIdsForFamily(selection, family);
    if (selection.rawProvided && chainIds?.length === 0) {
      if (parsed.data.wallet === family) {
        return fail(`wallet_balances: no ${family} chains matched chainIds="${parsed.data.chainIds}".`);
      }
      continue;
    }

    try {
      const address = resolveSelectedAddress(context.walletResolution, context.walletPolicy, family);
      const scan = await getTokenBalancesAcrossChains({ address, family, chainIds });
      snapshots.push({
        wallet: family,
        address,
        tokenCount: scan.tokens.length,
        totalUsd: scan.totalUsd,
        scannedChainIds: scan.scannedChainIds,
        chainErrors: scan.chainErrors,
        tokens: scan.tokens,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (parsed.data.wallet === family) {
        return fail(`${family} wallet error: ${message}`);
      }
      walletErrors.push({ wallet: family, message });
    }
  }

  if (snapshots.length === 0) {
    return fail(`wallet_balances: no requested wallet snapshots were available.${formatWalletErrors(walletErrors)}`);
  }

  return ok({
    wallet: parsed.data.wallet,
    walletCount: snapshots.length,
    totalUsd: snapshots.reduce((sum, snapshot) => sum + snapshot.totalUsd, 0),
    walletErrors,
    wallets: snapshots,
  });
}

function requestedWalletFamilies(wallet: "eip155" | "solana" | "all"): ChainFamily[] {
  if (wallet === "all") return ["eip155", "solana"];
  return [wallet];
}

function formatWalletErrors(errors: Array<{ wallet: ChainFamily; message: string }>): string {
  if (errors.length === 0) return "";
  return ` Errors: ${errors.map((entry) => `${entry.wallet}: ${entry.message}`).join("; ")}`;
}
