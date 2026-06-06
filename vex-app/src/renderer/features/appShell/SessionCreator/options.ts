/**
 * Static option catalogues for the New-session modal mode/permission
 * radio grids (extracted from `SessionCreator.tsx`). Each option mirrors a
 * value from the IPC session schema discriminated union and carries the
 * presentational copy + icon the {@link RadioCard} renders.
 */

import type { IconSvgElement } from "@hugeicons/react";
import {
  AiChat01Icon,
  Shield02Icon,
  Target02Icon,
  ZapIcon,
} from "@hugeicons/core-free-icons";
import type {
  SessionMode,
  SessionPermission,
} from "@shared/schemas/sessions.js";

export interface ModeOption {
  readonly value: SessionMode;
  readonly title: string;
  readonly description: string;
  readonly icon: IconSvgElement;
}

export const MODE_OPTIONS: ReadonlyArray<ModeOption> = [
  {
    value: "agent",
    title: "Agent",
    description: "One-shot conversation. Vex stays in chat, no loop.",
    icon: AiChat01Icon,
  },
  {
    value: "mission",
    title: "Mission",
    description:
      "Goal-driven loop. Vex pursues a target and can self-schedule wakes.",
    icon: Target02Icon,
  },
];

export interface PermissionOption {
  readonly value: SessionPermission;
  readonly title: string;
  readonly description: string;
  readonly icon: IconSvgElement;
}

export const PERMISSION_OPTIONS: ReadonlyArray<PermissionOption> = [
  {
    value: "restricted",
    title: "Restricted",
    description: "Every mutating transaction requires your approval.",
    icon: Shield02Icon,
  },
  {
    value: "full",
    title: "Full access",
    description: "Auto-execute approved tools without prompting per call.",
    icon: ZapIcon,
  },
];
