import type { ChatMode, JsonSchema, ToolCall } from "../types.js";

export type ProtocolNamespace =
  | "0g-compute"
  | "0g-storage"
  | "solana"
  | "chainscan"
  | "dexscreener"
  | "echobook"
  | "jaine"
  | "khalani"
  | "kyberswap"
  | "polymarket"
  | "slop"
  | "wallet";

export type ToolLifecycle = "declared" | "active";
export type ExecuteMode = "execute" | "preview";

export interface ToolParamDef {
  key: string;
  type: "string" | "number" | "boolean";
  required?: boolean;
  description: string;
  positional?: number;
  flag?: string;
}

export interface ProtocolToolManifest {
  toolId: string;
  namespace: ProtocolNamespace;
  lifecycle: ToolLifecycle;
  description: string;
  mutating: boolean;
  supportsYes: boolean;
  commandPath: string[];
  previewCommandPath?: string[];
  params: ToolParamDef[];
  exampleParams: Record<string, unknown>;
  docRefs: string[];
}

export interface ProtocolDiscoveryRequest {
  query?: string;
  namespace?: ProtocolNamespace;
  includeMutating?: boolean;
  includeDeclared?: boolean;
  limit?: number;
}

export interface ProtocolDiscoveryItem {
  toolId: string;
  namespace: ProtocolNamespace;
  lifecycle: ToolLifecycle;
  description: string;
  mutating: boolean;
  exampleParams: Record<string, unknown>;
  docRefs: string[];
}

export interface ProtocolDiscoveryResult {
  success: boolean;
  count: number;
  tools: ProtocolDiscoveryItem[];
  warnings: string[];
}

export interface ProtocolExecuteRequest {
  toolId: string;
  params: Record<string, unknown>;
  mode?: ExecuteMode;
}

export interface PreparedProtocolExecution {
  manifest: ProtocolToolManifest;
  mode: ExecuteMode;
  toolCall: ToolCall;
  commandPath: string[];
}

export type PrepareProtocolExecutionResult =
  | { ok: true; prepared: PreparedProtocolExecution; warnings: string[] }
  | { ok: false; code: string; message: string };

export interface ProtocolExecutionEnvelope {
  success: boolean;
  toolId: string;
  mode: ExecuteMode;
  summary: string;
  data?: Record<string, unknown>;
  warnings?: string[];
  error?: { code: string; message: string };
}

export interface RuntimeExecutionResult {
  envelope: ProtocolExecutionEnvelope;
  rawOutput?: string;
  argv?: string[];
}

export interface RuntimeExecutionContext {
  loopMode: ChatMode;
  source: "chat" | "scheduler" | "approval_resume";
}

export const EXECUTE_TOOL_PARAMS_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    toolId: { type: "string", description: "Canonical protocol tool ID from discover_tools" },
    params: { type: "object", description: "Protocol parameters object" },
    mode: { type: "string", enum: ["execute", "preview"], description: "Execution mode" },
  },
  required: ["toolId", "params"],
};

