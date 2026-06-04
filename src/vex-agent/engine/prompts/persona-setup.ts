/**
 * One-time persona-setup offer.
 *
 * Rendered ONLY on the first reply of a session whose persona is unconfigured
 * (no persona block) — the agent runner transcript-gates it so it never
 * repeats. Nudges the agent to briefly offer personalization.
 *
 * SECURITY/PRIVACY: never embed an absolute path here. Absolute config paths
 * (e.g. `~/.config/vex/...`) would leak the local username to the inference
 * provider. We reference the file generically ("the Vex config folder"); the
 * exact path stays in local UI / main-process surfaces only.
 */

import { DEFAULT_PERSONA_NAME } from "../../../lib/persona.js";

export function buildPersonaSetupHint(name: string = DEFAULT_PERSONA_NAME): string {
  return [
    "# Personalize me (optional)",
    "",
    `No persona is configured yet, so I'm running with defaults (name: "${name}").`,
    "On THIS first reply, briefly and naturally offer to personalize — the user",
    "can give me a different name and a response tone/style by creating a short",
    "`persona.md` in the Vex config folder. Mention it once; do not nag, and do",
    "not block the user's actual request on it.",
  ].join("\n");
}
