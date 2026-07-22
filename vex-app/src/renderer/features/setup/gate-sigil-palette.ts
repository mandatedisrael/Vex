/**
 * The Chronos Gate sigil palette — paper body with white/ice sparks.
 * Periwinkle would sink into the cobalt plate, so every surface on the
 * cobalt continuum (SetupGate, UnlockScreen) shares this spark pair.
 *
 * Single-sourced here (AMENDMENT A2 §3) so gate consumers never
 * duplicate the three canvas paint channels.
 */

import type { SigilPalette } from "../appShell/VexSigil.js";

/** Paper body ("243,244,247") with white and ice sparks. */
export const GATE_SIGIL_PALETTE: SigilPalette = [
  "243,244,247",
  "255,255,255",
  "214,222,255",
];
