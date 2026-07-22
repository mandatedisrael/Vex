-- 042 — soul user profile: DB-backed "Vex setup" personalization, replacing
-- the retired local persona.md file mechanism entirely. The agent's own
-- display name is now the fixed literal "Vex"; these three columns hold the
-- USER's own preferences instead — read at hydration and rendered as
-- subordinate style guidance in the system prompt (never widens permissions,
-- same framing the old persona block used).
--
-- All three columns are nullable — an unconfigured profile degrades to an
-- unpersonalized prompt, never a failed hydration (see
-- `src/vex-agent/db/repos/soul.ts` getUserProfile/setUserProfile and
-- `engine/core/hydrate.ts`).
--
-- Length caps mirror the 020 pattern (DB CHECK as a safety margin behind the
-- renderer's own Zod caps in `vex-app/src/shared/schemas/user-profile.ts`):
--   - user_display_name: 40 chars ("What should Vex call you?")
--   - user_work_description: 120 chars ("What best describes your work?")
--   - user_instructions_md: 4000 chars ("Instructions for Vex")
--
-- Idempotent: re-running the file is a no-op (IF NOT EXISTS on columns,
-- scoped pg_constraint guard on each CHECK).

ALTER TABLE soul ADD COLUMN IF NOT EXISTS user_display_name TEXT;
ALTER TABLE soul ADD COLUMN IF NOT EXISTS user_instructions_md TEXT;
ALTER TABLE soul ADD COLUMN IF NOT EXISTS user_work_description TEXT;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'soul_user_display_name_len'
       AND conrelid = 'soul'::regclass
  ) THEN
    ALTER TABLE soul ADD CONSTRAINT soul_user_display_name_len
      CHECK (user_display_name IS NULL OR char_length(user_display_name) <= 40);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'soul_user_work_description_len'
       AND conrelid = 'soul'::regclass
  ) THEN
    ALTER TABLE soul ADD CONSTRAINT soul_user_work_description_len
      CHECK (user_work_description IS NULL OR char_length(user_work_description) <= 120);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'soul_user_instructions_md_len'
       AND conrelid = 'soul'::regclass
  ) THEN
    ALTER TABLE soul ADD CONSTRAINT soul_user_instructions_md_len
      CHECK (user_instructions_md IS NULL OR char_length(user_instructions_md) <= 4000);
  END IF;
END $$;
