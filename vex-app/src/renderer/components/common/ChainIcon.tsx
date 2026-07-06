/**
 * Chain mark — resolves a `proj_balances` chain id to its visual mark for the
 * POSITION chain switcher, deposit-address rows, and the "see more" network
 * dialog.
 *
 * Icon source order (curated in `@shared/chains/display.js`, the serializable
 * metadata both trust zones read):
 *  - `thesvg`   — a verified `@thesvg/react` brand component (ethereum,
 *                 solana, base, robinhood, polygon, optimism, bnb-chain);
 *  - `asset`    — a renderer publicDir SVG for chains the package lacks
 *                 (arbitrum → `/logo/arbitrum.svg`);
 *  - `fallback` — a neutral mono monogram ring (first glyph of the chain
 *                 name) so an uncatalogued chain never renders blank.
 *
 * Marks are decorative (`aria-hidden`): interactive callers own the
 * accessible name (button `aria-label`s), matching ModelBrandIcon's pattern.
 */

import type { JSX } from "react";
import {
  BnbChain,
  Ethereum,
  Optimism,
  Polygon,
  Robinhood,
  Solana,
} from "@thesvg/react";
import {
  chainDisplay,
  type ChainSvgKey,
} from "@shared/chains/display.js";
import { cn } from "../../lib/utils.js";

type BrandIcon = typeof Ethereum;

const THESVG_BY_KEY: Readonly<Record<ChainSvgKey, BrandIcon>> = {
  ethereum: Ethereum,
  solana: Solana,
  robinhood: Robinhood,
  polygon: Polygon,
  optimism: Optimism,
  "bnb-chain": BnbChain,
};

export function ChainIcon({
  chainId,
  size = 14,
  className,
}: {
  readonly chainId: number;
  readonly size?: number;
  readonly className?: string;
}): JSX.Element {
  const display = chainDisplay(chainId);
  if (display.icon.kind === "thesvg") {
    const Icon = THESVG_BY_KEY[display.icon.key];
    return (
      <Icon
        width={size}
        height={size}
        aria-hidden
        focusable={false}
        className={cn("shrink-0", className)}
      />
    );
  }
  if (display.icon.kind === "asset") {
    return (
      <img
        src={display.icon.src}
        alt=""
        aria-hidden
        width={size}
        height={size}
        draggable={false}
        className={cn("block shrink-0", className)}
      />
    );
  }
  return (
    <span
      aria-hidden
      style={{ width: size, height: size, fontSize: Math.round(size * 0.55) }}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full border border-[var(--vex-line-strong)] font-mono uppercase leading-none text-[var(--vex-text-3)]",
        className,
      )}
    >
      {display.name.charAt(0)}
    </span>
  );
}
