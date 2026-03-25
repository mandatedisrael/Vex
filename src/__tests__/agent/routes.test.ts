import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { registerRoute, dispatchRoute, jsonResponse, errorResponse } = await import(
  "../../agent/routes.js"
);

function mockReq(method: string, url: string, body?: string) {
  const listeners: Record<string, Function[]> = {};
  const req = {
    method,
    url,
    headers: {},
    on(event: string, fn: Function) { (listeners[event] ??= []).push(fn); return req; },
    destroy() {},
  };
  // Simulate body delivery after construction
  setTimeout(() => {
    if (body && method !== "GET") {
      for (const fn of listeners["data"] ?? []) fn(Buffer.from(body));
    }
    for (const fn of listeners["end"] ?? []) fn();
  }, 0);
  return req;
}

function mockRes() {
  const res = {
    headersSent: false,
    statusCode: 0,
    headers: {} as Record<string, string>,
    body: "",
    writeHead(status: number, headers?: Record<string, string>) { res.statusCode = status; res.headers = { ...res.headers, ...headers }; res.headersSent = true; },
    end(data?: string) { res.body = data ?? ""; },
  };
  return res;
}

beforeEach(() => { vi.clearAllMocks(); });

describe("registerRoute + dispatchRoute", () => {
  it("dispatches to registered route handler", async () => {
    const handler = vi.fn((_req, res) => { res.writeHead(200); res.end("ok"); });
    registerRoute("GET", "/api/test/basic", handler);

    const req = mockReq("GET", "/api/test/basic");
    const res = mockRes();
    await dispatchRoute(req as any, res as any);

    expect(handler).toHaveBeenCalled();
  });

  it("returns 404 for unregistered route", async () => {
    const req = mockReq("GET", "/api/nonexistent");
    const res = mockRes();
    await dispatchRoute(req as any, res as any);

    expect(res.statusCode).toBe(404);
    expect(res.body).toContain("NOT_FOUND");
  });

  it("extracts path params from :param segments", async () => {
    let capturedParams: Record<string, string> = {};
    registerRoute("POST", "/api/test/items/:id", (_req, res, { pathParams }) => {
      capturedParams = pathParams;
      res.writeHead(200);
      res.end();
    });

    const req = mockReq("POST", "/api/test/items/abc123", "{}");
    const res = mockRes();
    await dispatchRoute(req as any, res as any);

    expect(capturedParams.id).toBe("abc123");
  });

  it("strips query string from URL matching", async () => {
    registerRoute("GET", "/api/test/query", (_req, res) => { res.writeHead(200); res.end(); });

    const req = mockReq("GET", "/api/test/query?foo=bar");
    const res = mockRes();
    await dispatchRoute(req as any, res as any);

    expect(res.statusCode).toBe(200);
  });
});

describe("jsonResponse", () => {
  it("writes JSON with correct headers", () => {
    const res = mockRes();
    jsonResponse(res as any, 200, { ok: true });
    expect(res.statusCode).toBe(200);
    expect(res.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(res.body)).toEqual({ ok: true });
  });
});

describe("errorResponse", () => {
  it("writes error JSON with code and message", () => {
    const res = mockRes();
    errorResponse(res as any, 400, "BAD_REQUEST", "Invalid input");
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe("BAD_REQUEST");
    expect(body.error.message).toBe("Invalid input");
  });
});
