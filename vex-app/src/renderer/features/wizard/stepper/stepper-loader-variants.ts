/**
 * Per-step DotMatrix loader signature — every wizard step has its own
 * shape × color pairing so the horizontal stepper gives each step a
 * distinct visual identity instead of seven identical dots.
 *
 * Shape pairings carry light metaphor: Hex for embedding (vector
 * lattice), Circular for wallets/agentCore (loop / cycle), Square for
 * the rest. Color presets reuse `DotMatrixColorPreset` from the owned
 * `dotmatrix-core` primitive — no new dependency, no new gradient
 * tokens.
 *
 * `provider` deliberately uses `grad-sunset` (warm gold) rather than
 * `grad-fire` so it doesn't read as a warning state next to the
 * active-step accent (codex review V2 #5).
 */

import type { ComponentType } from "react";

import { DotmCircular8 } from "../../../components/ui/dotm-circular-8.js";
import { DotmHex3 } from "../../../components/ui/dotm-hex-3.js";
import { DotmSquare3 } from "../../../components/ui/dotm-square-3.js";
import type {
  DotMatrixColorPreset,
  DotMatrixCommonProps,
} from "../../../components/ui/dotmatrix-core.js";
import type { WizardStepId } from "@shared/schemas/wizard.js";

export interface StepperLoaderVariant {
  readonly Component: ComponentType<DotMatrixCommonProps>;
  readonly colorPreset: DotMatrixColorPreset;
}

export const STEPPER_LOADER_VARIANTS: Readonly<
  Record<WizardStepId, StepperLoaderVariant>
> = {
  keystore: { Component: DotmSquare3, colorPreset: "solid-theme" },
  wallets: { Component: DotmCircular8, colorPreset: "grad-ocean" },
  apiKeys: { Component: DotmSquare3, colorPreset: "solid-mint" },
  embedding: { Component: DotmHex3, colorPreset: "grad-aurora" },
  agentCore: { Component: DotmCircular8, colorPreset: "grad-prism" },
  provider: { Component: DotmSquare3, colorPreset: "grad-sunset" },
  review: { Component: DotmSquare3, colorPreset: "grad-neon" },
};
