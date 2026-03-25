/**
 * Shared factory functions for agent test data.
 * Eliminates magic values and makes tests self-documenting.
 */

import type {
  InferenceConfig,
  ConversationSession,
  Message,
  MessageRole,
  ToolCall,
  ToolResult,
  InternalToolCall,
  InternalToolType,
  ParsedToolCall,
  InferenceResponse,
  TradeEntry,
  TradeType,
  TradeStatus,
  ApprovalItem,
  ApprovalStatus,
  LoopState,
  LoopPhase,
  LoopMode,
  SubagentState,
  SubagentStatus,
  AutonomyInboxEvent,
  AutonomyEventType,
  RequestUsage,
  UsageState,
  AgentEvent,
  AgentEventType,
} from "../../agent/types.js";

import type { ProviderBalance } from "../../agent/providers/types.js";

// ── Inference Config ────────────────────────────────────────────────

export function mockInferenceConfig(overrides?: Partial<InferenceConfig>): InferenceConfig {
  return {
    provider: "openrouter",
    model: "anthropic/claude-sonnet-4",
    endpoint: "https://openrouter.ai/api/v1/chat/completions",
    contextLimit: 65_000,
    inputPricePerM: 3.0,
    outputPricePerM: 15.0,
    priceCurrency: "USD",
    ...overrides,
  };
}

// ── Message ─────────────────────────────────────────────────────────

export function mockMessage(
  role: MessageRole,
  content: string,
  overrides?: Partial<Message>,
): Message {
  return {
    role,
    content,
    timestamp: "2026-03-25T12:00:00Z",
    ...overrides,
  };
}

// ── Conversation Session ────────────────────────────────────────────

export function mockSession(overrides?: Partial<ConversationSession>): ConversationSession {
  return {
    id: "session-test-001",
    messages: [],
    loadedKnowledge: new Map(),
    inferenceConfig: mockInferenceConfig(),
    ...overrides,
  };
}

// ── Tool Call (CLI) ─────────────────────────────────────────────────

export function mockToolCall(
  command: string,
  args?: Record<string, string | boolean | number>,
  overrides?: Partial<ToolCall>,
): ToolCall {
  return {
    command,
    args: args ?? {},
    confirm: false,
    ...overrides,
  };
}

// ── Tool Result ─────────────────────────────────────────────────────

export function mockToolResult(overrides?: Partial<ToolResult>): ToolResult {
  return {
    id: "tool-result-001",
    command: "wallet balance",
    success: true,
    output: '{"balance": "1.5"}',
    argv: ["wallet", "balance"],
    durationMs: 150,
    ...overrides,
  };
}

// ── Internal Tool Call ──────────────────────────────────────────────

export function mockInternalToolCall(
  type: InternalToolType,
  params?: Record<string, unknown>,
  overrides?: Partial<InternalToolCall>,
): InternalToolCall {
  return {
    type,
    params: params ?? {},
    toolCallId: "call_test_001",
    ...overrides,
  };
}

// ── Parsed Tool Call (from inference response) ──────────────────────

export function mockParsedToolCall(
  name: string,
  args?: Record<string, unknown>,
  overrides?: Partial<ParsedToolCall>,
): ParsedToolCall {
  return {
    id: "call_abc123",
    name,
    arguments: args ?? {},
    ...overrides,
  };
}

// ── Inference Response ──────────────────────────────────────────────

export function mockInferenceResponse(overrides?: Partial<InferenceResponse>): InferenceResponse {
  return {
    content: "I'll help you with that.",
    toolCalls: null,
    usage: { promptTokens: 500, completionTokens: 100 },
    ...overrides,
  };
}

// ── Request Usage ───────────────────────────────────────────────────

export function mockRequestUsage(overrides?: Partial<RequestUsage>): RequestUsage {
  return {
    promptTokens: 500,
    completionTokens: 100,
    totalTokens: 600,
    cost: 0.003,
    ...overrides,
  };
}

// ── Usage State ─────────────────────────────────────────────────────

export function mockUsageState(overrides?: Partial<UsageState>): UsageState {
  return {
    sessionTokens: 5000,
    sessionCost: 0.025,
    lifetimeTokens: 500_000,
    lifetimeCost: 2.5,
    requestCount: 100,
    lastRequestAt: "2026-03-25T12:00:00Z",
    lastBackupAt: "2026-03-25T11:00:00Z",
    ...overrides,
  };
}

// ── Provider Balance ────────────────────────────────────────────────

export function mockProviderBalance(overrides?: Partial<ProviderBalance>): ProviderBalance {
  return {
    availableDisplay: "44.99 0G",
    availableRaw: 44.99,
    currency: "0G",
    isLow: false,
    total: 50.0,
    available: 44.99,
    locked: 5.01,
    ...overrides,
  };
}

// ── Trade Entry ─────────────────────────────────────────────────────

export function mockTradeEntry(overrides?: Partial<TradeEntry>): TradeEntry {
  return {
    id: "trade-test-001",
    timestamp: "2026-03-25T12:00:00Z",
    type: "swap" as TradeType,
    chain: "solana",
    status: "executed" as TradeStatus,
    input: { token: "SOL", amount: "1.0", valueUsd: 150 },
    output: { token: "USDC", amount: "150.0", valueUsd: 150 },
    meta: { dex: "jupiter" },
    ...overrides,
  };
}

// ── Approval Item ───────────────────────────────────────────────────

export function mockApprovalItem(overrides?: Partial<ApprovalItem>): ApprovalItem {
  return {
    id: "approval-test-001",
    toolCall: mockToolCall("solana swap execute", { "--from": "SOL", "--to": "USDC", "--amount": "1.0" }),
    reasoning: "Swap 1 SOL to USDC for portfolio rebalancing",
    estimatedCost: "$0.01",
    status: "pending" as ApprovalStatus,
    createdAt: "2026-03-25T12:00:00Z",
    resolvedAt: null,
    ...overrides,
  };
}

// ── Loop State ──────────────────────────────────────────────────────

export function mockLoopState(overrides?: Partial<LoopState>): LoopState {
  return {
    active: false,
    mode: "full" as LoopMode,
    intervalMs: 300_000,
    startedAt: null,
    lastCycleAt: null,
    cycleCount: 0,
    currentPhase: "idle" as LoopPhase,
    phaseStartedAt: null,
    loopSessionId: null,
    ...overrides,
  };
}

// ── Subagent State ──────────────────────────────────────────────────

export function mockSubagentState(overrides?: Partial<SubagentState>): SubagentState {
  return {
    id: "sub-test-001",
    name: "research-agent",
    task: "Analyze market trends",
    status: "running" as SubagentStatus,
    allowTrades: false,
    parentSessionId: "session-parent-001",
    sessionId: "session-sub-001",
    startedAt: "2026-03-25T12:00:00Z",
    endedAt: null,
    result: null,
    error: null,
    tokenCost: 0,
    iterations: 0,
    maxIterations: 25,
    ...overrides,
  };
}

// ── Autonomy Inbox Event ────────────────────────────────────────────

export function mockInboxEvent(overrides?: Partial<AutonomyInboxEvent>): AutonomyInboxEvent {
  return {
    id: 1,
    eventType: "subagent_completed" as AutonomyEventType,
    payload: { subagentId: "sub-001", result: "Analysis complete" },
    consumed: false,
    createdAt: "2026-03-25T12:00:00Z",
    ...overrides,
  };
}

// ── Agent Event (SSE) ───────────────────────────────────────────────

export function mockAgentEvent(
  type: AgentEventType,
  data?: Record<string, unknown>,
): AgentEvent {
  return { type, data: data ?? {} };
}

// ── Emit Spy ────────────────────────────────────────────────────────

import { vi } from "vitest";

export function createEmitSpy() {
  return vi.fn<(event: AgentEvent) => void>();
}

/**
 * Collects all events of a specific type from an emit spy.
 */
export function getEmittedEvents(
  emitSpy: ReturnType<typeof createEmitSpy>,
  type: AgentEventType,
): AgentEvent[] {
  return emitSpy.mock.calls
    .map(([event]) => event)
    .filter((e) => e.type === type);
}
