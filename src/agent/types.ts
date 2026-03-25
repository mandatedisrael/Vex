/**
 * Core types for the Echo Agent.
 * Shared between server, engine, handlers, and UI API layer.
 */

// ── Tool calling ─────────────────────────────────────────────────────

export interface ToolCall {
  /** CLI command (e.g. "wallet balance", "jaine swap sell"). */
  command: string;
  /** CLI arguments as key-value pairs (e.g. {"--amount": "1.0"}). */
  args: Record<string, string | boolean | number>;
  /** Whether this mutation requires user approval in restricted mode. */
  confirm: boolean;
}

export interface ToolResult {
  id: string;
  command: string;
  success: boolean;
  output: string;
  argv: string[];
  durationMs: number;
}

// ── Internal tools (file ops, memory updates) ────────────────────────

export type InternalToolType =
  | "web_search" | "web_fetch"
  | "file_read" | "file_write" | "file_list" | "file_delete"
  | "memory_update" | "memory_manage" | "trade_log"
  | "schedule_create" | "schedule_remove"
  | "subagent_spawn" | "subagent_status" | "subagent_stop";

export interface InternalToolCall {
  type: InternalToolType;
  params: Record<string, unknown>;
  /** Tool call ID from the model — must be preserved for round-trip */
  toolCallId?: string;
}

// ── Messages ─────────────────────────────────────────────────────────

export type MessageRole = "system" | "user" | "assistant" | "tool";

export interface Message {
  role: MessageRole;
  content: string;
  /** For tool results: links back to the tool call. */
  toolCallId?: string;
  /** For assistant messages: tool calls made in this message (for round-trip). */
  toolCalls?: Array<{ id: string; command: string; args: Record<string, unknown> }>;
  /** Timestamp of when message was created. */
  timestamp: string;
}

// ── Conversation session (isolated per request chain) ────────────────

export interface ConversationSession {
  id: string;
  messages: Message[];
  loadedKnowledge: Map<string, string>;
  inferenceConfig: InferenceConfig;
  /** Real prompt_tokens from last inference (used for hybrid compaction budget). */
  lastPromptTokens?: number;
  /** messages.length at the time lastPromptTokens was recorded. */
  messageCountAtSnapshot?: number;
}

// ── Session ──────────────────────────────────────────────────────────

export interface SessionInfo {
  id: string;
  startedAt: string;
  messageCount: number;
  tokenCount: number;
  compacted: boolean;
}

// ── SSE events ───────────────────────────────────────────────────────

export type AgentEventType =
  | "status"
  | "text_delta"
  | "tool_start"
  | "tool_result"
  | "approval_required"
  | "file_update"
  | "usage"
  | "balance_low"
  | "error"
  | "done"
  | "loop_phase"
  | "subagent_spawned"
  | "subagent_progress"
  | "subagent_completed"
  | "topup_event";

export interface AgentEvent {
  type: AgentEventType;
  data: Record<string, unknown>;
}

// ── Usage tracking ───────────────────────────────────────────────────

export interface RequestUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cost: number;
}

export interface UsageState {
  sessionTokens: number;
  sessionCost: number;
  lifetimeTokens: number;
  lifetimeCost: number;
  requestCount: number;
  lastRequestAt: string | null;
  lastBackupAt: string | null;
}

// ── Loop ─────────────────────────────────────────────────────────────

export type LoopMode = "full" | "restricted";
/** Chat/engine mode — extends LoopMode with "off" for manual/respond-only */
export type ChatMode = LoopMode | "off";

const VALID_CHAT_MODES = new Set<string>(["full", "restricted", "off"]);
/** Runtime guard for ChatMode — validates values from DB or external input. */
export function toChatMode(value: unknown): ChatMode {
  if (typeof value === "string" && VALID_CHAT_MODES.has(value)) return value as ChatMode;
  return "restricted";
}

export interface LoopState {
  active: boolean;
  mode: LoopMode;
  intervalMs: number;
  startedAt: string | null;
  lastCycleAt: string | null;
  cycleCount: number;
  currentPhase: LoopPhase;
  phaseStartedAt: string | null;
  loopSessionId: string | null;
}

// ── Echo Loop ─────────────────────────────────────────────────────────

export type LoopPhase =
  | "idle"
  | "sense"
  | "assess"
  | "decide"
  | "execute"
  | "verify"
  | "journal"
  | "sleep";

export interface LoopCycleRecord {
  id: number;
  cycleNumber: number;
  startedAt: string;
  endedAt: string | null;
  phasesCompleted: LoopPhase[];
  outcome: "completed" | "skipped" | "error" | "timeout";
  decisions: Record<string, unknown>;
  tokenCost: number;
  errorMessage: string | null;
}

// ── Subagents ─────────────────────────────────────────────────────────

export type SubagentStatus = "running" | "completed" | "error" | "timeout" | "interrupted" | "stopped";

export interface SubagentState {
  id: string;
  name: string;
  task: string;
  status: SubagentStatus;
  allowTrades: boolean;
  parentSessionId: string | null;
  sessionId: string | null;
  startedAt: string;
  endedAt: string | null;
  result: string | null;
  error: string | null;
  tokenCost: number;
  iterations: number;
  maxIterations: number;
}

// ── Autonomy Inbox ────────────────────────────────────────────────────

export type AutonomyEventType =
  | "compute_balance_low"
  | "subagent_completed"
  | "external_alert";

export interface AutonomyInboxEvent {
  id: number;
  eventType: AutonomyEventType;
  payload: Record<string, unknown>;
  consumed: boolean;
  createdAt: string;
}

// ── Funding Baseline ──────────────────────────────────────────────────

export interface FundingBaseline {
  baselineLocked: number;
  baselineTotal: number;
  lastTopupAt: string | null;
  lastTopupAmount: number | null;
  updatedAt: string;
}

export type TopupEventType =
  | "balance_check"
  | "topup_started"
  | "topup_succeeded"
  | "topup_failed"
  | "critical_alert";

export interface TopupHistoryEntry {
  id: number;
  eventType: TopupEventType;
  action: string | null;
  amount: number | null;
  balanceBefore: number | null;
  balanceAfter: number | null;
  source: "auto" | "manual";
  error: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

// ── Session scope ─────────────────────────────────────────────────────

export type SessionScope = "chat" | "loop" | "telegram" | "subagent" | "scheduler" | "papa";

// ── Approval queue ───────────────────────────────────────────────────

export type ApprovalStatus = "pending" | "approved" | "rejected";

export interface ApprovalItem {
  id: string;
  toolCall: ToolCall;
  reasoning: string;
  estimatedCost: string | null;
  status: ApprovalStatus;
  createdAt: string;
  resolvedAt: string | null;
}

// ── Agent status ─────────────────────────────────────────────────────

export interface AgentStatus {
  running: boolean;
  model: string | null;
  provider: string | null;
  hasSoul: boolean;
  memorySize: number;
  knowledgeFileCount: number;
  sessionId: string | null;
  sessionMessageCount: number;
  /** Last recorded prompt_tokens for session health widget. */
  sessionTokenCount: number;
  sessionStartedAt: string | null;
  /** Current context limit (compaction fires when estimated tokens reach this). */
  contextLimit: number;
  compactionThreshold: number;
  /** Total memory entries in DB (for memory panel). */
  memoryEntryCount: number;
  usage: UsageState;
  loop: LoopState;
  pendingApprovals: number;
  version?: string;
}

// ── Trade tracking ───────────────────────────────────────────────────

export type TradeType = "swap" | "prediction" | "bonding" | "bridge" | "lp" | "stake" | "lend";
export type TradeStatus = "executed" | "pending" | "failed" | "open" | "closed" | "claimed";

export interface TradeEntry {
  id: string;
  timestamp: string;
  type: TradeType;
  chain: string;
  status: TradeStatus;
  input: { token: string; amount: string; valueUsd?: number };
  output: { token: string; amount: string; valueUsd?: number };
  pnl?: { amountUsd: number; percentChange: number; realized: boolean };
  meta: {
    dex?: string;
    action?: string;
    slippageBps?: number;
    priceImpact?: string;
    marketId?: string;
    marketTitle?: string;
    side?: "yes" | "no";
    contracts?: number;
    positionPubkey?: string;
    buyPrice?: number;
    currentPrice?: number;
    bondingToken?: string;
    bondingProgress?: string;
    sourceChain?: string;
    destChain?: string;
    routeId?: string;
    orderId?: string;
    poolId?: string;
    tickRange?: string;
    stakeAccount?: string;
  };
  reasoning?: string;
  signature?: string;
  explorerUrl?: string;
}

export interface TradeSummary {
  totalPnlUsd: number;
  winCount: number;
  lossCount: number;
  totalTrades: number;
  winRate: number;
  byType: Record<string, number>;
}

// ── Predictions ─────────────────────────────────────────────────────

export type PredictionSource = "jupiter" | "polymarket";
export type PredictionLiveStatus = "disabled" | "connecting" | "live" | "reconnecting" | "offline";

export interface PredictionPosition {
  id: string;
  source: PredictionSource;
  marketId: string;
  title: string;
  outcome: string;
  size: number;
  avgPrice: number;
  currentPrice: number;
  costUsd: number;
  valueUsd: number;
  pnlUsd: number;
  pnlPct: number | null;
  flags: {
    claimable?: boolean;
    redeemable?: boolean;
    mergeable?: boolean;
  };
  meta: Record<string, unknown>;
}

export interface PredictionOrder {
  id: string;
  source: "polymarket";
  marketId: string;
  outcome: string;
  side: "BUY" | "SELL";
  price: number;
  size: number;
  matchedSize: number;
  status: string;
  orderType: string;
  createdAt: string | null;
}

export interface PredictionSummary {
  totalValueUsd: number;
  totalPnlUsd: number;
  totalPnlPct: number | null;
  positionCount: number;
  orderCount: number;
  claimableCount: number;
  redeemableCount: number;
  mergeableCount: number;
}

export interface PredictionPanelState {
  source: PredictionSource;
  available: boolean;
  summary: PredictionSummary;
  positions: PredictionPosition[];
  orders: PredictionOrder[];
  liveStatus: {
    available: boolean;
    status: PredictionLiveStatus;
    lastEventAt: string | null;
    lastSyncAt: string | null;
    reason: string | null;
  };
  asOf: string;
  warnings: string[];
}

// ── OpenAI function calling ──────────────────────────────────────────

/** JSON Schema subset for tool parameter definitions. */
export interface JsonSchema {
  type: "object";
  properties: Record<string, {
    type: string;
    description?: string;
    enum?: string[];
  }>;
  required?: string[];
}

/** Parsed tool call from model output (OpenAI-compatible). */
export interface ParsedToolCall {
  /** Upstream tool call ID — must be preserved for round-trip with provider */
  id?: string;
  name: string;
  arguments: Record<string, unknown>;
}

/** Structured inference response — content XOR toolCalls. */
export interface InferenceResponse {
  content: string | null;
  toolCalls: ParsedToolCall[] | null;
  usage: { promptTokens: number; completionTokens: number };
}

// ── Inference ────────────────────────────────────────────────────────

export interface InferenceConfig {
  provider: string;
  model: string;
  endpoint: string;
  contextLimit: number;
  /** Price per 1M input tokens (currency depends on provider). */
  inputPricePerM: number;
  /** Price per 1M output tokens (currency depends on provider). */
  outputPricePerM: number;
  /** Currency for pricing: "0G", "USD", etc. */
  priceCurrency: string;
}

export interface StreamChunk {
  content: string | null;
  finishReason: string | null;
  usage: { promptTokens: number; completionTokens: number } | null;
}
