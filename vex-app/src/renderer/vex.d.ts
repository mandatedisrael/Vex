/**
 * Global window.vex typing for renderer code.
 *
 * Source-of-truth contract: src/shared/types/bridge.ts (VexBridge interface).
 * Preload `satisfies VexBridge` enforces implementation parity.
 */

import type { VexBridge } from "../shared/types/bridge.js";

declare global {
  interface Window {
    readonly vex: VexBridge;
  }
}

export {};
