/**
 * Runtime param-type validation for `executeProtocolTool` (PR1 §1f).
 *
 * Pre-PR1 runtime only checked `required` presence; the `type` field in
 * `ProtocolParamDef` was documentation only. Handlers defended against
 * wrong types with `as any` casts on SDK enum params. PR1 closes the
 * boundary: the runtime rejects a call whose param `typeof` does not
 * match the declared `type`.
 *
 * We drive the runtime with an in-memory manifest + handler so the test
 * does not depend on any real protocol (every real handler would require
 * ENV / SDK setup). The assertion surface is the returned `ToolResult`.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

import type {
  ProtocolHandler,
  ProtocolToolManifest,
} from "@echo-agent/tools/protocols/types.js";

// We patch the catalog lookups used by runtime.ts so we can inject a
// synthetic manifest without polluting the real registry. This keeps the
// test hermetic and avoids side-effects on unrelated suites.
vi.mock("@echo-agent/tools/protocols/catalog.js", async () => {
  const actual = await vi.importActual<typeof import("@echo-agent/tools/protocols/catalog.js")>(
    "@echo-agent/tools/protocols/catalog.js",
  );
  return {
    ...actual,
    getProtocolManifest: (toolId: string) =>
      TEST_MANIFESTS.get(toolId) ?? actual.getProtocolManifest(toolId),
    getProtocolHandler: (toolId: string) =>
      TEST_HANDLERS.get(toolId) ?? actual.getProtocolHandler(toolId),
  };
});

const TEST_MANIFESTS = new Map<string, ProtocolToolManifest>();
const TEST_HANDLERS = new Map<string, ProtocolHandler>();
let handlerCalls = 0;

const { executeProtocolTool } = await import("@echo-agent/tools/protocols/runtime.js");

function registerTestTool(manifest: ProtocolToolManifest, handler: ProtocolHandler): void {
  TEST_MANIFESTS.set(manifest.toolId, manifest);
  TEST_HANDLERS.set(manifest.toolId, handler);
}

beforeAll(() => {
  const captureHandler: ProtocolHandler = async (_params, _ctx) => {
    handlerCalls++;
    return { success: true, output: "ok" };
  };

  registerTestTool(
    {
      toolId: "test.type_validation.strict",
      namespace: "dexscreener", // non-mutating namespace, non-advertised at test level is fine
      lifecycle: "active",
      description: "Test tool for runtime type validation",
      mutating: false,
      exampleParams: {},
      params: [
        { key: "sort", type: "string", required: false, description: "A string enum" },
        { key: "limit", type: "number", required: false, description: "A number" },
        { key: "active", type: "boolean", required: false, description: "A boolean" },
        { key: "required_str", type: "string", required: true, description: "Required string" },
      ],
    },
    captureHandler,
  );
});

afterAll(() => {
  TEST_MANIFESTS.clear();
  TEST_HANDLERS.clear();
});

describe("runtime type validation (execute_tool)", () => {
  it("rejects wrong type for string param", async () => {
    handlerCalls = 0;
    const result = await executeProtocolTool(
      { toolId: "test.type_validation.strict", params: { required_str: "ok", sort: 123 } },
      { loopMode: "full", approved: true },
    );
    expect(result.success).toBe(false);
    expect(result.output).toMatch(/invalid type.*expected string.*got number/i);
    expect(handlerCalls).toBe(0);
  });

  it("rejects wrong type for number param", async () => {
    handlerCalls = 0;
    const result = await executeProtocolTool(
      { toolId: "test.type_validation.strict", params: { required_str: "ok", limit: "ten" } },
      { loopMode: "full", approved: true },
    );
    expect(result.success).toBe(false);
    expect(result.output).toMatch(/invalid type.*expected number.*got string/i);
    expect(handlerCalls).toBe(0);
  });

  it("rejects wrong type for boolean param", async () => {
    handlerCalls = 0;
    const result = await executeProtocolTool(
      { toolId: "test.type_validation.strict", params: { required_str: "ok", active: "yes" } },
      { loopMode: "full", approved: true },
    );
    expect(result.success).toBe(false);
    expect(result.output).toMatch(/invalid type.*expected boolean.*got string/i);
    expect(handlerCalls).toBe(0);
  });

  it("accepts correct types and calls handler exactly once", async () => {
    handlerCalls = 0;
    const result = await executeProtocolTool(
      {
        toolId: "test.type_validation.strict",
        params: { required_str: "ok", sort: "hot", limit: 10, active: true },
      },
      { loopMode: "full", approved: true },
    );
    expect(result.success).toBe(true);
    expect(handlerCalls).toBe(1);
  });

  it("allows missing optional param (undefined = not enforced)", async () => {
    handlerCalls = 0;
    const result = await executeProtocolTool(
      { toolId: "test.type_validation.strict", params: { required_str: "ok" } },
      { loopMode: "full", approved: true },
    );
    expect(result.success).toBe(true);
    expect(handlerCalls).toBe(1);
  });

  it("still rejects missing required param (required takes precedence)", async () => {
    handlerCalls = 0;
    const result = await executeProtocolTool(
      { toolId: "test.type_validation.strict", params: {} },
      { loopMode: "full", approved: true },
    );
    expect(result.success).toBe(false);
    expect(result.output).toMatch(/missing required parameter/i);
    expect(handlerCalls).toBe(0);
  });

  it("null and empty string are treated as missing (not type-checked)", async () => {
    handlerCalls = 0;
    // empty-string "" is treated as missing by runtime — so sort: "" is
    // allowed (optional + effectively absent); required_str: "" is rejected
    // as missing required. This mirrors pre-PR1 behaviour.
    const result = await executeProtocolTool(
      { toolId: "test.type_validation.strict", params: { required_str: "", sort: "" } },
      { loopMode: "full", approved: true },
    );
    expect(result.success).toBe(false);
    expect(result.output).toMatch(/missing required parameter "required_str"/i);
    expect(handlerCalls).toBe(0);
  });
});
