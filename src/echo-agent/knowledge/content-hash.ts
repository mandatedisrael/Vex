/**
 * Canonical content hash for knowledge entries.
 *
 * Used as the UNIQUE idempotency key on `knowledge_entries.content_hash`.
 * Same canonical text → same hash → repeat write returns the existing row
 * (immutable; metadata is NOT silently merged on conflict).
 *
 * Encoding rationale: a raw separator like `\n` collides as soon as any field
 * legitimately contains a newline (and `content_md` always does). The
 * length-prefixed encoding `${len}:${field}|${len}:${field}|...` is
 * unambiguous and deterministic with zero escaping. Two entries can only hash
 * the same if every field is byte-identical.
 *
 * Field set is intentionally text-only: `kind + title + summary + content_md`.
 * Tags, source_refs, confidence, pinned, valid_from, status etc. are deliberately
 * excluded — "the same fact" is defined by its text identity, not by its
 * tracking metadata. This is the price of explicit immutability semantics.
 */

import { createHash } from "node:crypto";

export interface ContentHashInput {
  kind: string;
  title: string;
  summary: string;
  contentMd: string;
}

export function computeContentHash(parts: ContentHashInput): string {
  const encoded = [
    `${parts.kind.length}:${parts.kind}`,
    `${parts.title.length}:${parts.title}`,
    `${parts.summary.length}:${parts.summary}`,
    `${parts.contentMd.length}:${parts.contentMd}`,
  ].join("|");
  return createHash("sha256").update(encoded).digest("hex");
}
