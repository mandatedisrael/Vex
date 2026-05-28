import { z } from "zod";
import { CH } from "@shared/ipc/channels.js";
import { err, type Result } from "@shared/ipc/result.js";
import {
  secretsLockInputSchema,
  secretsLockResultSchema,
  secretsStatusSchema,
  secretsUnlockInputSchema,
  secretsUnlockResultSchema,
  type SecretsLockResult,
  type SecretsStatus,
  type SecretsUnlockResult,
} from "@shared/schemas/secrets.js";
import {
  getSecretSessionStatus,
  lockSecretSession,
  unlockSecretSession,
} from "../secrets/session.js";
import {
  checkUnlockAllowed,
  recordUnlockFailure,
  recordUnlockSuccess,
} from "../secrets/unlock-throttle.js";
import { log } from "../logger/index.js";
import { registerHandler } from "./register-handler.js";

const empty = z.object({}).strict();

function formatRetryAfter(ms: number): string {
  const seconds = Math.max(1, Math.ceil(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.ceil(seconds / 60);
  return `${minutes}m`;
}

export function registerSecretsHandlers(): Array<() => void> {
  return [
    registerHandler({
      channel: CH.secrets.status,
      domain: "wallet",
      inputSchema: empty,
      outputSchema: secretsStatusSchema,
      handle: async (): Promise<Result<SecretsStatus>> =>
        ({ ok: true, data: getSecretSessionStatus() }),
    }),
    registerHandler({
      channel: CH.secrets.unlock,
      domain: "wallet",
      inputSchema: secretsUnlockInputSchema,
      outputSchema: secretsUnlockResultSchema,
      handle: async (input, ctx): Promise<Result<SecretsUnlockResult>> => {
        const gate = checkUnlockAllowed();
        if (!gate.allowed) {
          log.warn(
            `[ipc:vex:secrets:unlock] throttled correlationId=${ctx.requestId} retryAfterMs=${gate.retryAfterMs}`,
          );
          return err({
            code: "secrets.unlock_throttled",
            domain: "wallet",
            message: `Too many failed attempts. Try again in ${formatRetryAfter(gate.retryAfterMs)}.`,
            retryable: true,
            userActionable: true,
            redacted: true,
            retryAfterMs: gate.retryAfterMs,
            correlationId: ctx.requestId,
          });
        }

        const result = unlockSecretSession(input.password);
        if (result.ok) {
          recordUnlockSuccess();
          log.info(
            `[ipc:vex:secrets:unlock] ok=true correlationId=${ctx.requestId}`,
          );
          return result;
        }

        // Only wrong-password should advance the throttle counter; IO /
        // corrupt-file errors are configuration issues, not attacker signals.
        if (result.error.code === "wallet.password_invalid") {
          recordUnlockFailure();
          log.warn(
            `[ipc:vex:secrets:unlock] invalid password correlationId=${ctx.requestId}`,
          );
        } else {
          log.error(
            `[ipc:vex:secrets:unlock] failed code=${result.error.code} correlationId=${ctx.requestId}`,
          );
        }
        return result;
      },
    }),
    registerHandler({
      channel: CH.secrets.lock,
      domain: "wallet",
      inputSchema: secretsLockInputSchema,
      outputSchema: secretsLockResultSchema,
      handle: async (_input, ctx): Promise<Result<SecretsLockResult>> => {
        // Await so the provider-cache invalidation is provably done before we
        // report locked — a cached provider would otherwise keep serving the
        // old credentials after lock (FINDING-security-003).
        await lockSecretSession();
        log.info(
          `[ipc:vex:secrets:lock] ok=true correlationId=${ctx.requestId}`,
        );
        return { ok: true, data: { locked: true } };
      },
    }),
  ];
}
