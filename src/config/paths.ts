import { homedir, platform } from "node:os";
import { isAbsolute, join } from "node:path";

const APP_NAME = "vex";

function getConfigDir(): string {
  // Test/CI override — accept an explicit absolute path so Playwright
  // (and any future integration harness) can isolate state per spec
  // without touching ~/.config or %APPDATA%. Must be non-empty AND
  // absolute; a relative value silently falls through to the platform
  // default so a typo can't redirect production writes into the cwd.
  const override = process.env.VEX_CONFIG_DIR;
  if (
    typeof override === "string" &&
    override.length > 0 &&
    isAbsolute(override)
  ) {
    return override;
  }

  const plat = platform();

  if (plat === "win32") {
    // Windows: %APPDATA%/vex
    const appData = process.env.APPDATA ?? join(homedir(), "AppData", "Roaming");
    return join(appData, APP_NAME);
  }

  if (plat === "darwin") {
    // macOS: ~/Library/Application Support/vex
    return join(homedir(), "Library", "Application Support", APP_NAME);
  }

  // Linux/Unix: ~/.config/vex
  const xdgConfig = process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config");
  return join(xdgConfig, APP_NAME);
}

export const CONFIG_DIR = getConfigDir();
export const CONFIG_FILE = join(CONFIG_DIR, "config.json");
/** User-authored persona file (name + tone) injected into the system prompt. */
export const PERSONA_FILE = join(CONFIG_DIR, "persona.md");
export const KEYSTORE_FILE = join(CONFIG_DIR, "keystore.json");
export const SOLANA_KEYSTORE_FILE = join(CONFIG_DIR, "solana-keystore.json");
export const INTENTS_DIR = join(CONFIG_DIR, "intents");
export const JWT_FILE = join(CONFIG_DIR, "jwt.json");
// App-specific .env (provider-neutral)
export const ENV_FILE = join(CONFIG_DIR, ".env");
export const SECRETS_VAULT_FILE = join(CONFIG_DIR, "secrets.vault.json");

// Backup paths
export const BACKUPS_DIR = join(CONFIG_DIR, "backups");

// Bot paths
export const BOT_DIR = join(CONFIG_DIR, "bot");
export const BOT_ORDERS_FILE = join(BOT_DIR, "orders.json");
export const BOT_STATE_FILE = join(BOT_DIR, "state.json");
export const BOT_PID_FILE = join(BOT_DIR, "bot.pid");
export const BOT_SHUTDOWN_FILE = join(BOT_DIR, "bot.shutdown");
export const BOT_LOG_FILE = join(BOT_DIR, "bot.log");
export const BOT_STOPPED_FILE = join(BOT_DIR, "bot.stopped");

// Launcher paths
export const LAUNCHER_DIR = join(CONFIG_DIR, "launcher");
export const LAUNCHER_PID_FILE = join(LAUNCHER_DIR, "launcher.pid");
export const LAUNCHER_LOG_FILE = join(LAUNCHER_DIR, "launcher.log");
export const LAUNCHER_STOPPED_FILE = join(LAUNCHER_DIR, "launcher.stopped");
export const LAUNCHER_DEFAULT_PORT = 4200;
export const CONNECTORS_DIR = join(CONFIG_DIR, "connectors");

// Solana paths
export const SOLANA_TOKEN_CACHE_FILE = join(CONFIG_DIR, "solana-token-cache.json");
