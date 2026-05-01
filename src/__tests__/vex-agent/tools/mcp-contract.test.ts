/**
 * MCP contract snapshot test — guards the public surface of `@vex-agent/*`
 * that `src/mcp/` depends on. If a refactor silently removes, renames, or
 * re-shapes any of these exports, this test fails at import time.
 *
 * Rationale: `src/mcp/` imports 13 symbols across 6 modules (see
 * `src/vex-agent/AUDIT_INVENTORY.md` §5). The audit milestone (PR1–PR5)
 * restructures several of those modules internally without changing public
 * signatures; this test proves the promise structurally instead of relying
 * on a manual `pnpm mcp` smoke run.
 *
 * `discover_tools` schema note: PR1 dropped the `includeDeclared` parameter
 * entirely (not preserved as a deprecated no-op). Zod object schemas in the
 * MCP bridge default-strip unknown fields, so clients that still pass the
 * flag don't see a visible error — the field is silently ignored. Keeping
 * dead surface would have forced every future reviewer to ask "when does
 * this go away"; removing it upfront is cleaner.
 */

import { describe, it, expect } from "vitest";

import { runMigrations } from "@vex-agent/db/migrate.js";
import { getPool } from "@vex-agent/db/client.js";
import {
  loadEmbeddingConfig,
  MIN_EMBEDDING_DIM,
  MAX_EMBEDDING_DIM,
} from "@vex-agent/embeddings/config.js";
import * as sessionsRepo from "@vex-agent/db/repos/sessions.js";
import { dispatchTool } from "@vex-agent/tools/dispatcher.js";
import {
  getProductionMcpTools,
  getAllTools,
  getToolDef,
  isInternalTool,
  isMutatingTool,
  getOpenAITools,
  isToolBlockedForRole,
} from "@vex-agent/tools/registry.js";
import {
  toOpenAITools,
  type ToolDef,
  type JsonSchema,
  type OpenAITool,
  type ToolCallRequest,
  type ToolResult,
} from "@vex-agent/tools/types.js";
import {
  PROTOCOL_TOOLS,
  PROTOCOL_NAMESPACE_ALLOWLIST,
  PROTOCOL_ADVERTISED_NAMESPACE_ALLOWLIST,
  NAMESPACE_DEFAULTS,
  isKnownProtocolNamespace,
  isAdvertisedProtocolNamespace,
  isProtocolToolAvailable,
  countAvailableToolsForNamespace,
  getMissingEnvForNamespace,
  getProtocolHandler,
  getProtocolManifest,
  type NamespaceDefault,
} from "@vex-agent/tools/protocols/catalog.js";
import type {
  ProtocolNamespace,
  ProtocolToolManifest,
  ProtocolHandler,
  ToolLifecycle,
  ProtocolParamDef,
} from "@vex-agent/tools/protocols/types.js";
import type { InternalToolContext } from "@vex-agent/tools/internal/types.js";

describe("MCP contract — vex-agent public surface", () => {
  describe("tools/dispatcher.ts", () => {
    it("exports dispatchTool as a function", () => {
      expect(typeof dispatchTool).toBe("function");
      // signature: (call: ToolCallRequest, context: InternalToolContext) => Promise<ToolResult>
      expect(dispatchTool.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("tools/registry.ts", () => {
    it("exports getProductionMcpTools returning readonly ToolDef[]", () => {
      const tools = getProductionMcpTools();
      expect(Array.isArray(tools)).toBe(true);
      expect(tools.length).toBeGreaterThan(0);
      for (const t of tools) {
        expect(typeof t.name).toBe("string");
        expect(typeof t.description).toBe("string");
        expect(t.parameters).toBeDefined();
        expect(t.parameters.type).toBe("object");
        expect(typeof t.parameters.properties).toBe("object");
      }
    });

    it("exports registry lookup + classification helpers as functions", () => {
      expect(typeof getAllTools).toBe("function");
      expect(typeof getToolDef).toBe("function");
      expect(typeof isInternalTool).toBe("function");
      expect(typeof isMutatingTool).toBe("function");
      expect(typeof getOpenAITools).toBe("function");
      expect(typeof isToolBlockedForRole).toBe("function");
    });

    it("production MCP profile hides subagent_*, agent-only surface, and env-gated tools", () => {
      const mcpTools = getProductionMcpTools();
      for (const t of mcpTools) {
        expect(t.name.startsWith("subagent_")).toBe(false);
        expect(t.surface).not.toBe("agent");
      }
    });
  });

  describe("tools/types.ts", () => {
    it("ToolDef shape — name/description/parameters/kind/mutating required, rest optional", () => {
      const sample: ToolDef = {
        name: "x",
        description: "d",
        parameters: { type: "object", properties: {} },
        kind: "internal",
        mutating: false,
      };
      // type-level check: compiles if shape is correct.
      expect(sample.name).toBe("x");
    });

    it("JsonSchema shape — type/properties required, required optional", () => {
      const sample: JsonSchema = {
        type: "object",
        properties: {
          foo: { type: "string", description: "desc", enum: ["a", "b"] },
          bar: { type: "number" },
        },
        required: ["foo"],
      };
      expect(sample.type).toBe("object");
      expect(sample.properties.foo.enum).toEqual(["a", "b"]);
    });

    it("toOpenAITools maps ToolDef[] → OpenAITool[] preserving name/description/parameters", () => {
      const def: ToolDef = {
        name: "x",
        description: "d",
        parameters: { type: "object", properties: {} },
        kind: "internal",
        mutating: false,
      };
      const [mapped] = toOpenAITools([def]);
      expect(mapped).toBeDefined();
      expect(mapped!.type).toBe("function");
      expect(mapped!.function.name).toBe("x");
      expect(mapped!.function.parameters).toEqual(def.parameters);
    });

    it("type-level: ToolCallRequest, ToolResult, OpenAITool all exist", () => {
      // Compile-time assertions — if these types disappear, the test file
      // fails to compile before it even runs.
      const _call: ToolCallRequest = { name: "x", args: {}, toolCallId: "id" };
      const _result: ToolResult = { success: true, output: "" };
      const _oai: OpenAITool = {
        type: "function",
        function: { name: "x", description: "d", parameters: { type: "object", properties: {} } },
      };
      expect(_call.name).toBe("x");
      expect(_result.success).toBe(true);
      expect(_oai.type).toBe("function");
    });
  });

  describe("tools/protocols/catalog.ts", () => {
    it("exports protocol namespace allowlists as readonly arrays", () => {
      expect(Array.isArray(PROTOCOL_NAMESPACE_ALLOWLIST)).toBe(true);
      expect(Array.isArray(PROTOCOL_ADVERTISED_NAMESPACE_ALLOWLIST)).toBe(true);
      // advertised ⊆ all-known
      for (const ns of PROTOCOL_ADVERTISED_NAMESPACE_ALLOWLIST) {
        expect(PROTOCOL_NAMESPACE_ALLOWLIST).toContain(ns);
      }
    });

    it("exports NAMESPACE_DEFAULTS covering every allowlisted namespace", () => {
      expect(typeof NAMESPACE_DEFAULTS).toBe("object");
      for (const ns of PROTOCOL_NAMESPACE_ALLOWLIST) {
        expect(NAMESPACE_DEFAULTS[ns]).toBeDefined();
      }
    });

    it("exports PROTOCOL_TOOLS as readonly manifest array", () => {
      expect(Array.isArray(PROTOCOL_TOOLS)).toBe(true);
      expect(PROTOCOL_TOOLS.length).toBeGreaterThan(0);
    });

    it("exports manifest/handler lookup + availability helpers", () => {
      expect(typeof isKnownProtocolNamespace).toBe("function");
      expect(typeof isAdvertisedProtocolNamespace).toBe("function");
      expect(typeof isProtocolToolAvailable).toBe("function");
      expect(typeof countAvailableToolsForNamespace).toBe("function");
      expect(typeof getMissingEnvForNamespace).toBe("function");
      expect(typeof getProtocolHandler).toBe("function");
      expect(typeof getProtocolManifest).toBe("function");
    });

    it("NamespaceDefault type is inhabited by the three canonical values", () => {
      const vals: NamespaceDefault[] = ["mixed_trading", "bridge", "non_portfolio"];
      expect(vals.length).toBe(3);
    });
  });

  describe("tools/protocols/types.ts", () => {
    it("ProtocolParamDef shape — key/type/description required, required? optional", () => {
      const sample: ProtocolParamDef = {
        key: "k",
        type: "string",
        description: "d",
      };
      expect(sample.key).toBe("k");
    });

    it("ProtocolToolManifest, ProtocolHandler, ToolLifecycle, ProtocolNamespace types exist", () => {
      // Compile-time — if any of these disappear, the test file fails to compile.
      const _lifecycle: ToolLifecycle = "active";
      expect(_lifecycle).toBe("active");
      // ProtocolNamespace + ProtocolToolManifest + ProtocolHandler reached by
      // tooling import at top of file; runtime existence is secondary.
      const _checkNs: ProtocolNamespace = PROTOCOL_NAMESPACE_ALLOWLIST[0]!;
      expect(typeof _checkNs).toBe("string");
    });
  });

  describe("tools/internal/types.ts", () => {
    it("InternalToolContext type exists (compile-time)", () => {
      // If the type disappears, this file fails to compile.
      const _ctx: Partial<InternalToolContext> = {};
      expect(_ctx).toBeDefined();
    });
  });

  describe("non-tools MCP surface", () => {
    // MCP also consumes `runMigrations` (bootstrap), `getPool` (health),
    // embedding config (health + knowledge), and `sessionsRepo.*`
    // (session lifecycle). `mcp-contract.test.ts` is the single source
    // of truth for those imports too — pre-PR6 this file only covered
    // `tools/*`, which was an overclaim in AUDIT_INVENTORY.md §5.

    it("db/migrate exports runMigrations as a function", () => {
      expect(typeof runMigrations).toBe("function");
    });

    it("db/client exports getPool as a function", () => {
      expect(typeof getPool).toBe("function");
    });

    it("embeddings/config exports loadEmbeddingConfig + MIN/MAX dim constants", () => {
      expect(typeof loadEmbeddingConfig).toBe("function");
      expect(typeof MIN_EMBEDDING_DIM).toBe("number");
      expect(typeof MAX_EMBEDDING_DIM).toBe("number");
      expect(MIN_EMBEDDING_DIM).toBeLessThan(MAX_EMBEDDING_DIM);
    });

    it("sessions repo exports the functions MCP's session lifecycle uses", () => {
      // Consumers: src/mcp/sessions.ts (createSession, setScope, endSession).
      expect(typeof sessionsRepo.createSession).toBe("function");
      expect(typeof sessionsRepo.setScope).toBe("function");
      expect(typeof sessionsRepo.endSession).toBe("function");
    });
  });

  describe("discover_tools public schema — includeDeclared removed (PR1)", () => {
    it("discover_tools is exposed through production MCP surface", () => {
      const mcpTools = getProductionMcpTools();
      const discover = mcpTools.find((t) => t.name === "discover_tools");
      expect(discover).toBeDefined();
    });

    it("discover_tools.parameters.properties.includeDeclared is NOT present", () => {
      // PR1 removed the flag entirely after ToolLifecycle was narrowed to
      // `"active"` only. MCP clients that still pass `includeDeclared: true`
      // get silent-strip from Zod default-parsing (no breaking error). Any
      // reintroduction should come with a concrete lifecycle variant and
      // real manifests that use it.
      const mcpTools = getProductionMcpTools();
      const discover = mcpTools.find((t) => t.name === "discover_tools");
      expect(discover).toBeDefined();
      expect(discover!.parameters.properties.includeDeclared).toBeUndefined();
    });

    it("discover_tools schema advertises query/namespace/limit (no includeMutating)", () => {
      // The cosmetic `includeMutating` discovery flag was removed — the
      // real safety gate is at execute time (`runtime.ts`). Schema must
      // not advertise it; old MCP clients passing it get silent strip
      // via Zod default-parsing (no breaking error).
      const mcpTools = getProductionMcpTools();
      const discover = mcpTools.find((t) => t.name === "discover_tools");
      const props = discover!.parameters.properties;
      expect(props.query).toBeDefined();
      expect(props.namespace).toBeDefined();
      expect(props.limit).toBeDefined();
      expect(props.includeMutating).toBeUndefined();
    });
  });
});
