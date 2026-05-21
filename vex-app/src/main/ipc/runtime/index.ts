/**
 * Runtime IPC handlers — barrel.
 *
 * Mirrors the puzzle-1 `ipc/sessions/` per-handler pattern. Each
 * handler lives in its own module; this barrel returns the array of
 * teardowns so `register-all.ts` can spread it into `globalCleanup`
 * without knowing the per-handler layout.
 *
 * The parent `ipc/runtime.ts` is a thin shim that re-exports
 * `registerRuntimeHandlers` from here (Node ESM `NodeNext` does NOT
 * auto-resolve `runtime.js` to a sibling directory's `index.ts`, so
 * the shim is required for the existing
 * `import { registerRuntimeHandlers } from "./runtime.js"` call site).
 */

import { registerRuntimeCancelWakeHandler } from "./cancel-wake.js";
import { registerRuntimeGetStateHandler } from "./get-state.js";
import { registerRuntimeRequestPauseHandler } from "./request-pause.js";
import { registerRuntimeRequestResumeHandler } from "./request-resume.js";
import { registerRuntimeRequestStopHandler } from "./request-stop.js";

export function registerRuntimeHandlers(): ReadonlyArray<() => void> {
  return [
    registerRuntimeGetStateHandler(),
    registerRuntimeRequestPauseHandler(),
    registerRuntimeRequestStopHandler(),
    registerRuntimeRequestResumeHandler(),
    registerRuntimeCancelWakeHandler(),
  ];
}
