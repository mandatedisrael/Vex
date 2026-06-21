/**
 * KyberSwap ZaaS zap-list handler — `kyberswap.zap.list`.
 *
 * Supported DEXes per chain — structured catalog.
 */

import { resolveChainSlug } from "@tools/kyberswap/chains.js";

import type { ProtocolHandler } from "../../../types.js";
import { str, ok, fail } from "../../../handler-helpers.js";

// ── Zap list (supported DEXes per chain — structured catalog) ───
export const zapList: ProtocolHandler = async (p) => {
  const chain = str(p, "chain");
  if (!chain) return fail("Missing required: chain");
  const slug = resolveChainSlug(chain);

  const { getZapDexConfig } = await import("@tools/kyberswap/zaas/zap-dexes/index.js");
  const config = getZapDexConfig(slug);

  if (!config || config.dexes.length === 0) {
    return ok({ chain: slug, count: 0, dexes: [], note: `No ZaaS DEXes configured for ${slug}. Check KyberSwap ZaaS docs for supported chains.` });
  }

  return ok({
    chain: slug,
    lastVerified: config.lastVerified,
    count: config.dexes.length,
    dexes: config.dexes.map(d => ({
      id: d.id,
      name: d.name,
      supports: d.supports,
      verification: d.verification,
      positionRefKind: d.positionRefKind,
    })),
  });
};
