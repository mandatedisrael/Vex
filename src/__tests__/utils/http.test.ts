/**
 * Boundary tests for parseJsonResponse (codex-002):
 *  - no schema → unchecked cast (backward compat);
 *  - schema + valid body → validated value;
 *  - schema + invalid body → HTTP_RESPONSE_INVALID (distinct from network fail);
 *  - non-ok with a {error} body → HTTP_REQUEST_FAILED carrying that message;
 *  - non-ok with a hostile/odd error body → safe fallback to status text;
 *  - unparseable success body → HTTP_REQUEST_FAILED.
 */

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { parseJsonResponse } from "../../utils/http.js";
import { VexError, ErrorCodes } from "../../errors.js";

/** Minimal Response stand-in — parseJsonResponse only reads ok/status/statusText/json(). */
function fakeResponse(opts: {
  ok: boolean;
  status?: number;
  statusText?: string;
  json: () => Promise<unknown>;
}): Response {
  return {
    ok: opts.ok,
    status: opts.status ?? (opts.ok ? 200 : 500),
    statusText: opts.statusText ?? "",
    json: opts.json,
  } as unknown as Response;
}

const schema = z.object({ id: z.string(), n: z.number() });

describe("parseJsonResponse (codex-002 boundary)", () => {
  it("returns an unchecked cast when no schema is supplied", async () => {
    const res = fakeResponse({ ok: true, json: async () => ({ anything: 1 }) });
    const out = await parseJsonResponse<{ anything: number }>(res);
    expect(out.anything).toBe(1);
  });

  it("returns the validated value when the schema matches", async () => {
    const res = fakeResponse({ ok: true, json: async () => ({ id: "x", n: 2 }) });
    const out = await parseJsonResponse(res, schema);
    expect(out).toEqual({ id: "x", n: 2 });
  });

  it("throws HTTP_RESPONSE_INVALID when the body fails the schema", async () => {
    const res = fakeResponse({ ok: true, json: async () => ({ id: "x", n: "nope" }) });
    await expect(parseJsonResponse(res, schema)).rejects.toMatchObject({
      code: ErrorCodes.HTTP_RESPONSE_INVALID,
    });
  });

  it("surfaces an {error} message from a non-ok body", async () => {
    const res = fakeResponse({
      ok: false,
      status: 400,
      statusText: "Bad Request",
      json: async () => ({ error: "upstream said no" }),
    });
    await expect(parseJsonResponse(res)).rejects.toMatchObject({
      code: ErrorCodes.HTTP_REQUEST_FAILED,
      message: "upstream said no",
    });
  });

  it("falls back to status text when the error body is not a {error:string} record", async () => {
    const res = fakeResponse({
      ok: false,
      status: 503,
      statusText: "Service Unavailable",
      // hostile shape: error is an object, not a string — must NOT be used raw
      json: async () => ({ error: { nested: true } }),
    });
    await expect(parseJsonResponse(res)).rejects.toMatchObject({
      code: ErrorCodes.HTTP_REQUEST_FAILED,
      message: "HTTP 503: Service Unavailable",
    });
  });

  it("throws HTTP_REQUEST_FAILED when the success body is not JSON", async () => {
    const res = fakeResponse({
      ok: true,
      json: async () => {
        throw new SyntaxError("Unexpected token");
      },
    });
    await expect(parseJsonResponse(res, schema)).rejects.toBeInstanceOf(VexError);
  });
});
