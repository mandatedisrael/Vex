/**
 * Recall payload splitter — pure TS, no DB.
 *
 * Takes a reranked list and splits it into `inline` (returned in tool response)
 * and `overflow` (written to documents(space='cache') for later read via
 * knowledge_recall_overflow). Two caps apply, whichever fires first:
 *
 *   - max RECALL_INLINE_CAP entries inline
 *   - max RECALL_INLINE_CHARS_CAP total chars across all inline content_md
 *
 * Empty input → empty inline, no overflow.
 */

import { RECALL_INLINE_CAP, RECALL_INLINE_CHARS_CAP } from "./policy.js";
import type { RankedRecallResult } from "./ranking.js";

export interface SplitResult {
  inline: RankedRecallResult[];
  overflow: RankedRecallResult[];
}

/**
 * Split a reranked list into inline + overflow halves.
 *
 * Behaviour:
 * - The first entry is always placed inline, even if its content_md alone exceeds
 *   the chars cap. (Otherwise we'd silently lose the top hit.)
 * - Subsequent entries are placed inline only if BOTH the entry-count cap AND the
 *   total-chars cap still allow it.
 * - Once the chars cap is hit, every remaining entry goes to overflow — even if
 *   it would individually fit. This keeps the split deterministic.
 */
export function splitInlineAndOverflow(reranked: readonly RankedRecallResult[]): SplitResult {
  if (reranked.length === 0) {
    return { inline: [], overflow: [] };
  }

  const inline: RankedRecallResult[] = [];
  const overflow: RankedRecallResult[] = [];
  let totalChars = 0;
  let charCapReached = false;

  for (let i = 0; i < reranked.length; i++) {
    const entry = reranked[i]!;
    const entryChars = entry.contentMd.length;

    if (i === 0) {
      // Always include the top hit inline — even if it alone busts the cap.
      inline.push(entry);
      totalChars += entryChars;
      if (totalChars >= RECALL_INLINE_CHARS_CAP) charCapReached = true;
      continue;
    }

    if (charCapReached || inline.length >= RECALL_INLINE_CAP) {
      overflow.push(entry);
      continue;
    }

    if (totalChars + entryChars > RECALL_INLINE_CHARS_CAP) {
      // Adding this entry would push us over — overflow it and lock the cap.
      charCapReached = true;
      overflow.push(entry);
      continue;
    }

    inline.push(entry);
    totalChars += entryChars;
    if (inline.length >= RECALL_INLINE_CAP) {
      // Filled the entry cap — everything else goes to overflow.
      // (We don't set charCapReached here because the gating check above already covers it.)
    }
  }

  return { inline, overflow };
}
