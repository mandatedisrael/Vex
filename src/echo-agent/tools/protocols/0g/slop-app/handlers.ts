/**
 * Slop App (0G Network) protocol handlers — profile, image, agents, chat.
 *
 * All handlers import from @tools/slop-app/ service layer.
 * Auth via requireSlopAuth() from @tools/slop/auth (JWT).
 * Wallet via @tools/wallet/multi-auth.
 */

import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { getSlopAppClient } from "@tools/slop-app/client.js";
import { postChatMessage, readChatHistory } from "@tools/slop-app/chat.js";
import { requireSlopAuth } from "@tools/slop/auth.js";
import { requireEvmWallet } from "@tools/wallet/multi-auth.js";
import { loadConfig } from "@config/store.js";
import type { AgentFilter, AgentQuery } from "@tools/slop-app/types.js";
import type { ToolResult } from "../../../types.js";
import type { ProtocolHandler } from "../../types.js";

// ── Helpers ──────────────────────────────────────────────────────

function str(p: Record<string, unknown>, k: string): string {
  const v = p[k]; return typeof v === "string" ? v : "";
}
function num(p: Record<string, unknown>, k: string): number | undefined {
  const v = p[k]; return typeof v === "number" ? v : undefined;
}
function ok(data: unknown): ToolResult {
  return { success: true, output: JSON.stringify(data, null, 2), data: data as Record<string, unknown> };
}
function fail(msg: string): ToolResult {
  return { success: false, output: msg };
}

async function getJwtToken(): Promise<{ accessToken: string; address: string; privateKey: string }> {
  const wallet = requireEvmWallet();
  const cfg = loadConfig();
  const accessToken = await requireSlopAuth(wallet.privateKey, wallet.address, cfg.services.backendApiUrl);
  return { accessToken, address: wallet.address, privateKey: wallet.privateKey };
}

const MIME_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
};

// ── Handler map ──────────────────────────────────────────────────

export const SLOP_APP_HANDLERS: Record<string, ProtocolHandler> = {
  // ── Profile ──────────────────────────────────────────────────────

  "slop-app.profile.show": async (p) => {
    let address = str(p, "address");
    if (!address) {
      const wallet = requireEvmWallet();
      address = wallet.address;
    }
    const profile = await getSlopAppClient().getProfile(address);
    return ok(profile);
  },

  "slop-app.profile.register": async (p) => {
    const username = str(p, "username");
    if (!username) return fail("Missing required: username");

    if (!/^[a-zA-Z0-9_]{3,15}$/.test(username)) {
      return fail("Username must be 3-15 characters, alphanumeric and underscore only");
    }

    const twitter = str(p, "twitter") || undefined;
    if (twitter && !/^https:\/\/x\.com\/[A-Za-z0-9_]{1,15}$/.test(twitter)) {
      return fail("Invalid X.com URL format. Must be https://x.com/username");
    }

    const avatarCid = str(p, "avatarCid") || undefined;
    const avatarGateway = str(p, "avatarGateway") || undefined;
    if ((avatarCid && !avatarGateway) || (!avatarCid && avatarGateway)) {
      return fail("Both avatarCid and avatarGateway must be provided together");
    }

    const { accessToken } = await getJwtToken();
    const profile = await getSlopAppClient().registerProfile(accessToken, {
      username,
      twitterUrl: twitter,
      avatarCid,
      avatarGateway,
    });
    return ok(profile);
  },

  // ── Image ────────────────────────────────────────────────────────

  "slop-app.image.upload": async (p) => {
    const filePath = str(p, "filePath");
    if (!filePath) return fail("Missing required: filePath");

    let buffer: Buffer;
    let filename: string;
    try {
      buffer = readFileSync(filePath);
      filename = basename(filePath);
    } catch {
      return fail(`Failed to read file: ${filePath}`);
    }

    if (buffer.length > 5 * 1024 * 1024) {
      return fail("Image too large (max 5MB)");
    }

    const ext = filename.split(".").pop()?.toLowerCase() || "";
    const mimeType = MIME_TYPES[ext];
    if (!mimeType) {
      return fail("Invalid image format. Allowed: jpg, jpeg, png, gif");
    }

    const result = await getSlopAppClient().uploadImage(buffer, filename, mimeType);
    return ok({ ipfsHash: result.ipfsHash, gatewayUrl: result.gatewayUrl, filename });
  },

  "slop-app.image.generate": async (p) => {
    const prompt = str(p, "prompt");
    if (!prompt) return fail("Missing required: prompt");
    if (prompt.length > 1000) return fail("Prompt too long (max 1000 characters)");

    const upload = p.upload === true;
    const result = await getSlopAppClient().generateImage(prompt, upload);
    return ok({
      imageUrl: result.imageUrl ?? null,
      ipfsHash: result.ipfsHash ?? null,
      gatewayUrl: result.gatewayUrl ?? null,
    });
  },

  // ── Agents ───────────────────────────────────────────────────────

  "slop-app.agents.query": async (p) => {
    const source = str(p, "source");
    if (!source) return fail("Missing required: source");

    const query: AgentQuery = { source: source as "tokens" };

    const filtersRaw = str(p, "filters");
    if (filtersRaw) {
      try {
        const parsed = JSON.parse(filtersRaw) as AgentFilter[];
        if (Array.isArray(parsed)) query.filters = parsed;
      } catch {
        return fail("Invalid filters JSON");
      }
    }

    const orderBy = str(p, "orderBy");
    if (orderBy) {
      query.orderBy = { field: orderBy, direction: (str(p, "orderDir") || "desc") as "asc" | "desc" };
    }

    query.limit = num(p, "limit");
    query.offset = num(p, "offset");

    const { accessToken } = await getJwtToken();
    const result = await getSlopAppClient().queryAgents(accessToken, query);
    return ok(result);
  },

  "slop-app.agents.trending": async (p) => {
    const limit = num(p, "limit") ?? 20;
    const { accessToken } = await getJwtToken();
    const result = await getSlopAppClient().queryAgents(accessToken, {
      source: "tokens",
      orderBy: { field: "volume_24h", direction: "desc" },
      limit,
    });
    return ok(result);
  },

  "slop-app.agents.newest": async (p) => {
    const limit = num(p, "limit") ?? 20;
    const { accessToken } = await getJwtToken();
    const result = await getSlopAppClient().queryAgents(accessToken, {
      source: "tokens",
      orderBy: { field: "created_at_ms", direction: "desc" },
      limit,
    });
    return ok(result);
  },

  "slop-app.agents.search": async (p) => {
    const name = str(p, "name");
    if (!name) return fail("Missing required: name");
    if (name.length > 100) return fail("Search pattern too long (max 100 characters)");

    const limit = num(p, "limit") ?? 20;
    const { accessToken } = await getJwtToken();
    const result = await getSlopAppClient().queryAgents(accessToken, {
      source: "tokens",
      filters: [{ field: "name", op: "like", value: name }],
      limit,
    });
    return ok(result);
  },

  // ── Chat ─────────────────────────────────────────────────────────

  "slop-app.chat.post": async (p) => {
    const message = str(p, "message");
    if (!message || !message.trim()) return fail("Message cannot be empty");
    if (message.length > 500) return fail("Message too long (max 500 characters)");

    const { accessToken } = await getJwtToken();
    const cfg = loadConfig();
    const result = await postChatMessage(cfg.services.chatWsUrl, accessToken, message.trim(), str(p, "gifUrl") || undefined);
    return ok(result);
  },

  "slop-app.chat.read": async (p) => {
    const limit = num(p, "limit");
    if (limit != null && (limit < 1 || limit > 250)) return fail("Limit must be 1-250");

    const cfg = loadConfig();
    const messages = await readChatHistory(cfg.services.chatWsUrl, limit);
    return ok({ count: messages.length, messages });
  },
};
