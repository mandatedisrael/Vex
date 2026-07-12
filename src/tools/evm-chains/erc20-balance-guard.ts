/**
 * Shared preflight for ERC-20 debits made by protocol routers.
 *
 * The token address is always included in an error. Contract and provider
 * metadata is untrusted, so any optional display label is bounded and stripped
 * to a safe display-only character set before it reaches agent-visible output.
 */

import { formatUnits, type Address, type PublicClient } from "viem";

import { ErrorCodes, VexError } from "../../errors.js";
import { ERC20_READ_ABI } from "./balances.js";

export type Erc20BalanceClient = Pick<PublicClient, "readContract">;

export interface Erc20BalanceRequest {
  readonly token: Address;
  readonly owner: Address;
  readonly required: bigint;
  readonly decimals: number;
  readonly label?: string;
}

function sanitizeDisplayLabel(label: string | undefined): string | undefined {
  if (!label) return undefined;
  const safe = label.replace(/[^A-Za-z0-9 _.-]/g, "").slice(0, 16).trim();
  return safe || undefined;
}

/**
 * Fail before an approval or router call when the selected wallet lacks the
 * required ERC-20 input balance. The chain remains authoritative at execution
 * time; this avoids spending gas on a known-over-balance transferFrom revert.
 */
export async function ensureErc20Balance(
  client: Erc20BalanceClient,
  request: Erc20BalanceRequest,
): Promise<void> {
  const balance = await client.readContract({
    address: request.token,
    abi: ERC20_READ_ABI,
    functionName: "balanceOf",
    args: [request.owner],
  });

  if (balance >= request.required) return;

  const label = sanitizeDisplayLabel(request.label);
  const displayName = label ? ` (${label})` : "";
  throw new VexError(
    ErrorCodes.INSUFFICIENT_BALANCE,
    `Insufficient balance for token ${request.token}${displayName}: have ${formatUnits(balance, request.decimals)}, requested ${formatUnits(request.required, request.decimals)}.`,
    "Reduce the amount to at most the wallet balance and retry.",
  );
}
