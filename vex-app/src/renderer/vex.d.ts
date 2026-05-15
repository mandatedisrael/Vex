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

  /**
   * App version injected at build time via vite.renderer.config.ts `define`.
   * Reads from `vex-app/package.json` `version` field. Renderer never imports
   * package.json directly — keeps devDependency listings out of the bundle.
   */
  const __VEX_APP_VERSION__: string;
}

export {};
