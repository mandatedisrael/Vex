/**
 * Sentry beforeSend + beforeBreadcrumb hook factories (M11).
 *
 * Reuses the existing field-name + secret-pattern redactor at
 * `main/logger/redact.ts` (already running on every electron-log call,
 * production-tested) and adds two on-wire telemetry-specific rules:
 *
 *   1. URL query strings stripped from event.request.url + exception
 *      values + breadcrumb data — anything after `?` is dropped, not
 *      just redacted, because we can't tell secret-bearing params
 *      from pagination at parse time.
 *   2. Breadcrumb category allowlist — only `navigation`, `vex.ipc`,
 *      and `vex.wizard` survive. Console, fetch/xhr, dom, history,
 *      sentry.event, ui.click, etc. are all dropped. Plan §L: "no
 *      message text, no payload, no PII".
 *
 * Types come from `@sentry/electron/main` via `import type` — no
 * runtime SDK reference, so this module can be loaded by tests
 * without pulling Sentry into memory.
 */

import type { Event, Breadcrumb, EventHint, BreadcrumbHint } from "@sentry/electron/main";
import { redact } from "../logger/redact.js";

const ALLOWED_BREADCRUMB_CATEGORIES = new Set([
  "navigation",
  "vex.ipc",
  "vex.wizard",
]);

function stripUrlQuery(url: string | undefined): string | undefined {
  if (!url) return url;
  const queryIdx = url.indexOf("?");
  return queryIdx === -1 ? url : url.slice(0, queryIdx);
}

/**
 * Strip the `?...` portion of any URL embedded inside a free-form
 * string. `redact()` covers field names + 0x-hex / base64 / jwt
 * secret patterns, but a URL like `https://example/?token=abc` survives
 * both and would leak the query string. Run this AFTER `redact()` so
 * the redactor's hex/JWT patterns get a clean view first.
 */
function scrubUrlsInString(value: string): string {
  return value.replace(
    /(https?:\/\/[^\s]+?)(\?[^\s]*)/gi,
    (_match, base: string) => base,
  );
}

function scrubMessage(value: string): string {
  return scrubUrlsInString(value);
}

function scrubExceptions(event: Event): void {
  const values = event.exception?.values;
  if (!values) return;
  for (const v of values) {
    if (v.value) v.value = stripUrlQuery(v.value) ?? "";
  }
}

function scrubBreadcrumbs(event: Event): void {
  if (!event.breadcrumbs) return;
  event.breadcrumbs = event.breadcrumbs
    .filter((bc) => {
      if (!bc.category) return false;
      return ALLOWED_BREADCRUMB_CATEGORIES.has(bc.category);
    })
    .map((bc) => ({
      type: bc.type,
      category: bc.category,
      level: bc.level,
      timestamp: bc.timestamp,
      // Drop message body + data: only the route/channel/step name lives in
      // the category hint we set at emit time.
    }));
}

export function makeBeforeSendHook(): (
  event: Event,
  hint: EventHint,
) => Event | null {
  return (event) => {
    if (event.request) {
      event.request.url = stripUrlQuery(event.request.url);
      event.request.query_string = undefined;
      event.request.cookies = undefined;
      event.request.headers = undefined;
      event.request.data = undefined;
    }
    scrubExceptions(event);
    scrubBreadcrumbs(event);
    if (event.message) {
      event.message =
        typeof event.message === "string"
          ? scrubMessage(redact(event.message))
          : event.message;
    }
    if (event.extra) {
      event.extra = redact(event.extra) as typeof event.extra;
      for (const [k, v] of Object.entries(event.extra ?? {})) {
        if (typeof v === "string") {
          event.extra[k] = scrubUrlsInString(v);
        }
      }
    }
    if (event.contexts) event.contexts = redact(event.contexts);
    if (event.tags) event.tags = redact(event.tags);
    if (event.user) event.user = { id: event.user.id ?? undefined };
    return event;
  };
}

export function makeBeforeBreadcrumbHook(): (
  bc: Breadcrumb,
  hint?: BreadcrumbHint,
) => Breadcrumb | null {
  return (bc) => {
    if (!bc.category || !ALLOWED_BREADCRUMB_CATEGORIES.has(bc.category)) {
      return null;
    }
    return {
      type: bc.type,
      category: bc.category,
      level: bc.level,
      timestamp: bc.timestamp,
    };
  };
}
