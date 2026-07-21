/**
 * "Vex setup" user profile — DB-backed personalization (soul singleton),
 * replacing the retired local `persona.md` file mechanism. The agent's own
 * name is always "Vex"; these fields are the USER's own preferences,
 * injected into the system prompt as subordinate style guidance (see
 * `src/vex-agent/engine/prompts/identity.ts`).
 *
 * One schema serves both the `vex.settings.getUserProfile` output and the
 * `vex.settings.setUserProfile` input — full-set semantics, a `null` field
 * (or, for `characteristics`, an empty array) clears the stored value
 * rather than leaving it untouched.
 *
 * `stylePreset`/`characteristics`/`riskAppetite` (043) are advisory-only —
 * they NEVER affect approvals, permissions, or any other safety/execution
 * behavior. Each is enum-constrained here (the canonical enforcement point);
 * the DB layer (`src/vex-agent/db/repos/soul.ts`) stays string-loose and the
 * prompt renderer (`identity.ts`) defensively skips unknown tokens.
 *
 * The three new fields are `.optional()` (NOT `z.default()`): a zod
 * `.default()` removes `undefined` from this schema's INFERRED `UserProfile`
 * type, which would make the field required everywhere `UserProfile` is used
 * — including the CURRENT `VexSetupDialog`/`SidebarProfile` read+write call
 * sites and their locked tests, which only construct 3-field objects. Marking
 * the fields `.optional()` keeps that single `UserProfile` type valid for
 * both the old 3-field shape and the new 6-field one; the IPC `setUserProfile`
 * handler (`main/ipc/settings.ts`) is the one place that coalesces an omitted
 * field to its concrete "unset" value (`null` / `[]`) before the full-set
 * repo write.
 */

import { z } from "zod";

/** Canonical tone-preset literals (043). */
export const STYLE_PRESETS = [
  "default",
  "professional",
  "friendly",
  "frank",
  "quirky",
  "concise",
  "cynical",
] as const;

/** Canonical style-trait literals (043). */
export const CHARACTERISTICS = [
  "warm",
  "enthusiastic",
  "headers_lists",
  "emoji",
] as const;

/** Canonical risk-appetite literals (043). */
export const RISK_APPETITES = ["conservative", "balanced", "aggressive"] as const;

export const userProfileSchema = z
  .object({
    /** "What should Vex call you?" */
    displayName: z.string().trim().min(1).max(40).nullable(),
    /** "Instructions for Vex" — free-form standing style/preference notes. */
    instructionsMd: z.string().trim().min(1).max(4000).nullable(),
    /** "What best describes your work?" */
    workDescription: z.string().trim().min(1).max(120).nullable(),
    /** Optional (see file header) — omitted or `null` both mean "unset". */
    stylePreset: z.enum(STYLE_PRESETS).nullable().optional(),
    /** Optional (see file header) — omitted or `[]` both mean "no traits set". */
    characteristics: z
      .array(z.enum(CHARACTERISTICS))
      .max(4)
      .refine((values) => new Set(values).size === values.length, {
        message: "Characteristics must be unique.",
      })
      .optional(),
    /** Optional (see file header) — omitted or `null` both mean "unset". */
    riskAppetite: z.enum(RISK_APPETITES).nullable().optional(),
  })
  .strict();

export type UserProfile = z.infer<typeof userProfileSchema>;
