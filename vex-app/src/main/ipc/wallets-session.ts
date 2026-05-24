/**
 * Wallet IPC handlers — per-session wallet scope contract + DB-backed
 * prepared intents.
 *
 * Distinct from `wallet-export.ts` (sudo-style key export). This file
 * owns the wallet-related agent surface for puzzles 05/10:
 *
 *   - `listSessionWallets`        — read-only, returns empty scope today
 *                                   (DB-backed scope lands in puzzle 5
 *                                   phase 5, NOT here).
 *   - `setSessionWalletScope`     — fail-closed (PHASE 5).
 *   - `getPreparedIntent`         — phase 4 wired: engine repo +
 *                                   ensureEngineDbUrl + allow-listed
 *                                   DTO mapper.
 *   - `cancelPreparedIntent`      — phase 4 wired: CAS cancel + safe
 *                                   `already_terminal` for cross-session.
 *
 * Provider hot-wallet keys never enter the Electron process — provider
 * signing belongs in a backend signer. The wallet intent rows only carry
 * the local user-wallet address + transfer params; `failure_reason` and
 * raw error data NEVER cross this boundary.
 */

import { CH } from "@shared/ipc/channels.js";
import { err, ok, type Result, type VexError } from "@shared/ipc/result.js";
import {
  preparedIntentDtoSchema,
  sessionWalletScopeDtoSchema,
  walletIntentPreviewSchema,
  walletsActionResultSchema,
  walletsCancelPreparedIntentInputSchema,
  walletsGetPreparedIntentInputSchema,
  walletsListSessionInputSchema,
  walletsSetScopeInputSchema,
  walletsSetScopeResultSchema,
  type PreparedIntentDto,
  type SessionWalletScopeDto,
  type WalletsActionResult,
  type WalletsSetScopeResult,
} from "@shared/schemas/wallets.js";
import { log } from "../logger/index.js";
import { featureUnavailable } from "./_feature-unavailable.js";
import { registerHandler } from "./register-handler.js";
import { ensureEngineDbUrl } from "./runtime/_ensure-engine-db-url.js";

const preparedIntentNullableSchema = preparedIntentDtoSchema.nullable();

function walletsUnexpectedError(
  correlationId: string,
  message = "Unable to query wallet intents. Verify services are running and retry.",
): VexError {
  return {
    code: "internal.unexpected",
    domain: "wallets",
    message,
    retryable: true,
    userActionable: false,
    redacted: true,
    correlationId,
  };
}

function registerListSessionWalletsHandler(): () => void {
  return registerHandler({
    channel: CH.wallets.listSessionWallets,
    domain: "wallets",
    inputSchema: walletsListSessionInputSchema,
    outputSchema: sessionWalletScopeDtoSchema,
    handle: async (input, ctx): Promise<Result<SessionWalletScopeDto>> => {
      log.info(
        `[ipc:vex:wallets:listSessionWallets] ok sessionId=${input.sessionId} ` +
          `scope=empty correlationId=${ctx.requestId}`,
      );
      return ok({
        sessionId: input.sessionId,
        allowedWalletIds: [],
        defaultWalletId: null,
      });
    },
  });
}

function registerSetScopeHandler(): () => void {
  return registerHandler({
    channel: CH.wallets.setSessionWalletScope,
    domain: "wallets",
    inputSchema: walletsSetScopeInputSchema,
    outputSchema: walletsSetScopeResultSchema,
    handle: async (_input, ctx): Promise<Result<WalletsSetScopeResult>> => {
      log.info(
        `[ipc:vex:wallets:setSessionWalletScope] fail-closed feature_unavailable ` +
          `correlationId=${ctx.requestId}`,
      );
      return err(
        featureUnavailable({
          domain: "wallets",
          correlationId: ctx.requestId,
          message:
            "Per-session wallet scope lands in puzzle 05 phase 5 (DB-backed scope + mission contract hash).",
        }),
      );
    },
  });
}

// ── getPreparedIntent (phase 4) ─────────────────────────────────────────

function mapToDto(
  intent: import("@vex-agent/db/repos/wallet-intents.js").WalletIntent,
): PreparedIntentDto {
  // Allow-listed projection. `failure_reason` and `idempotencyKey` are
  // intentionally NOT surfaced (defense-in-depth — they may carry
  // structural hashes the renderer doesn't need).
  const previewParsed = walletIntentPreviewSchema.safeParse(intent.previewJson);
  return {
    intentId: intent.intentId,
    sessionId: intent.sessionId,
    walletAddress: intent.walletAddress,
    network: intent.network,
    chain: intent.chainAlias,
    to: intent.toAddress,
    amount: intent.amount,
    token: intent.token,
    status: intent.status,
    createdAt: intent.createdAt,
    expiresAt: intent.expiresAt,
    consumedAt: intent.consumedAt,
    cancelledAt: intent.cancelledAt,
    txHash: intent.txHash,
    preview: previewParsed.success ? previewParsed.data : null,
  };
}

function registerGetPreparedIntentHandler(): () => void {
  return registerHandler({
    channel: CH.wallets.getPreparedIntent,
    domain: "wallets",
    inputSchema: walletsGetPreparedIntentInputSchema,
    outputSchema: preparedIntentNullableSchema,
    handle: async (input, ctx): Promise<Result<PreparedIntentDto | null>> => {
      const dbUrlOutcome = await ensureEngineDbUrl(ctx.requestId);
      if (!dbUrlOutcome.ok) return dbUrlOutcome;

      try {
        const { getById } = await import(
          "@vex-agent/db/repos/wallet-intents.js"
        );
        const intent = await getById(input.intentId, input.sessionId);
        if (intent === null) {
          log.info(
            `[ipc:vex:wallets:getPreparedIntent] not_found intentId=${input.intentId} ` +
              `correlationId=${ctx.requestId}`,
          );
          return ok(null);
        }
        log.info(
          `[ipc:vex:wallets:getPreparedIntent] ok intentId=${input.intentId} ` +
            `status=${intent.status} correlationId=${ctx.requestId}`,
        );
        return ok(mapToDto(intent));
      } catch (cause) {
        log.warn(
          `[ipc:vex:wallets:getPreparedIntent] failed correlationId=${ctx.requestId}`,
          cause,
        );
        return err(walletsUnexpectedError(ctx.requestId));
      }
    },
  });
}

// ── cancelPreparedIntent (phase 4) ──────────────────────────────────────

function registerCancelPreparedIntentHandler(): () => void {
  return registerHandler({
    channel: CH.wallets.cancelPreparedIntent,
    domain: "wallets",
    inputSchema: walletsCancelPreparedIntentInputSchema,
    outputSchema: walletsActionResultSchema,
    handle: async (input, ctx): Promise<Result<WalletsActionResult>> => {
      const dbUrlOutcome = await ensureEngineDbUrl(ctx.requestId);
      if (!dbUrlOutcome.ok) return dbUrlOutcome;

      try {
        const { cancelIfPending } = await import(
          "@vex-agent/db/repos/wallet-intents.js"
        );
        const cancelled = await cancelIfPending(
          input.intentId,
          input.sessionId,
        );
        if (cancelled !== null) {
          log.info(
            `[ipc:vex:wallets:cancelPreparedIntent] cancelled intentId=${input.intentId} ` +
              `correlationId=${ctx.requestId}`,
          );
          return ok({
            intentId: input.intentId,
            status: "cancelled",
            message: "Intent cancelled.",
          });
        }
        // CAS missed — either already terminal in this session, OR
        // cross-session. We collapse both to `already_terminal` to avoid
        // exposing whether the intentId exists in another session
        // (Codex puzzle-5 phase-4 review v3 cross-session response).
        log.info(
          `[ipc:vex:wallets:cancelPreparedIntent] already_terminal intentId=${input.intentId} ` +
            `correlationId=${ctx.requestId}`,
        );
        return ok({
          intentId: input.intentId,
          status: "already_terminal",
          message: "No pending intent for this session.",
        });
      } catch (cause) {
        log.warn(
          `[ipc:vex:wallets:cancelPreparedIntent] failed correlationId=${ctx.requestId}`,
          cause,
        );
        return err(walletsUnexpectedError(ctx.requestId));
      }
    },
  });
}

export function registerWalletsSessionHandlers(): ReadonlyArray<() => void> {
  return [
    registerListSessionWalletsHandler(),
    registerSetScopeHandler(),
    registerGetPreparedIntentHandler(),
    registerCancelPreparedIntentHandler(),
  ];
}
