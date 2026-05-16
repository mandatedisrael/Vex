/**
 * ApiKeysStep form helpers — extracted from `ApiKeysStep.tsx` so the
 * screen file stays under the 400-LOC scalability ceiling (V2 refactor).
 *
 * Secret-input contract (skill §14): every secret field is captured
 * via an uncontrolled DOM ref so the value never lands in observable
 * React state, and `clearAll` wipes every ref synchronously on
 * submit BEFORE the IPC fires.
 *
 * `buildPayload` enforces Polymarket's all-or-none trio at the
 * boundary — partial input returns `{ error }` so the renderer
 * surfaces a single explanatory message instead of asking the user
 * to guess which field is wrong.
 */

import type { RefObject } from "react";
import {
  type ApiKeysSetInput,
  validatePolymarketManualTrio,
} from "@shared/schemas/api-keys.js";

export interface FieldRefs {
  readonly jupiter: RefObject<HTMLInputElement | null>;
  readonly tavily: RefObject<HTMLInputElement | null>;
  readonly rettiwt: RefObject<HTMLInputElement | null>;
  readonly polymarketKey: RefObject<HTMLInputElement | null>;
  readonly polymarketSecret: RefObject<HTMLInputElement | null>;
  readonly polymarketPassphrase: RefObject<HTMLInputElement | null>;
}

export function clearAll(refs: FieldRefs): void {
  for (const ref of Object.values(refs)) {
    if (ref.current) ref.current.value = "";
  }
}

export type BuildPayloadResult =
  | { ok: true; payload: ApiKeysSetInput }
  | { ok: false; error: string };

export function buildPayload(refs: FieldRefs): BuildPayloadResult {
  const jupiter = refs.jupiter.current?.value.trim() ?? "";
  const tavily = refs.tavily.current?.value.trim() ?? "";
  const rettiwt = refs.rettiwt.current?.value.trim() ?? "";
  const pmKey = refs.polymarketKey.current?.value.trim() ?? "";
  const pmSecret = refs.polymarketSecret.current?.value.trim() ?? "";
  const pmPass = refs.polymarketPassphrase.current?.value.trim() ?? "";

  const trio = validatePolymarketManualTrio({
    apiKey: pmKey,
    apiSecret: pmSecret,
    passphrase: pmPass,
  });
  if (trio.kind === "partial") {
    return {
      ok: false,
      error:
        "Polymarket needs all three fields (API key, secret, passphrase) — or leave them all blank.",
    };
  }

  const payload: ApiKeysSetInput = {
    ...(jupiter.length > 0 ? { jupiterApiKey: jupiter } : {}),
    ...(tavily.length > 0 ? { tavilyApiKey: tavily } : {}),
    ...(rettiwt.length > 0 ? { rettiwtApiKey: rettiwt } : {}),
    ...(trio.kind === "complete"
      ? {
          polymarket: {
            apiKey: pmKey,
            apiSecret: pmSecret,
            passphrase: pmPass,
          },
        }
      : {}),
  };
  return { ok: true, payload };
}
