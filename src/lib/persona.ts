/**
 * User-configurable persona — a LOCAL-FIRST, user-authored file that sets the
 * agent's display name and an optional free-form persona/tone block injected
 * into the system prompt.
 *
 * Lives under `src/lib` (zero root path-alias dependencies — node + npm only)
 * so BOTH the local agent runtime (`src/vex-agent`) and the Electron main
 * process (`vex-app`, via the `@vex-lib` alias) can consume it. The file path
 * is passed in by the caller so this module stays free of any CONFIG_DIR
 * coupling — both sides resolve the same `CONFIG_DIR/persona.md`.
 *
 * Format: markdown, human-editable. The agent name is read from a leading
 * `name:` line (the first non-empty line); everything after it is the persona
 * body:
 *
 *   name: Aria
 *
 *   Tone: concise, dry, no emoji.
 *   Always state risk before acting.
 *
 * Trust model: this is the user's OWN config on their OWN machine — NOT a
 * hostile injection surface — so it is NOT heavy-sanitized. We DO bound its
 * size (it shares the system-prompt token budget) and fall back to safe
 * defaults when the file is absent / empty / oversized / malformed. The real
 * prompt-injection defense belongs on TOOL-OUTPUT ingestion, not here.
 *
 * The persona shapes NAME + TONE only. It can NOT widen permissions or bypass
 * approval / wallet / mutating gates — those are enforced in code (dispatcher /
 * approval runtime), and the persona block is rendered as subordinate style
 * guidance after the authoritative safety layers in the system prompt.
 */

import { existsSync, readFileSync } from "node:fs";
import { z } from "zod";

/** Default agent name when no persona is configured. Verbatim casing. */
export const DEFAULT_PERSONA_NAME = "Vex";

/** Agent name is a short label that lands in prompts + window chrome. */
const NAME_MAX_CHARS = 24;
/** Body caps — bound the system-prompt token budget (~120 lines / ~4k chars). */
const PERSONA_MAX_LINES = 120;
const PERSONA_MAX_CHARS = 4000;

export interface Persona {
  /** Display / identity name. Defaults to {@link DEFAULT_PERSONA_NAME}. */
  readonly name: string;
  /** Free-form persona / tone block, or `null` when none is configured. */
  readonly block: string | null;
  /**
   * True when the user actually configured a persona (a `name:` line OR a body
   * was parsed). Distinguishes a name-only file from an absent/empty one so the
   * one-time setup offer never fires for users who already personalized.
   */
  readonly configured: boolean;
}

const personaSchema = z.object({
  name: z.string().min(1).max(NAME_MAX_CHARS),
  block: z.string().max(PERSONA_MAX_CHARS).nullable(),
  configured: z.boolean(),
});

/** `name: <value>` on the first non-empty line. Case-insensitive key. */
const NAME_LINE = /^\s*name\s*:\s*(.+?)\s*$/i;

function defaultPersona(): Persona {
  return { name: DEFAULT_PERSONA_NAME, block: null, configured: false };
}

/**
 * Parse raw `persona.md` text into a {@link Persona}. Pure (no IO). Exported
 * for unit tests. Invalid/oversized input degrades to safe defaults rather
 * than throwing — a broken persona file must never break the agent.
 */
export function parsePersona(raw: string): Persona {
  const lines = raw.split(/\r?\n/);

  let name = DEFAULT_PERSONA_NAME;
  let nameFound = false;
  let bodyStart = 0;

  const firstContent = lines.findIndex((l) => l.trim().length > 0);
  if (firstContent >= 0) {
    const match = lines[firstContent]!.match(NAME_LINE);
    if (match && match[1]) {
      name = match[1].trim().slice(0, NAME_MAX_CHARS).trim() || DEFAULT_PERSONA_NAME;
      nameFound = true;
      bodyStart = firstContent + 1;
    } else {
      // No leading `name:` — keep the default name; everything is body.
      bodyStart = firstContent;
    }
  }

  const cappedBody = lines
    .slice(bodyStart, bodyStart + PERSONA_MAX_LINES)
    .join("\n")
    .trim()
    .slice(0, PERSONA_MAX_CHARS)
    .trim();
  const block = cappedBody.length > 0 ? cappedBody : null;
  // "Configured" = the user touched the file meaningfully (named the agent OR
  // wrote a persona body). A name-only file counts as configured.
  const configured = nameFound || block !== null;

  const parsed = personaSchema.safeParse({ name, block, configured });
  return parsed.success ? parsed.data : defaultPersona();
}

/**
 * Load the persona from `filePath` (the caller passes its own
 * `CONFIG_DIR/persona.md`). Best-effort: a missing / unreadable / malformed
 * file yields the default persona ({@link DEFAULT_PERSONA_NAME}, no block).
 * Never throws — the deliberate graceful fallback is the contract.
 */
export function loadPersona(filePath: string): Persona {
  try {
    if (!existsSync(filePath)) return defaultPersona();
    return parsePersona(readFileSync(filePath, "utf-8"));
  } catch {
    return defaultPersona();
  }
}
