/**
 * Pendle protocol handlers — aggregates the read + PT module handler maps.
 */

import type { ProtocolHandler } from "../types.js";
import { PENDLE_READ_HANDLERS } from "./handlers/read.js";
import { PENDLE_PT_HANDLERS } from "./handlers/pt.js";

export const PENDLE_HANDLERS: Record<string, ProtocolHandler> = {
  ...PENDLE_READ_HANDLERS,
  ...PENDLE_PT_HANDLERS,
};
