/**
 * Agent config endpoints — read + write.
 * Exposes runtime configuration for the UI and accepts updates.
 */

import { registerRoute, jsonResponse, errorResponse } from "../routes.js";
import * as telegramRepo from "../db/repos/telegram.js";
import { getAgentPackageVersion } from "../compose.js";
import { DEFAULT_CONTEXT_LIMIT, COMPACTION_THRESHOLD } from "../constants.js";
import { writeAppEnvValue } from "../../providers/env-resolution.js";
import logger from "../../utils/logger.js";

const MIN_CONTEXT_LIMIT = 10_000;
const MAX_CONTEXT_LIMIT = 200_000;
const MIN_TAVILY_KEY_LENGTH = 20;

export function registerConfigRoutes(): void {
  registerRoute("GET", "/api/agent/config", async (_req, res) => {
    const tgConfig = await telegramRepo.getConfig();
    jsonResponse(res, 200, {
      tavilyConfigured: !!process.env.TAVILY_API_KEY,
      telegramConfigured: !!tgConfig.botToken,
      contextLimit: DEFAULT_CONTEXT_LIMIT,
      compactionThreshold: COMPACTION_THRESHOLD,
      version: getAgentPackageVersion(),
      uptime: Math.floor(process.uptime()),
    });
  });

  registerRoute("POST", "/api/agent/config", async (_req, res, params) => {
    const body = params.body;
    if (!body) {
      errorResponse(res, 400, "MISSING_BODY", "Request body is required");
      return;
    }

    const changes: string[] = [];

    // Context limit
    if (body.contextLimit !== undefined) {
      const limit = Number(body.contextLimit);
      if (Number.isNaN(limit) || limit < MIN_CONTEXT_LIMIT || limit > MAX_CONTEXT_LIMIT) {
        errorResponse(res, 400, "INVALID_CONTEXT_LIMIT", `Context limit must be between ${MIN_CONTEXT_LIMIT.toLocaleString()} and ${MAX_CONTEXT_LIMIT.toLocaleString()} tokens`);
        return;
      }
      writeAppEnvValue("AGENT_CONTEXT_LIMIT", String(limit));
      process.env.AGENT_CONTEXT_LIMIT = String(limit);
      changes.push(`contextLimit=${limit}`);
      logger.info("agent.config.context_limit_updated", { limit });
    }

    // Tavily API key
    if (body.tavilyApiKey !== undefined) {
      const key = String(body.tavilyApiKey).trim();
      if (key.length > 0) {
        if (!key.startsWith("tvly-") || key.length < MIN_TAVILY_KEY_LENGTH) {
          errorResponse(res, 400, "INVALID_TAVILY_KEY", "Key must start with tvly- and be at least 20 characters. Get one at https://tavily.com");
          return;
        }
        writeAppEnvValue("TAVILY_API_KEY", key);
        process.env.TAVILY_API_KEY = key;
        changes.push("tavilyApiKey=set");
        logger.info("agent.config.tavily_key_updated");
      }
    }

    if (changes.length === 0) {
      errorResponse(res, 400, "NO_CHANGES", "No valid configuration changes provided");
      return;
    }

    jsonResponse(res, 200, { success: true, changes });
  });
}
