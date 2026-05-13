/**
 * API keys step — collects the protocol auth secrets the agent can use.
 *
 * Required: JUPITER_API_KEY (bootstrap-gated — user cannot proceed without).
 * Optional: TAVILY (web_research), RETTIWT (twitter_account),
 * POLYMARKET CLOB trio
 *   (POLYMARKET_API_KEY + POLYMARKET_API_SECRET + POLYMARKET_PASSPHRASE —
 *   `requirePolyClobCredentials` fails on any missing).
 *
 * The wizard does NOT auto-generate Polymarket creds (that's the
 * `polymarket_setup` tool's job); we only record whatever the operator
 * provides.
 */

import { confirm, isCancel, log, password, text } from "@clack/prompts";
import { readAppEnvMap } from "../../../src/cli/setup/status.js";
import { writeAppEnvValue } from "../../../src/providers/env-resolution.js";
import { synchronizeTrackedEnv } from "../../../src/cli/setup/setup.js";

export interface ApiKeysOutcome {
  aborted: boolean;
  jupiterConfigured: boolean;
  tavilyConfigured: boolean;
  rettiwtConfigured: boolean;
  polymarketConfigured: boolean;
}

const RETTIWT_AUTH_GUIDANCE = [
  "RETTIWT_API_KEY enables twitter_account read-only Twitter/X research.",
  "Use a secondary X account. The key is a base64 cookie-session secret.",
  "Generate it in a private/incognito browser session:",
  "1. Install helper: Chrome https://chromewebstore.google.com/detail/x-auth-helper/igpkhkjmpdecacocghpgkghdcmcmpfhp or Firefox https://addons.mozilla.org/en-US/firefox/addon/rettiwt-auth-helper/",
  "2. Open https://x.com/i/flow/login and log in to the secondary account.",
  "3. While still on x.com, open the helper extension and click Get Key / Get API Key.",
  "4. Copy the generated API_KEY here. Do not log out of the X account after generating it.",
].join("\n");

async function promptEnv(
  key: string,
  opts: {
    message: string;
    secret?: boolean;
    allowEmpty?: boolean;
    existing?: string;
  },
): Promise<{ value: string | null; aborted: boolean }> {
  const prompt = opts.secret ? password : text;
  const input = await prompt({
    message: opts.existing
      ? `${opts.message} (currently set; Enter to keep, type new to replace)`
      : opts.message,
    placeholder: opts.existing ? "(keep current)" : undefined,
  });
  if (isCancel(input)) return { value: null, aborted: true };
  const trimmed = String(input).trim();
  if (!trimmed) {
    if (opts.existing) return { value: opts.existing, aborted: false };
    if (opts.allowEmpty) return { value: "", aborted: false };
    return { value: null, aborted: false };
  }
  writeAppEnvValue(key, trimmed);
  process.env[key] = trimmed;
  return { value: trimmed, aborted: false };
}

export async function runApiKeysStep(): Promise<ApiKeysOutcome> {
  log.step("API keys");
  const envMap = readAppEnvMap();

  // ── JUPITER (required) ────────────────────────────────────────
  let jupiterConfigured = Boolean(envMap.JUPITER_API_KEY?.trim());
  if (!jupiterConfigured) {
    log.warn("JUPITER_API_KEY is required for Solana swaps / bootstrap.");
    const { value, aborted } = await promptEnv("JUPITER_API_KEY", {
      message: "Enter JUPITER_API_KEY",
      secret: true,
    });
    if (aborted) return emptyOutcome(true);
    if (value) jupiterConfigured = true;
    else log.warn("JUPITER_API_KEY left empty — bootstrap will keep failing until set.");
  } else {
    log.success("JUPITER_API_KEY configured.");
  }

  // ── TAVILY (optional, unlocks web_research) ───────────────────
  let tavilyConfigured = Boolean(envMap.TAVILY_API_KEY?.trim());
  const wantTavily = await confirm({
    message: tavilyConfigured
      ? "TAVILY_API_KEY already set. Replace it?"
      : "Configure TAVILY_API_KEY now? (unlocks web_research)",
    initialValue: !tavilyConfigured,
  });
  if (isCancel(wantTavily)) return emptyOutcome(true);
  if (wantTavily) {
    const { value, aborted } = await promptEnv("TAVILY_API_KEY", {
      message: "Enter TAVILY_API_KEY",
      secret: true,
      existing: envMap.TAVILY_API_KEY,
    });
    if (aborted) return emptyOutcome(true);
    tavilyConfigured = Boolean(value);
  }

  // ── RETTIWT (optional, unlocks twitter_account) ───────────────
  let rettiwtConfigured = Boolean(envMap.RETTIWT_API_KEY?.trim());
  const wantRettiwt = await confirm({
    message: rettiwtConfigured
      ? "RETTIWT_API_KEY already set. Replace it?"
      : "Configure RETTIWT_API_KEY now? (unlocks twitter_account)",
    initialValue: !rettiwtConfigured,
  });
  if (isCancel(wantRettiwt)) return emptyOutcome(true);
  if (wantRettiwt) {
    log.info(RETTIWT_AUTH_GUIDANCE);
    const { value, aborted } = await promptEnv("RETTIWT_API_KEY", {
      message: "Enter RETTIWT_API_KEY",
      secret: true,
      existing: envMap.RETTIWT_API_KEY,
    });
    if (aborted) return emptyOutcome(true);
    rettiwtConfigured = Boolean(value);
  }

  // ── POLYMARKET CLOB trio (optional) ───────────────────────────
  const polyAllPresent =
    Boolean(envMap.POLYMARKET_API_KEY?.trim()) &&
    Boolean(envMap.POLYMARKET_API_SECRET?.trim()) &&
    Boolean(envMap.POLYMARKET_PASSPHRASE?.trim());
  let polymarketConfigured = polyAllPresent;
  const wantPoly = await confirm({
    message: polyAllPresent
      ? "Polymarket CLOB credentials already set (key + secret + passphrase). Replace?"
      : "Configure Polymarket CLOB credentials (key + secret + passphrase)? You can also use the `polymarket_setup` tool later to auto-generate.",
    initialValue: false,
  });
  if (isCancel(wantPoly)) return emptyOutcome(true);
  if (wantPoly) {
    const step1 = await promptEnv("POLYMARKET_API_KEY", {
      message: "POLYMARKET_API_KEY",
      secret: true,
      existing: envMap.POLYMARKET_API_KEY,
    });
    if (step1.aborted) return emptyOutcome(true);
    const step2 = await promptEnv("POLYMARKET_API_SECRET", {
      message: "POLYMARKET_API_SECRET",
      secret: true,
      existing: envMap.POLYMARKET_API_SECRET,
    });
    if (step2.aborted) return emptyOutcome(true);
    const step3 = await promptEnv("POLYMARKET_PASSPHRASE", {
      message: "POLYMARKET_PASSPHRASE",
      secret: true,
      existing: envMap.POLYMARKET_PASSPHRASE,
    });
    if (step3.aborted) return emptyOutcome(true);
    polymarketConfigured = Boolean(step1.value && step2.value && step3.value);
  }

  synchronizeTrackedEnv();

  return {
    aborted: false,
    jupiterConfigured,
    tavilyConfigured,
    rettiwtConfigured,
    polymarketConfigured,
  };
}

function emptyOutcome(aborted: boolean): ApiKeysOutcome {
  return {
    aborted,
    jupiterConfigured: false,
    tavilyConfigured: false,
    rettiwtConfigured: false,
    polymarketConfigured: false,
  };
}
