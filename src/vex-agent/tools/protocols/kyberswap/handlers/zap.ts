/**
 * KyberSwap ZaaS (Zap-as-a-Service) handlers — LP operations.
 *
 * Zap-in, zap-out, zap-migrate, and DEX catalog listing.
 *
 * Structural split (A-030): the per-operation handlers + shared approval/
 * position helpers now live under `./zap/`. This file stays a compatibility
 * façade assembling the per-operation handlers into the SAME `ZAP_HANDLERS`
 * Record with the SAME key names — preserving the registry coupling (the
 * spread in `kyberswap/handlers.ts`).
 */

import type { ProtocolHandler } from "../../types.js";
import { zapIn } from "./zap/in.js";
import { zapOut } from "./zap/out.js";
import { zapMigrate } from "./zap/migrate.js";
import { zapList } from "./zap/list.js";

// ── Handler map ──────────────────────────────────────────────────

export const ZAP_HANDLERS: Record<string, ProtocolHandler> = {
  "kyberswap.zap.in": zapIn,
  "kyberswap.zap.out": zapOut,
  "kyberswap.zap.migrate": zapMigrate,
  "kyberswap.zap.list": zapList,
};
