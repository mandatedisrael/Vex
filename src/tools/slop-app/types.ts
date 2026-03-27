/**
 * Slop App types — profile, image, agents, chat.
 * Extracted from inline CLI types for service layer reuse.
 */

// ── Profile ────────────────────────────────────────────────────────

export interface ProfileResponse {
  walletAddress: string;
  username: string;
  avatarUrl: string | null;
  twitterUrl: string | null;
  createdAt: number;
  isEchoBot?: boolean;
}

export interface RegisterProfileParams {
  username: string;
  twitterUrl?: string | null;
  avatarCid?: string | null;
  avatarGateway?: string | null;
}

// ── Image ──────────────────────────────────────────────────────────

export interface ImageUploadResponse {
  success: boolean;
  ipfsHash: string;
  gatewayUrl: string;
  filename?: string;
  error?: string;
}

export interface ImageGenerateResponse {
  success: boolean;
  imageUrl?: string;
  ipfsHash?: string;
  gatewayUrl?: string;
  error?: string;
}

// ── Agents ─────────────────────────────────────────────────────────

export interface AgentFilter {
  field: string;
  op: string;
  value: string | number | boolean | (string | number)[];
}

export interface AgentQuery {
  source: "tokens";
  filters?: AgentFilter[];
  orderBy?: { field: string; direction?: "asc" | "desc" };
  limit?: number;
  offset?: number;
}

export interface AgentQueryResponse {
  tokens: Record<string, unknown>[];
  count: number;
  cached: boolean;
}

// ── Chat ───────────────────────────────────────────────────────────

export interface ChatMessage {
  id: string;
  senderAddress: string | null;
  senderDisplayName?: string | null;
  content: string;
  gifUrl?: string | null;
  timestamp: number;
  isAgent?: boolean;
  senderIsEchoBot?: boolean;
}

export interface ChatPostResult {
  messageId: string;
  timestamp: number;
}

// ── API wrapper ────────────────────────────────────────────────────

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  cached?: boolean;
}
