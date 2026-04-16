/**
 * Shared param extractors for knowledge tool handlers.
 *
 * Used across knowledge-write, knowledge-supersede, and anywhere else that
 * reads the same tag/source_refs/confidence shape from a params bag. Kept
 * out of the generic `./types.ts` because the `read*` helpers carry
 * knowledge-specific coercion semantics (non-array tags → [], non-object
 * source_refs → {}, confidence clamping to [0,1]).
 */

export function readStringArray(params: Record<string, unknown>, key: string): string[] {
  const v = params[key];
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string");
}

export function readObject(params: Record<string, unknown>, key: string): Record<string, unknown> {
  const v = params[key];
  if (typeof v !== "object" || v === null || Array.isArray(v)) return {};
  return v as Record<string, unknown>;
}

export function readClampedNumber(
  params: Record<string, unknown>,
  key: string,
  min: number,
  max: number,
): number | null {
  const v = params[key];
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  if (v < min) return min;
  if (v > max) return max;
  return v;
}
