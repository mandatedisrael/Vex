/** Main-owned Hypervexing workspace state and renderer broadcast boundary. */

import {
  hyperliquidWorkspaceModeEventSchema,
  type HyperliquidWorkspaceModeEvent,
} from "@shared/schemas/hyperliquid.js";
import { EV } from "@shared/ipc/channels.js";
import { broadcastToAllWindows } from "../lifecycle/broadcast.js";
import { preferencesStore } from "../preferences/store.js";
import { registerHlWorkspaceModeProvider } from "@vex-lib/hyperliquid-workspace-mode.js";

export type HyperliquidWorkspaceMode = HyperliquidWorkspaceModeEvent["mode"];

let transitionChain: Promise<void> = Promise.resolve();
const modesBySession = new Map<string, HyperliquidWorkspaceMode>();

/**
 * Register the main-owned, transient session map before the engine starts.
 * Modes are deliberately not persisted: a relaunch begins in normal mode.
 */
export function initializeHyperliquidWorkspaceModeProvider(): void {
  registerHlWorkspaceModeProvider((sessionId) => modesBySession.get(sessionId) ?? "normal");
}

/** Test/shutdown helper. It never writes persisted preferences. */
export function resetHyperliquidWorkspaceModes(): void {
  modesBySession.clear();
}

/** Read the current transient mode without mutating or broadcasting it. */
export function resolveHyperliquidWorkspaceMode(sessionId: string): HyperliquidWorkspaceMode {
  return modesBySession.get(sessionId) ?? "normal";
}

/** Session ids currently eligible for Hypervexing-only main-process work. */
export function listHypervexingSessionIds(): readonly string[] {
  return [...modesBySession]
    .filter(([, mode]) => mode === "hypervexing")
    .map(([sessionId]) => sessionId);
}

/** Serialize requests so a slower preference read cannot reorder enter/exit. */
export function requestHyperliquidWorkspaceMode(
  sessionId: string,
  mode: HyperliquidWorkspaceMode,
): Promise<HyperliquidWorkspaceModeEvent> {
  const result = transitionChain.then(async () => {
    const preferences = await preferencesStore.load();
    const event = hyperliquidWorkspaceModeEventSchema.parse({
      sessionId,
      mode,
      requestedBy: "agent",
      acknowledged: preferences.hyperliquid.riskAcknowledgedAt !== null,
    });
    if (resolveHyperliquidWorkspaceMode(sessionId) === mode) {
      return event;
    }
    // Main updates the source of truth before notifying the renderer. The
    // next engine request for this same session therefore sees the identical
    // state regardless of whether it came from an agent request or manual exit.
    // Normal is the provider default, so do not retain an entry after exit.
    // This keeps the transient map bounded across a long-lived desktop run.
    if (mode === "hypervexing") modesBySession.set(sessionId, mode);
    else modesBySession.delete(sessionId);
    broadcastToAllWindows(EV.hyperliquid.workspaceMode, event);
    return event;
  });
  transitionChain = result.then(() => undefined, () => undefined);
  return result;
}
