import type { Result } from "../../../ipc/result.js";
import type { HyperliquidSettingsUpdateInput } from "../../../schemas/hyperliquid.js";
import type { Preferences } from "../../../schemas/preferences.js";
import type { UserProfile } from "../../../schemas/user-profile.js";

export interface SettingsBridge {
  readonly getPreferences: () => Promise<Result<Preferences>>;
  readonly setTelemetryConsent: (input: {
    readonly enabled: boolean;
  }) => Promise<Result<Preferences>>;
  readonly setHyperliquidPolicy: (
    input: HyperliquidSettingsUpdateInput,
  ) => Promise<Result<Preferences>>;
  /** "Vex setup" user profile — DB-backed (soul singleton), replaces persona.md. */
  readonly getUserProfile: () => Promise<Result<UserProfile>>;
  readonly setUserProfile: (profile: UserProfile) => Promise<Result<UserProfile>>;
}
