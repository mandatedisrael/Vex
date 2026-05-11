/**
 * Embedding bundled-defaults reader + dim bounds (M9).
 *
 * Pure module — no fs/DB/Electron imports outside `node:fs` for the
 * single readFileSync that backs `readEmbeddingDefaultsFromExample`.
 * Cross-boundary safe: vex-app main can import via `@vex-lib/embedding.js`
 * without dragging CLI status/setup helpers (which transitively pull
 * wallet decryption modules).
 *
 * Path resolution lives in vex-app main (M9 wires it via the existing
 * package-assets / extraResources helper). This module just parses
 * a path the caller hands in.
 */

import { readFileSync } from "node:fs";

export {
  MAX_EMBEDDING_DIM,
  MIN_EMBEDDING_DIM,
} from "./embedding-constants.js";

import {
  MAX_EMBEDDING_DIM,
  MIN_EMBEDDING_DIM,
} from "./embedding-constants.js";

export interface EmbeddingDefaultValues {
  readonly baseUrl: string;
  readonly model: string;
  readonly dim: number;
  readonly provider: string;
}

export type EmbeddingDefaultsResult =
  | { readonly ok: true; readonly values: EmbeddingDefaultValues }
  | {
      readonly ok: false;
      readonly reason: "file_missing" | "parse_error" | "incomplete";
      readonly detail?: {
        readonly missingKeys?: readonly string[];
        readonly field?: string;
      };
    };

const REQUIRED_KEYS = [
  "EMBEDDING_BASE_URL",
  "EMBEDDING_MODEL",
  "EMBEDDING_DIM",
  "EMBEDDING_PROVIDER",
] as const;

/**
 * Parse a `.env`-style file (typically `.env.example`) for the four
 * EMBEDDING_* keys. Strict on EMBEDDING_DIM: integer-only string +
 * range validate; rejects "768abc" (parseInt would silently accept).
 *
 * Read failures collapse to `file_missing` so callers don't need to
 * distinguish ENOENT from EACCES at the UI layer (both mean "no
 * defaults available, ask user manually").
 */
export function readEmbeddingDefaultsFromExample(envExamplePath: string): EmbeddingDefaultsResult {
  let content: string;
  try {
    content = readFileSync(envExamplePath, "utf-8");
  } catch {
    return { ok: false, reason: "file_missing" };
  }

  const map = parseDotenvLines(content);
  const missing: string[] = [];
  for (const key of REQUIRED_KEYS) {
    const v = map.get(key);
    if (v === undefined || v.length === 0) missing.push(key);
  }
  if (missing.length > 0) {
    return { ok: false, reason: "incomplete", detail: { missingKeys: missing } };
  }

  const dimRaw = map.get("EMBEDDING_DIM")!;
  if (!/^\d+$/.test(dimRaw)) {
    return { ok: false, reason: "parse_error", detail: { field: "EMBEDDING_DIM" } };
  }
  const dim = Number.parseInt(dimRaw, 10);
  if (!Number.isFinite(dim) || dim < MIN_EMBEDDING_DIM || dim > MAX_EMBEDDING_DIM) {
    return { ok: false, reason: "parse_error", detail: { field: "EMBEDDING_DIM" } };
  }

  return {
    ok: true,
    values: {
      baseUrl: map.get("EMBEDDING_BASE_URL")!,
      model: map.get("EMBEDDING_MODEL")!,
      dim,
      provider: map.get("EMBEDDING_PROVIDER")!,
    },
  };
}

function parseDotenvLines(content: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) continue;
    const m = trimmed.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let val = m[2]!;
    if (val.length >= 2) {
      const first = val[0];
      const last = val[val.length - 1];
      if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
        val = val.slice(1, -1);
      }
    }
    map.set(m[1]!, val);
  }
  return map;
}
