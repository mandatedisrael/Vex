/**
 * Slop App REST client — profile, image, agents query.
 *
 * Extracted from CLI commands for reuse by echo-agent handlers.
 * Singleton via getSlopAppClient().
 */

import { loadConfig } from "../../config/store.js";
import { fetchJson, fetchWithTimeout } from "../../utils/http.js";
import { EchoError, ErrorCodes } from "../../errors.js";
import { mapSlopAppError, mapSlopAppTransportError } from "./errors.js";
import type {
  AgentQuery,
  AgentQueryResponse,
  ApiResponse,
  ImageGenerateResponse,
  ImageUploadResponse,
  ProfileResponse,
  RegisterProfileParams,
} from "./types.js";

const IMAGE_GENERATE_TIMEOUT_MS = 120_000;

function normalizeQuery(query: AgentQuery): AgentQuery {
  const normalized: AgentQuery = {
    source: query.source,
    orderBy: query.orderBy ?? { field: "created_at_ms", direction: "desc" },
    limit: query.limit ?? 50,
  };
  if (query.filters && query.filters.length > 0) {
    normalized.filters = query.filters;
  }
  if (query.offset && query.offset > 0) {
    normalized.offset = query.offset;
  }
  return normalized;
}

export class SlopAppClient {
  constructor(
    private readonly backendUrl: string,
    private readonly proxyUrl: string,
  ) {}

  // ── Profile ──────────────────────────────────────────────────────

  async getProfile(address: string): Promise<ProfileResponse> {
    try {
      const response = await fetchJson<ApiResponse<ProfileResponse>>(
        `${this.backendUrl}/profiles/${encodeURIComponent(address)}`,
      );
      if (!response.success || !response.data) {
        throw new EchoError(ErrorCodes.PROFILE_NOT_FOUND, response.error || "Profile not found");
      }
      return response.data;
    } catch (err) {
      if (err instanceof EchoError) throw err;
      mapSlopAppTransportError(err);
    }
  }

  async registerProfile(
    accessToken: string,
    params: RegisterProfileParams,
  ): Promise<ProfileResponse> {
    try {
      const response = await fetchJson<ApiResponse<ProfileResponse>>(
        `${this.backendUrl}/profiles/register`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({
            username: params.username,
            twitterUrl: params.twitterUrl || null,
            avatarCid: params.avatarCid || null,
            avatarGateway: params.avatarGateway || null,
            avatarIpfs: params.avatarCid ? `ipfs://${params.avatarCid}` : null,
            isEchoBot: true,
          }),
        },
      );
      if (!response.success || !response.data) {
        throw new EchoError(ErrorCodes.REGISTRATION_FAILED, response.error || "Registration failed");
      }
      return response.data;
    } catch (err) {
      if (err instanceof EchoError) throw err;
      mapSlopAppTransportError(err);
    }
  }

  // ── Image ────────────────────────────────────────────────────────

  async uploadImage(
    buffer: Buffer,
    filename: string,
    mimeType: string,
  ): Promise<ImageUploadResponse> {
    try {
      const formData = new FormData();
      const blob = new Blob([new Uint8Array(buffer)], { type: mimeType });
      formData.append("image", blob, filename);

      const response = await fetchWithTimeout(`${this.proxyUrl}/upload-image`, {
        method: "POST",
        body: formData,
      });

      const result = (await response.json()) as ImageUploadResponse;
      if (!result.success) {
        throw new EchoError(ErrorCodes.IMAGE_UPLOAD_FAILED, result.error || "Upload failed");
      }
      return result;
    } catch (err) {
      if (err instanceof EchoError) throw err;
      mapSlopAppTransportError(err);
    }
  }

  async generateImage(
    prompt: string,
    uploadToIpfs = false,
  ): Promise<ImageGenerateResponse> {
    try {
      const response = await fetchJson<ImageGenerateResponse>(
        `${this.proxyUrl}/generate-image`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt, uploadToIPFS: uploadToIpfs }),
          timeoutMs: IMAGE_GENERATE_TIMEOUT_MS,
        },
      );
      if (!response.success) {
        throw new EchoError(ErrorCodes.IMAGE_GENERATION_FAILED, response.error || "Generation failed");
      }
      return response;
    } catch (err) {
      if (err instanceof EchoError) throw err;
      mapSlopAppTransportError(err);
    }
  }

  // ── Agents ───────────────────────────────────────────────────────

  async queryAgents(
    accessToken: string,
    query: AgentQuery,
  ): Promise<AgentQueryResponse> {
    const normalized = normalizeQuery(query);

    try {
      const response = await fetchWithTimeout(
        `${this.backendUrl}/agents/query`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({ query: normalized }),
        },
      );

      const body = (await response.json()) as {
        success: boolean;
        data?: Record<string, unknown>[];
        error?: string;
        cached?: boolean;
      };

      if (!response.ok) {
        throw mapSlopAppError(response.status, body.error || `HTTP ${response.status}`);
      }
      if (!body.success) {
        throw new EchoError(ErrorCodes.AGENT_QUERY_FAILED, body.error || "Query failed");
      }

      const tokens = body.data || [];
      return { tokens, count: tokens.length, cached: body.cached ?? false };
    } catch (err) {
      if (err instanceof EchoError) throw err;
      mapSlopAppTransportError(err);
    }
  }
}

// ── Singleton ───────────────────────────────────────────────────────

let cachedClient: SlopAppClient | null = null;
let cachedBackendUrl: string | null = null;
let cachedProxyUrl: string | null = null;

export function getSlopAppClient(): SlopAppClient {
  const cfg = loadConfig();
  const backendUrl = cfg.services.backendApiUrl;
  const proxyUrl = cfg.services.proxyApiUrl;

  if (cachedClient && cachedBackendUrl === backendUrl && cachedProxyUrl === proxyUrl) {
    return cachedClient;
  }
  cachedClient = new SlopAppClient(backendUrl, proxyUrl);
  cachedBackendUrl = backendUrl;
  cachedProxyUrl = proxyUrl;
  return cachedClient;
}
