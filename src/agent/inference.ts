/**
 * Inference layer — provider-agnostic OpenAI-compatible HTTP transport.
 *
 * Delegates auth and config to the active InferenceProvider.
 * Handles request building, streaming, tool calling, and retry logic.
 */

import { resolveProvider, getActiveProvider } from "./providers/registry.js";
import type { InferenceProvider } from "./providers/types.js";
import type { Message, StreamChunk, InferenceConfig, InferenceResponse, ParsedToolCall } from "./types.js";
import type { OpenAITool } from "./tool-registry.js";
import { sanitizeContent } from "./tool-parser.js";
import { retryWithBackoff, isRetryableError } from "./resilience.js";
import type { RetryOptions } from "./resilience.js";

const INFERENCE_RETRY: RetryOptions = {
  maxRetries: 2,
  baseDelayMs: 2000,
  maxDelayMs: 15_000,
  jitter: true,
  shouldRetry: isRetryableError,
};

export type { InferenceConfig, InferenceResponse, ParsedToolCall } from "./types.js";
import logger from "../utils/logger.js";

// ── Config resolution (delegated to provider) ───────────────────────

/**
 * Load inference config from the active provider.
 * Returns provider, model, endpoint, and context limit.
 */
export async function loadInferenceConfig(): Promise<InferenceConfig | null> {
  const provider = await resolveProvider();
  if (!provider) return null;
  return provider.loadConfig();
}

// ── Request building ─────────────────────────────────────────────────

interface OpenAIMessage {
  role: string;
  content: string | null;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
}

interface ChatCompletionRequest {
  model: string;
  messages: OpenAIMessage[];
  stream: boolean;
  max_tokens?: number;
  temperature?: number;
}

/**
 * Build OpenAI-compatible message array from our Message type.
 * Preserves tool_call_id for tool results and tool_calls for assistant messages.
 */
function buildRequest(
  model: string,
  messages: Message[],
  stream: boolean,
): ChatCompletionRequest {
  const openaiMessages: OpenAIMessage[] = messages.map(m => {
    // Tool result messages: must include tool_call_id
    if (m.role === "tool" && m.toolCallId) {
      return { role: "tool", content: m.content, tool_call_id: m.toolCallId };
    }

    // Assistant messages with tool calls: include tool_calls array
    if (m.role === "assistant" && m.toolCalls && m.toolCalls.length > 0) {
      return {
        role: "assistant",
        content: m.content || null,
        tool_calls: m.toolCalls.map(tc => ({
          id: tc.id,
          type: "function" as const,
          function: { name: tc.command, arguments: JSON.stringify(tc.args) },
        })),
      };
    }

    // Regular messages
    return { role: m.role, content: m.content };
  });

  return {
    model,
    messages: openaiMessages,
    stream,
    max_tokens: 8192,
    temperature: 0.7,
  };
}

// ── Auth headers (delegated to provider) ─────────────────────────────

async function getAuthHeaders(provider: string, content: string): Promise<Record<string, string>> {
  const active = getActiveProvider();
  if (!active) throw new Error("No inference provider configured");
  return active.getAuthHeaders(content);
}

// ── Non-streaming inference ──────────────────────────────────────────

export interface InferenceResult {
  content: string;
  finishReason: string | null;
  usage: { promptTokens: number; completionTokens: number };
}

export async function inferNonStreaming(
  config: InferenceConfig,
  messages: Message[],
): Promise<InferenceResult> {
  // SDK path: provider handles inference natively (OpenRouter)
  const provider = getActiveProvider();
  if (provider?.chatCompletionSimple) {
    const result = await provider.chatCompletionSimple(messages, config);
    return { content: result.content, finishReason: "stop", usage: result.usage };
  }

  // Legacy raw fetch path (0G Compute) — with retry for transient failures
  return retryWithBackoff(async () => {
  const request = buildRequest(config.model, messages, false);
  const contentForAuth = JSON.stringify(request.messages);
  const authHeaders = await getAuthHeaders(config.provider, contentForAuth);

  const url = `${config.endpoint}/chat/completions`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120_000);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify(request),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      throw new Error(`Inference provider returned ${response.status}: ${errText.slice(0, 200)}`);
    }

    const json = await response.json() as {
      choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };

    const choice = json.choices?.[0];
    return {
      content: choice?.message?.content ?? "",
      finishReason: choice?.finish_reason ?? null,
      usage: {
        promptTokens: json.usage?.prompt_tokens ?? 0,
        completionTokens: json.usage?.completion_tokens ?? 0,
      },
    };
  } catch (err) {
    clearTimeout(timeout);
    throw err;
  }
  }, { maxRetries: 2, baseDelayMs: 1000 }, "inferNonStreaming");
}

// ── Streaming inference ──────────────────────────────────────────────

/**
 * Stream inference results as an async generator of chunks.
 * Each chunk contains either content text, finish reason, or usage data.
 */
export async function* inferStreaming(
  config: InferenceConfig,
  messages: Message[],
): AsyncGenerator<StreamChunk> {
  const request = buildRequest(config.model, messages, true);
  const contentForAuth = JSON.stringify(request.messages);
  const authHeaders = await getAuthHeaders(config.provider, contentForAuth);

  const url = `${config.endpoint}/chat/completions`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 300_000);

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify(request),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeout);
    throw err;
  }

  if (!response.ok) {
    clearTimeout(timeout);
    const errText = await response.text().catch(() => "");
    throw new Error(`Inference provider returned ${response.status}: ${errText.slice(0, 200)}`);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    clearTimeout(timeout);
    throw new Error("No response body reader available");
  }

  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith("data: ")) continue;

        const data = trimmed.slice(6);
        if (data === "[DONE]") {
          clearTimeout(timeout);
          return;
        }

        try {
          const chunk = JSON.parse(data) as {
            choices?: Array<{
              delta?: { content?: string };
              finish_reason?: string | null;
            }>;
            usage?: { prompt_tokens?: number; completion_tokens?: number };
          };

          const delta = chunk.choices?.[0]?.delta;
          const finishReason = chunk.choices?.[0]?.finish_reason ?? null;
          const usage = chunk.usage
            ? { promptTokens: chunk.usage.prompt_tokens ?? 0, completionTokens: chunk.usage.completion_tokens ?? 0 }
            : null;

          yield {
            content: delta?.content ?? null,
            finishReason,
            usage,
          };
        } catch {
          // Skip unparseable chunks
        }
      }
    }
  } finally {
    clearTimeout(timeout);
  }
}

// ── Native OpenAI function calling ──────────────────────────────────

/**
 * Infer with native OpenAI function calling.
 *
 * 0G providers (GLM-5, DeepSeek, Qwen) support the `tools` parameter natively.
 * Response includes `tool_calls` in standard OpenAI format.
 * Non-streaming: tool_calls require full response for structured parsing.
 *
 * Defense-in-depth: if model returns text content with embedded tool call
 * artifacts (known GLM-5 issue), falls back to content parser.
 */
export async function inferWithTools(
  config: InferenceConfig,
  messages: Message[],
  tools: OpenAITool[],
): Promise<InferenceResponse> {
  // SDK path: provider handles retry natively — no double backoff
  const provider = getActiveProvider();
  if (provider?.chatCompletion) {
    return provider.chatCompletion(messages, tools, config);
  }
  // Legacy raw fetch path (0G Compute) — needs our retry wrapper
  return retryWithBackoff(
    () => doInferWithTools(config, messages, tools),
    INFERENCE_RETRY,
    "inference",
  );
}

async function doInferWithTools(
  config: InferenceConfig,
  messages: Message[],
  tools: OpenAITool[],
): Promise<InferenceResponse> {
  const request = buildRequest(config.model, messages, false);

  // Add tools to request (native OpenAI function calling)
  const body: Record<string, unknown> = { ...request };
  if (tools.length > 0) {
    body.tools = tools;
    body.tool_choice = "auto";
  }

  const contentForAuth = JSON.stringify(body.messages);
  const authHeaders = await getAuthHeaders(config.provider, contentForAuth);

  const url = `${config.endpoint}/chat/completions`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 300_000);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      throw new Error(`Inference provider returned ${response.status}: ${errText.slice(0, 200)}`);
    }

    const json = await response.json() as {
      choices?: Array<{
        message?: {
          content?: string | null;
          tool_calls?: Array<{
            id: string;
            type: "function";
            function: { name: string; arguments: string };
          }>;
        };
        finish_reason?: string;
      }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };

    const choice = json.choices?.[0];
    const msg = choice?.message;
    const usage = {
      promptTokens: json.usage?.prompt_tokens ?? 0,
      completionTokens: json.usage?.completion_tokens ?? 0,
    };

    // Native tool_calls in response — skip malformed, don't degrade to {}
    if (msg?.tool_calls && msg.tool_calls.length > 0) {
      const toolCalls: ParsedToolCall[] = [];
      for (const tc of msg.tool_calls) {
        try {
          const args = JSON.parse(tc.function.arguments);
          toolCalls.push({ id: tc.id, name: tc.function.name, arguments: args });
        } catch {
          logger.warn("agent.inference.malformed_tool_args", {
            name: tc.function.name, raw: tc.function.arguments.slice(0, 200),
          });
        }
      }
      if (toolCalls.length > 0) {
        return { content: null, toolCalls, usage };
      }
      // All tool calls malformed → fall through to text response
    }

    // Text response — sanitize any stray artifacts
    const rawContent = msg?.content ?? "";
    return { content: sanitizeContent(rawContent), toolCalls: null, usage };
  } catch (err) {
    clearTimeout(timeout);
    throw err;
  }
}
