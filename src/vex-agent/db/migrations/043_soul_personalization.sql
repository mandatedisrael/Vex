-- 043 — soul personalization: extends the "Vex setup" user profile (042)
-- with three advisory personalization fields — a tone preset, a small set of
-- style traits, and a self-described risk appetite. All three are rendered
-- as subordinate style guidance in the system prompt (see
-- `src/vex-agent/engine/prompts/identity.ts`) and NEVER affect approvals,
-- permissions, or any other safety/execution behavior.
--
-- All three columns are nullable — an unconfigured value degrades exactly
-- like 042's fields (see `src/vex-agent/db/repos/soul.ts`
-- getUserProfile/setUserProfile and `engine/core/hydrate.ts`).
--
-- Enum membership (stylePreset/characteristics/riskAppetite) is enforced at
-- the IPC Zod boundary (`vex-app/src/shared/schemas/user-profile.ts`); these
-- DB CHECK constraints are a defensive length/shape margin only, mirroring
-- the 020/042 pattern:
--   - user_style_preset: TEXT, <=24 chars (longest literal is "professional", 12 chars)
--   - user_risk_appetite: TEXT, <=24 chars (longest literal is "conservative", 12 chars)
--   - user_characteristics: JSONB, must be a JSON array when present
--
-- Idempotent: re-running the file is a no-op (IF NOT EXISTS on columns,
-- scoped pg_constraint guard on each CHECK).

ALTER TABLE soul ADD COLUMN IF NOT EXISTS user_style_preset TEXT;
ALTER TABLE soul ADD COLUMN IF NOT EXISTS user_risk_appetite TEXT;
ALTER TABLE soul ADD COLUMN IF NOT EXISTS user_characteristics JSONB;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'soul_user_style_preset_len'
       AND conrelid = 'soul'::regclass
  ) THEN
    ALTER TABLE soul ADD CONSTRAINT soul_user_style_preset_len
      CHECK (user_style_preset IS NULL OR char_length(user_style_preset) <= 24);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'soul_user_risk_appetite_len'
       AND conrelid = 'soul'::regclass
  ) THEN
    ALTER TABLE soul ADD CONSTRAINT soul_user_risk_appetite_len
      CHECK (user_risk_appetite IS NULL OR char_length(user_risk_appetite) <= 24);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'soul_user_characteristics_is_array'
       AND conrelid = 'soul'::regclass
  ) THEN
    ALTER TABLE soul ADD CONSTRAINT soul_user_characteristics_is_array
      CHECK (user_characteristics IS NULL OR jsonb_typeof(user_characteristics) = 'array');
  END IF;
END $$;
