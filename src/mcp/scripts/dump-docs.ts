/**
 * dump-docs — emit every payload the production MCP server hands the model.
 *
 * Renders a single markdown bundle containing:
 *   1. `instructions` (handshake preamble from `buildInstructions`)
 *   2. The full production tool surface (`getProductionMcpTools`)
 *   3. `docs://overview`
 *   4. `docs://tools`
 *   5. `docs://protocols`
 *   6. `docs://protocols/{namespace}` for every advertised namespace
 *   7. `surface://manifest`
 *   8. `runtime://env`
 *   9. Every workflow prompt registered by `registerWorkflowPrompts`
 *
 * Run:
 *   pnpm exec tsx src/mcp/scripts/dump-docs.ts             # → /tmp/vex-mcp-docs.md
 *   pnpm exec tsx src/mcp/scripts/dump-docs.ts --out PATH  # custom path
 *
 * Env-gating note
 * ───────────────
 * The script primes JUPITER_API_KEY / POLYMARKET_API_KEY / TAVILY_API_KEY
 * with placeholder values BEFORE importing the registry. Reason: those
 * keys gate solana / polymarket-clob / web_research tools at registry-import
 * time, and the goal of the dump is to show the FULL advertised surface
 * the model would see in a fully-configured deployment. Comment those
 * three lines out (or set the keys yourself before running) to inspect
 * the env-aware shrunken view that matches your actual shell env.
 *
 * The script does NOT touch the database or the embedding service. It
 * only reads in-memory registry projections, so it is safe to run with
 * `VEX_DB_URL` unset.
 */

// MUST run before any registry import — manifests are filtered against
// process.env at module-evaluation time inside discover_tools / catalog.
process.env.JUPITER_API_KEY ??= "dump-docs-placeholder";
process.env.POLYMARKET_API_KEY ??= "dump-docs-placeholder";
process.env.TAVILY_API_KEY ??= "dump-docs-placeholder";

// Quiet the embedding config validator. `safeLoadEmbeddingConfig` swallows
// the throw, but the underlying loader logs four warnings before throwing.
// Setting placeholders here keeps the dump output clean. The values are
// fake — the script never calls the embedding service.
process.env.EMBEDDING_BASE_URL ??= "http://localhost:12434/engines/llama.cpp/v1";
process.env.EMBEDDING_MODEL ??= "ai/embeddinggemma:300M-Q8_0";
process.env.EMBEDDING_DIM ??= "768";
process.env.EMBEDDING_PROVIDER ??= "local";

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import {
  buildOverview,
  buildToolGroups,
  buildProtocolList,
  buildProtocolNamespace,
  buildSurfaceManifest,
  buildRuntimeEnv,
} from "../docs/registry-projection.js";
import { buildInstructions } from "../docs/instructions.js";
import { registerWorkflowPrompts } from "../docs/prompts.js";
import { getProductionMcpTools } from "@vex-agent/tools/registry.js";
import { PROTOCOL_ADVERTISED_NAMESPACE_ALLOWLIST } from "@vex-agent/tools/protocols/catalog.js";

// ── Workflow prompt recorder ────────────────────────────────────
//
// `registerWorkflowPrompts` only exposes its text via the MCP server
// callback chain. We mock the minimum surface (`registerPrompt`) so we
// can capture each prompt's title/description/text without spinning up
// a real `McpServer` instance.

interface RecordedPrompt {
  name: string;
  title: string;
  description: string;
  text: string;
}

interface PromptCallbackResult {
  messages: ReadonlyArray<{ content: { text: string } }>;
}

const recordedPrompts: RecordedPrompt[] = [];

const promptRecorder = {
  registerPrompt(
    name: string,
    meta: { title: string; description: string },
    handler: () => PromptCallbackResult,
  ): void {
    const result = handler();
    const text = result.messages[0]?.content.text ?? "";
    recordedPrompts.push({
      name,
      title: meta.title,
      description: meta.description,
      text,
    });
  },
};

registerWorkflowPrompts(promptRecorder as unknown as McpServer);

// ── Markdown helpers ────────────────────────────────────────────

function fence(lang: string, body: string): string {
  return "```" + lang + "\n" + body + "\n```";
}

function jsonBlock(value: unknown): string {
  return fence("json", JSON.stringify(value, null, 2));
}

// ── Output assembly ─────────────────────────────────────────────

const tools = getProductionMcpTools();
const lines: string[] = [];

lines.push("# Vex MCP — model-facing documentation dump");
lines.push("");
lines.push(`Generated at \`${new Date().toISOString()}\`.`);
lines.push("");
lines.push(
  "Every payload the production MCP server hands the model: the handshake " +
    "`instructions`, the registered tool surface, every `docs://*` / " +
    "`surface://*` / `runtime://*` resource, and every workflow prompt. " +
    "Env-gated tools are surfaced because this script primes " +
    "`JUPITER_API_KEY` / `POLYMARKET_API_KEY` / `TAVILY_API_KEY` with " +
    "placeholders before importing the registry — comment those out in the " +
    "script to see the env-aware shrunken view.",
);
lines.push("");
lines.push("---");
lines.push("");

// 1. instructions
lines.push("## 1. `instructions` (handshake preamble)");
lines.push("");
lines.push(
  "Surfaced via `ServerOptions.instructions` on `initialize`. The host " +
    "MCP client (Claude Code / Cursor / Codex) shows this to the agent " +
    "before any tool call.",
);
lines.push("");
lines.push(fence("markdown", buildInstructions()));
lines.push("");

// 2. Tool list
lines.push("## 2. Production tool surface (`tools/list`)");
lines.push("");
lines.push(
  `${tools.length} tools registered. Each tool is a separate ` +
    "`tools/list` entry with its own name, description, and JSON schema.",
);
lines.push("");
for (const tool of tools) {
  lines.push(`### \`${tool.name}\`${tool.mutating ? " — _mutating_" : ""}`);
  lines.push("");
  lines.push(tool.description);
  lines.push("");
  lines.push(jsonBlock(tool.parameters));
  lines.push("");
}

// 3. docs://overview
lines.push("## 3. `docs://overview`");
lines.push("");
lines.push(jsonBlock(buildOverview()));
lines.push("");

// 4. docs://tools
lines.push("## 4. `docs://tools`");
lines.push("");
lines.push("Internal tool catalog grouped by capability family.");
lines.push("");
lines.push(jsonBlock(buildToolGroups()));
lines.push("");

// 5. docs://protocols
lines.push("## 5. `docs://protocols`");
lines.push("");
lines.push(
  "Advertised protocol namespace overview. Each entry includes " +
    "`activeToolCount` (env-aware) and `gatedByEnv` (envs that would unlock more).",
);
lines.push("");
lines.push(jsonBlock(buildProtocolList()));
lines.push("");

// 6. docs://protocols/{namespace}
lines.push("## 6. `docs://protocols/{namespace}` per namespace");
lines.push("");
for (const ns of PROTOCOL_ADVERTISED_NAMESPACE_ALLOWLIST) {
  lines.push(`### \`docs://protocols/${ns}\``);
  lines.push("");
  lines.push(jsonBlock(buildProtocolNamespace(ns)));
  lines.push("");
}

// 7. surface://manifest
lines.push("## 7. `surface://manifest`");
lines.push("");
lines.push(jsonBlock(buildSurfaceManifest()));
lines.push("");

// 8. runtime://env
lines.push("## 8. `runtime://env`");
lines.push("");
lines.push("Presence flags only — never values.");
lines.push("");
lines.push(jsonBlock(buildRuntimeEnv()));
lines.push("");

// 9. workflow prompts
lines.push("## 9. Workflow prompts (`prompts/list`)");
lines.push("");
lines.push(
  `${recordedPrompts.length} prompts registered. Hosts surface these on ` +
    "demand via the MCP `prompts/get` handshake.",
);
lines.push("");
for (const prompt of recordedPrompts) {
  lines.push(`### \`${prompt.name}\` — ${prompt.title}`);
  lines.push("");
  lines.push(`_${prompt.description}_`);
  lines.push("");
  lines.push(fence("markdown", prompt.text));
  lines.push("");
}

// ── Write ───────────────────────────────────────────────────────

function parseOutPath(argv: readonly string[]): string {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--out") {
      const value = argv[i + 1];
      if (!value) throw new Error("--out requires a path argument");
      return value;
    }
  }
  return "/tmp/vex-mcp-docs.md";
}

const outPath = parseOutPath(process.argv.slice(2));
const body = lines.join("\n");

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, body, "utf8");

process.stdout.write(`vex-mcp docs dumped to ${outPath}\n`);
process.stdout.write(`size: ${body.length} chars, ${lines.length} lines\n`);
process.stdout.write(
  `tools: ${tools.length}, protocol namespaces: ${PROTOCOL_ADVERTISED_NAMESPACE_ALLOWLIST.length}, prompts: ${recordedPrompts.length}\n`,
);
