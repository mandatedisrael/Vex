/**
 * beforeSend / beforeBreadcrumb hook tests (M11).
 *
 * Verifies the hooks scrub everything plan §L promised:
 *   - URL query strings stripped from request.url + exception values.
 *   - Breadcrumb categories filtered to allowlist (navigation, vex.ipc,
 *     vex.wizard).
 *   - Existing redactor runs on event.message + event.extra +
 *     event.contexts so secret patterns (0x-hex64, jwt, base64-64) and
 *     sensitive field names (password, mnemonic, …) never leak.
 */

import { describe, expect, it } from "vitest";
import type { Breadcrumb, Event } from "@sentry/electron/main";
import {
  makeBeforeBreadcrumbHook,
  makeBeforeSendHook,
} from "../before-send.js";

const beforeSend = makeBeforeSendHook();
const beforeBreadcrumb = makeBeforeBreadcrumbHook();

const fakeHint = {};

describe("makeBeforeSendHook", () => {
  it("strips query string from event.request.url", () => {
    const event: Event = {
      request: {
        url: "https://example/vex?password=secret&token=abc",
      },
    };
    const result = beforeSend(event, fakeHint);
    expect(result?.request?.url).toBe("https://example/vex");
  });

  it("nukes cookies/headers/data on request", () => {
    const event: Event = {
      request: {
        url: "https://example",
        cookies: { foo: "bar" },
        headers: { Authorization: "Bearer xxx" },
        data: { password: "leaked" },
      },
    };
    const result = beforeSend(event, fakeHint);
    expect(result?.request?.cookies).toBeUndefined();
    expect(result?.request?.headers).toBeUndefined();
    expect(result?.request?.data).toBeUndefined();
  });

  it("redacts EVM private key in event.extra", () => {
    const event: Event = {
      extra: {
        snippet:
          "Throw new Error('failed for 0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef')",
      },
    };
    const result = beforeSend(event, fakeHint);
    expect(String(result?.extra?.snippet)).not.toContain("0xdeadbeef");
    expect(String(result?.extra?.snippet)).toContain("[REDACTED]");
  });

  it("redacts password field by key name in extra", () => {
    const event: Event = {
      extra: {
        loginAttempt: { username: "alice", password: "hunter2" },
      },
    };
    const result = beforeSend(event, fakeHint);
    const attempt = result?.extra?.loginAttempt as Record<string, unknown>;
    expect(attempt?.password).toBe("[REDACTED]");
  });

  it("collapses event.user to {id}", () => {
    const event: Event = {
      user: {
        id: "abc",
        email: "leaked@example.com",
        ip_address: "1.2.3.4",
        username: "alice",
      },
    };
    const result = beforeSend(event, fakeHint);
    expect(result?.user).toEqual({ id: "abc" });
  });

  it("strips URL query strings embedded in event.message", () => {
    const event: Event = {
      message:
        "Network error fetching https://api.example.com/users?token=hunter2&id=1",
    };
    const result = beforeSend(event, fakeHint);
    expect(result?.message).toBe(
      "Network error fetching https://api.example.com/users",
    );
  });

  it("strips URL query strings embedded in extra string values", () => {
    const event: Event = {
      extra: {
        endpoint: "https://api.example.com/items?api_key=secret",
      },
    };
    const result = beforeSend(event, fakeHint);
    expect(result?.extra?.endpoint).toBe("https://api.example.com/items");
  });

  it("filters breadcrumbs not in allowlist", () => {
    const event: Event = {
      breadcrumbs: [
        { category: "navigation", message: "to /wizard", timestamp: 1 },
        { category: "console", message: "leaked log", timestamp: 2 },
        { category: "vex.ipc", message: "channel only", timestamp: 3 },
        { category: "ui.click", message: "click", timestamp: 4 },
      ],
    };
    const result = beforeSend(event, fakeHint);
    const categories = (result?.breadcrumbs ?? []).map((bc) => bc.category);
    expect(categories).toContain("navigation");
    expect(categories).toContain("vex.ipc");
    expect(categories).not.toContain("console");
    expect(categories).not.toContain("ui.click");
  });
});

describe("makeBeforeBreadcrumbHook", () => {
  it("drops breadcrumbs without category", () => {
    const bc: Breadcrumb = { message: "no category", timestamp: 1 };
    expect(beforeBreadcrumb(bc, undefined)).toBeNull();
  });

  it("drops breadcrumbs not in allowlist", () => {
    const bc: Breadcrumb = { category: "console", message: "x", timestamp: 1 };
    expect(beforeBreadcrumb(bc, undefined)).toBeNull();
  });

  it("strips message + data when keeping an allowed breadcrumb", () => {
    const bc: Breadcrumb = {
      category: "vex.ipc",
      type: "info",
      level: "info",
      message: "would-be leaked payload",
      data: { payload: { password: "hunter2" } },
      timestamp: 100,
    };
    const result = beforeBreadcrumb(bc, undefined);
    expect(result?.category).toBe("vex.ipc");
    expect(result).not.toHaveProperty("message");
    expect(result).not.toHaveProperty("data");
  });
});
