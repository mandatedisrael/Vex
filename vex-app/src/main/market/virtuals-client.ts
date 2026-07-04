/**
 * Virtuals holder-count client — best-effort enrichment for the VEX widget
 * (T1). The Virtuals API returns a large, free-text payload; we consume ONLY
 * the numeric `holderCount`. The free-text fields (name, description, socials)
 * are never read, so there is no prompt-injection or XSS surface here — a
 * single integer reaches the widget.
 *
 * Tolerant + non-fatal: a schema mismatch or an absent field resolves to
 * `null` (the widget hides the holders stat), and the caller keeps last-good
 * data. Network failures throw so the poller can log them; the composed
 * snapshot never blocks on this source.
 */

import { z } from "zod";
import { fetchJsonWithTimeout } from "./market-http.js";

/** VEX's Virtuals project id (plan §1; id 96200). */
const VEX_VIRTUALS_URL = "https://api.virtuals.io/api/virtuals/96200";

// `.passthrough()` at both levels: the payload carries dozens of fields we
// deliberately ignore; only `holderCount` is validated + consumed.
const virtualsSchema = z.object({
  data: z
    .object({
      holderCount: z.number().nullable().optional(),
    })
    .passthrough(),
});

/** Fetch the VEX holder count, or `null` when absent/unparseable. */
export async function fetchVexHolderCount(
  url: string = VEX_VIRTUALS_URL,
): Promise<number | null> {
  const raw = await fetchJsonWithTimeout(url);
  const parsed = virtualsSchema.safeParse(raw);
  if (!parsed.success) return null;
  const count = parsed.data.data.holderCount;
  return typeof count === "number" && Number.isFinite(count)
    ? Math.trunc(count)
    : null;
}
