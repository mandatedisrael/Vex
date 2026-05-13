import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export function readDotenvFileValue(key: string, envPath: string): string | null {
  if (!existsSync(envPath)) return null;

  const content = readFileSync(envPath, "utf-8");
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = content.match(new RegExp(`^${escapedKey}=(.*)$`, "m"));
  if (!match) return null;

  let value = match[1]!.trim();
  if (value.startsWith('"') && value.endsWith('"')) {
    value = value.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }

  return value || null;
}

export function loadDotenvFileIntoProcess(envPath: string): void {
  if (!existsSync(envPath)) return;

  let content: string;
  try {
    content = readFileSync(envPath, "utf-8");
  } catch {
    return;
  }

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const eqIdx = trimmed.indexOf("=");
    if (eqIdx < 1) continue;

    const key = trimmed.slice(0, eqIdx);
    if (process.env[key] !== undefined) continue;

    let value = trimmed.slice(eqIdx + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    }

    process.env[key] = value;
  }
}

export function appendToDotenvFile(key: string, value: string, envPath: string): string {
  const dir = dirname(envPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  let content = "";
  if (existsSync(envPath)) {
    content = readFileSync(envPath, "utf-8");
  }

  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const quotedValue = `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  const line = `${key}=${quotedValue}`;
  const regex = new RegExp(`^${escapedKey}=.*$`, "m");

  if (regex.test(content)) {
    content = content.replace(regex, line);
  } else {
    content = content.trimEnd() + `\n${line}\n`;
  }

  const tmpFile = join(dir, `.env.tmp.${Date.now()}`);
  writeFileSync(tmpFile, content, { mode: 0o600 });
  renameSync(tmpFile, envPath);
  return envPath;
}

/**
 * Remove a key from the dotenv file. No-op if file or key is absent.
 *
 * Used by the M9 wizard agent-core writer to honour the explicit
 * "Reset to default" UI action (renderer sends `null` for that field
 * → handler removes the key so engine reads fall back to compile-time
 * default). Atomic: temp+rename, mode 0o600.
 *
 * Returns true when the key was present and removed; false when the
 * file or the key did not exist (idempotent for callers that don't
 * care about prior state).
 */
export function removeFromDotenvFile(key: string, envPath: string): boolean {
  if (!existsSync(envPath)) return false;
  const content = readFileSync(envPath, "utf-8");
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`^${escapedKey}=.*(?:\r?\n|$)`, "m");
  if (!regex.test(content)) return false;
  const next = content.replace(regex, "");
  const dir = dirname(envPath);
  const tmpFile = join(dir, `.env.tmp.${Date.now()}`);
  writeFileSync(tmpFile, next, { mode: 0o600 });
  renameSync(tmpFile, envPath);
  return true;
}

/**
 * Atomic multi-key update for a .env file (M10, extended in M11).
 *
 * Single read → in-memory strip of ALL existing occurrences of every
 * provided key (handles duplicate-line edge case from manual edits)
 * → append canonical values in insertion order with the same quote-
 * escape format as `appendToDotenvFile` → atomic temp+rename + mode
 * 0o600. Idempotent (calling twice with identical input produces the
 * same file state).
 *
 * Values are quoted exactly as `appendToDotenvFile` so that
 * `readDotenvFileValue` round-trips correctly. Keys are written in
 * insertion order of `Object.entries(updates)`.
 *
 * **M11 extension**: `Record<string, string | null>` accepted — a
 * `null` value means "delete this key from the file in the same atomic
 * mutation". Used by mode/wake writers so e.g. switching mode to
 * "chat" deletes AGENT_LOOP_MODE + AGENT_INITIAL_PROMPT in the same
 * read-replace-rename op as writing AGENT_MODE="chat". Prevents the
 * stale-key drift M10 already fixed for provider state.
 *
 * Used by M10 provider-writer to guarantee that OPENROUTER_API_KEY,
 * AGENT_MODEL, and AGENT_PROVIDER are written as one consistent set.
 * M11 mode/wake writers additionally rely on the null-as-delete semantics.
 *
 * Throws on fs/permission errors — caller wraps in Result.
 */
export function appendMultipleToDotenvFile(
  updates: Record<string, string | null>,
  envPath: string,
): void {
  const dir = dirname(envPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  let content = "";
  if (existsSync(envPath)) {
    content = readFileSync(envPath, "utf-8");
  }

  // Strip ALL existing occurrences of every key (handles duplicates +
  // lines with leading horizontal whitespace, which `loadDotenvFileIntoProcess`
  // accepts because it `line.trim()`s before parsing. The loader's
  // first-match-wins rule would pick a stale value over the canonical one we
  // append below.
  for (const key of Object.keys(updates)) {
    const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(
      `^[ \\t]*${escapedKey}[ \\t]*=.*(?:\r?\n|$)`,
      "gm",
    );
    content = content.replace(regex, "");
  }

  // Append canonical values with the exact same quoting as
  // `appendToDotenvFile` so `readDotenvFileValue` round-trips.
  // `null` values were stripped above and intentionally NOT rewritten.
  content = content.trimEnd();
  for (const [key, value] of Object.entries(updates)) {
    if (value === null) continue;
    const quotedValue = `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
    const line = `${key}=${quotedValue}`;
    content = content.length === 0 ? line : `${content}\n${line}`;
  }
  if (content.length > 0) content += "\n";

  const tmpFile = join(dir, `.env.tmp.${Date.now()}`);
  writeFileSync(tmpFile, content, { mode: 0o600 });
  renameSync(tmpFile, envPath);
}
