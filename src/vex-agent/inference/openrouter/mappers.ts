/**
 * OpenRouter message mapping, response parsing, and streaming accumulation.
 */

import type { ChatResult } from "@openrouter/sdk/models/chatresult.js";
import type { ChatRequest } from "@openrouter/sdk/models/chatrequest.js";
import type { ChatToolCall } from "@openrouter/sdk/models/chattoolcall.js";
import type { ChatStreamToolCall } from "@openrouter/sdk/models/chatstreamtoolcall.js";

import type {
  InferenceResponse,
  InferenceUsage,
  ParsedToolCall,
  StreamChunk,
  ProviderMessage,
} from "../types.js";

import logger from "@utils/logger.js";

// ── Message mapping ──────────────────────────────────────────────

const TOOL_RESULT_PLACEHOLDER_CONTENT =
  "[Engine: tool execution did not complete — placeholder]";

export function mapMessages(messages: ProviderMessage[]): ChatRequest["messages"] {
  const mapped = messages.map(m => {
    if (m.role === "tool" && m.toolCallId) {
      return { role: "tool" as const, content: m.content, toolCallId: m.toolCallId };
    }

    if (m.role === "assistant" && m.toolCalls?.length) {
      return {
        role: "assistant" as const,
        content: m.content || undefined,
        toolCalls: m.toolCalls.map(tc => ({
          id: tc.id ?? "",
          type: "function" as const,
          function: { name: tc.command, arguments: JSON.stringify(tc.args) },
        })),
      };
    }

    if (m.role === "system") return { role: "system" as const, content: m.content };
    if (m.role === "assistant") return { role: "assistant" as const, content: m.content || undefined };
    return { role: "user" as const, content: m.content };
  });

  return synthesizeMissingToolResults(mapped);
}

type MappedMessage = ChatRequest["messages"][number];

/**
 * Defence-in-depth safety belt that mirrors `repairOrphanedToolCalls` at the
 * SDK boundary. The engine layer already runs the chronological repair on
 * `ProviderMessage`, but any caller that bypasses `executeTurn` (direct SDK
 * use, future tool surfaces, simple completion paths) must not be allowed
 * to send a request that ends with `assistant{tool_calls}` whose ids are not
 * paired with adjacent `tool` rows. Every chat-completions provider rejects
 * that shape; DeepSeek's adapter surfaces it as the
 * "Function call should not be used with prefix" error.
 *
 * Idempotent: if matched tool messages already follow each assistant's
 * tool_calls, the input passes through unchanged. Skips orphans whose id is
 * blank — the request would still fail at validation, but with a clearer
 * upstream error than a server 400.
 */
export function synthesizeMissingToolResults(
  mapped: ChatRequest["messages"],
): ChatRequest["messages"] {
  const result: ChatRequest["messages"] = [];
  let inserted = 0;

  for (let i = 0; i < mapped.length; i++) {
    const msg = mapped[i];
    result.push(msg);

    if (msg.role !== "assistant") continue;
    const calls = msg.toolCalls;
    if (!calls || calls.length === 0) continue;

    const wantedIds: string[] = [];
    for (const c of calls) {
      if (typeof c.id === "string" && c.id.length > 0) wantedIds.push(c.id);
    }
    if (wantedIds.length === 0) continue;

    const matched = new Set<string>();
    let j = i + 1;
    while (j < mapped.length && mapped[j].role === "tool") {
      const next = mapped[j];
      const id = "toolCallId" in next ? next.toolCallId : undefined;
      if (typeof id === "string" && wantedIds.includes(id)) matched.add(id);
      result.push(next);
      j += 1;
    }
    i = j - 1;

    for (const id of wantedIds) {
      if (matched.has(id)) continue;
      const placeholder: MappedMessage = {
        role: "tool" as const,
        content: TOOL_RESULT_PLACEHOLDER_CONTENT,
        toolCallId: id,
      };
      result.push(placeholder);
      inserted += 1;
    }
  }

  if (inserted > 0) {
    logger.warn("inference.openrouter.mapper_repair", { inserted });
  }
  return result;
}

// ── Response parsing ─────────────────────────────────────────────

export function extractUsage(raw: { promptTokens?: number; completionTokens?: number; totalTokens?: number; cost?: number | null; completionTokensDetails?: { reasoningTokens?: number | null } | null; promptTokensDetails?: { cachedTokens?: number } | null } | undefined): InferenceUsage {
  return {
    promptTokens: raw?.promptTokens ?? 0,
    completionTokens: raw?.completionTokens ?? 0,
    totalTokens: raw?.totalTokens ?? 0,
    cachedTokens: raw?.promptTokensDetails?.cachedTokens ?? undefined,
    reasoningTokens: raw?.completionTokensDetails?.reasoningTokens ?? undefined,
    // OpenRouter returns `usage.cost` (USD) automatically on every response;
    // the engine prefers it over the local price-table estimate. `null` when
    // unreported. (The renderer stream preview never receives this — it is
    // stripped at the stream bridge boundary.)
    cost: raw?.cost ?? undefined,
  };
}

export function parseNonStreamingResponse(response: ChatResult): InferenceResponse {
  const choice = response.choices?.[0];
  const msg = choice?.message;
  const usage = extractUsage(response.usage);

  // Tool calls
  const sdkToolCalls: ChatToolCall[] | undefined = msg?.toolCalls;
  if (sdkToolCalls?.length) {
    const parsed: ParsedToolCall[] = [];
    for (const tc of sdkToolCalls) {
      try {
        parsed.push({
          id: tc.id,
          name: tc.function.name,
          arguments: JSON.parse(tc.function.arguments),
        });
      } catch {
        logger.warn("inference.openrouter.malformed_tool_args", {
          name: tc.function.name,
          raw: tc.function.arguments.slice(0, 200),
        });
      }
    }
    if (parsed.length > 0) {
      return {
        content: typeof msg?.content === "string" ? msg.content : null,
        toolCalls: parsed,
        usage,
        reasoning: msg?.reasoning ?? null,
      };
    }
  }

  // Text response
  const content = typeof msg?.content === "string" ? msg.content : "";
  return {
    content,
    toolCalls: null,
    usage,
    reasoning: msg?.reasoning ?? null,
  };
}

// ── Streaming tool call delta accumulation ────────────────────────

export function* processToolCallDelta(
  tc: ChatStreamToolCall,
  accumulator: Map<number, { id: string; name: string; argsBuffer: string }>,
): Generator<StreamChunk> {
  const idx = tc.index;

  if (!accumulator.has(idx)) {
    accumulator.set(idx, { id: tc.id ?? "", name: "", argsBuffer: "" });
  }

  const acc = accumulator.get(idx)!;

  if (tc.id) acc.id = tc.id;
  if (tc.function?.name) acc.name = tc.function.name;

  const chunk: StreamChunk = {
    type: "tool_call_delta",
    toolCallIndex: idx,
  };

  // First chunk for this tool call — emit id + name
  if (tc.id) chunk.toolCallId = tc.id;
  if (tc.function?.name) chunk.toolCallName = tc.function.name;

  // Arguments delta (incremental JSON string)
  if (tc.function?.arguments) {
    acc.argsBuffer += tc.function.arguments;
    chunk.toolCallArgsDelta = tc.function.arguments;
  }

  yield chunk;
}
