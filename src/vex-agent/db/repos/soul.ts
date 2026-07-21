/**
 * Soul repo — singleton agent identity.
 */

import { queryOne, execute } from "../client.js";
import { jsonb } from "../params.js";

interface SoulRow { content_md: string; pfp_url: string | null; updated_at: string }

export async function getSoul(): Promise<{ contentMd: string; pfpUrl: string | null } | null> {
  const row = await queryOne<SoulRow>("SELECT content_md, pfp_url FROM soul WHERE id = 1");
  if (!row || !row.content_md) return null;
  return { contentMd: row.content_md, pfpUrl: row.pfp_url };
}

export async function upsertSoul(contentMd: string, pfpUrl?: string): Promise<void> {
  await execute(
    `UPDATE soul SET content_md = $1, pfp_url = COALESCE($2, pfp_url), updated_at = NOW() WHERE id = 1`,
    [contentMd, pfpUrl ?? null],
  );
}

/**
 * User-configured "Vex setup" personalization — replaces the retired
 * persona.md file. `stylePreset`/`characteristics`/`riskAppetite` are
 * advisory-only (043): they NEVER affect approvals, permissions, or any
 * other safety/execution behavior. This repo layer stays string-loose —
 * enum membership is enforced at the IPC Zod boundary
 * (`vex-app/src/shared/schemas/user-profile.ts`) and defensively re-checked
 * (unknown tokens silently skipped) at prompt-render time
 * (`engine/prompts/identity.ts`).
 */
export interface UserProfile {
  readonly displayName: string | null;
  readonly instructionsMd: string | null;
  readonly workDescription: string | null;
  readonly stylePreset: string | null;
  /** Never null at this layer — an unset/invalid stored value reads back as `[]`. */
  readonly characteristics: readonly string[];
  readonly riskAppetite: string | null;
}

interface UserProfileRow {
  user_display_name: string | null;
  user_instructions_md: string | null;
  user_work_description: string | null;
  user_style_preset: string | null;
  user_risk_appetite: string | null;
  user_characteristics: unknown;
}

/**
 * `user_characteristics` is untrusted until validated (043 CHECK only
 * guarantees "JSON array", not "array of strings"). Anything other than a
 * JSON array of strings — wrong shape, corrupt row, pre-migration null —
 * degrades to "no traits set" rather than surfacing a bad value.
 */
function parseCharacteristics(raw: unknown): readonly string[] {
  if (!Array.isArray(raw)) return [];
  return raw.every((entry): entry is string => typeof entry === "string") ? raw : [];
}

/** Missing row (should not happen — `soul` is a seeded singleton) degrades to all-null/empty. */
export async function getUserProfile(): Promise<UserProfile> {
  const row = await queryOne<UserProfileRow>(
    `SELECT user_display_name, user_instructions_md, user_work_description,
            user_style_preset, user_risk_appetite, user_characteristics
       FROM soul WHERE id = 1`,
  );
  return {
    displayName: row?.user_display_name ?? null,
    instructionsMd: row?.user_instructions_md ?? null,
    workDescription: row?.user_work_description ?? null,
    stylePreset: row?.user_style_preset ?? null,
    riskAppetite: row?.user_risk_appetite ?? null,
    characteristics: parseCharacteristics(row?.user_characteristics ?? null),
  };
}

/** Full-set semantics — a null/empty field CLEARS the stored value, it does not skip it. */
export async function setUserProfile(profile: UserProfile): Promise<void> {
  await execute(
    `UPDATE soul SET user_display_name = $1, user_instructions_md = $2, user_work_description = $3,
       user_style_preset = $4, user_risk_appetite = $5, user_characteristics = $6::jsonb,
       updated_at = NOW()
     WHERE id = 1`,
    [
      profile.displayName,
      profile.instructionsMd,
      profile.workDescription,
      profile.stylePreset,
      profile.riskAppetite,
      jsonb(profile.characteristics),
    ],
  );
}
