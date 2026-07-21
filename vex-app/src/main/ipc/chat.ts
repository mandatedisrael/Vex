/**
 * vex.chat.submit — operator text entrypoint for the app shell.
 *
 * Main owns the bridge into the engine. The renderer sends only session id +
 * text; main validates the session, persists the first mission goal when
 * applicable, points the engine at the app-managed Postgres, and then routes
 * the turn through the canonical Vex Agent ingress.
 */

import { URL } from "node:url";
import { CH } from "@shared/ipc/channels.js";
import { err, ok, type Result, type VexError } from "@shared/ipc/result.js";
import {
  chatSubmitInputSchema,
  chatSubmitResultSchema,
  type ChatSubmitResult,
} from "@shared/schemas/chat.js";
import { closePool } from "@vex-agent/db/client.js";
import { buildPoolConfig } from "../database/db-config.js";
import {
  getSessionById,
  setInitialMissionGoalIfUnset,
} from "../database/sessions-db.js";
import { log } from "../logger/index.js";
import { registerHandler } from "./register-handler.js";

function sessionNotFoundError(correlationId: string): VexError {
  return {
    code: "validation.invalid_input",
    domain: "chat",
    message: "Session not found.",
    retryable: false,
    userActionable: true,
    redacted: true,
    correlationId,
  };
}

function providerUnavailableError(correlationId: string): VexError {
  return {
    code: "provider.unavailable",
    domain: "chat",
    message: "No inference provider is available. Unlock Vex or complete provider setup, then retry.",
    retryable: true,
    userActionable: true,
    redacted: true,
    correlationId,
  };
}

function providerTransientError(correlationId: string): VexError {
  return {
    code: "provider.unavailable",
    domain: "chat",
    message: "The inference provider is temporarily unavailable. Try again shortly.",
    retryable: true,
    userActionable: true,
    redacted: true,
    correlationId,
  };
}

function invalidApiKeyError(correlationId: string): VexError {
  return {
    code: "provider.invalid_api_key",
    domain: "chat",
    message: "The inference provider rejected the API key. Verify it in provider setup and retry.",
    retryable: false,
    userActionable: true,
    redacted: true,
    correlationId,
  };
}

function insufficientCreditsError(correlationId: string): VexError {
  return {
    code: "provider.insufficient_credits",
    domain: "chat",
    message: "The inference provider account has insufficient credits. Add funds and retry.",
    retryable: false,
    userActionable: true,
    redacted: true,
    correlationId,
  };
}

function chatFailedError(correlationId: string): VexError {
  return {
    code: "internal.unexpected",
    domain: "chat",
    message: "Unable to process the message.",
    retryable: true,
    userActionable: false,
    redacted: true,
    correlationId,
  };
}

function dbUnavailableError(correlationId: string): VexError {
  return {
    code: "internal.unexpected",
    domain: "database",
    message: "Database unavailable. Verify services are running and retry.",
    retryable: true,
    userActionable: true,
    redacted: true,
    correlationId,
  };
}

/**
 * Transient transport `causeCode` allow-list — verbatim copy of the mission
 * runner's closed list (`mission-error-classifier.ts` TRANSIENT_CAUSE_CODES).
 * Deliberately duplicated rather than imported: the `@vex-agent` alias is the
 * privileged trust surface (rule 90), and a ~10-line local reader below does
 * not justify widening it just to reach one module's constant.
 */
const TRANSIENT_TRANSPORT_CAUSE_CODES: ReadonlySet<string> = new Set([
  "ETIMEDOUT",
  "ECONNRESET",
  "ECONNREFUSED",
  "EAI_AGAIN",
  "EPIPE",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
  "UND_ERR_SOCKET",
]);

/**
 * Local own-property reader — same "own-properties only, never `.cause`"
 * idiom as `mission-error-signal.ts` / `engine/types.ts`, duplicated here
 * (not imported) for the same trust-surface reason as the allow-list above.
 * Reads the lean signals `MissionRunPausedError` propagates from its cause
 * (`statusCode`, `causeCode`), plus raw `status` for non-wrapped errors.
 */
function chatErrorSignal(cause: unknown): { statusCode: number | null; causeCode: string | null } {
  if (typeof cause !== "object" || cause === null) {
    return { statusCode: null, causeCode: null };
  }
  const rec = cause as Record<string, unknown>;
  // Own-property reads only — ordinary indexing would also resolve
  // inherited prototype properties (e.g. `Error.prototype.name`), letting a
  // caller "read" a signal that was never actually attached to this value.
  const ownField = (key: string): unknown =>
    Object.prototype.hasOwnProperty.call(rec, key) ? rec[key] : undefined;
  const rawStatus = ownField("statusCode") ?? ownField("status");
  const statusCode =
    typeof rawStatus === "number" && Number.isFinite(rawStatus) ? rawStatus : null;
  const rawCauseCode = ownField("causeCode");
  const causeCode = typeof rawCauseCode === "string" ? rawCauseCode : null;
  return { statusCode, causeCode };
}

function classifyEngineError(cause: unknown, correlationId: string): VexError {
  if (
    cause instanceof Error &&
    (cause.message === "No inference provider available" ||
      cause.message === "No inference config available")
  ) {
    return providerUnavailableError(correlationId);
  }

  const signal = chatErrorSignal(cause);
  if (signal.statusCode === 401 || signal.statusCode === 403) {
    return invalidApiKeyError(correlationId);
  }
  if (signal.statusCode === 402) {
    return insufficientCreditsError(correlationId);
  }
  if (
    signal.statusCode === 429 ||
    (signal.statusCode !== null && signal.statusCode >= 500 && signal.statusCode <= 599) ||
    (signal.causeCode !== null && TRANSIENT_TRANSPORT_CAUSE_CODES.has(signal.causeCode))
  ) {
    return providerTransientError(correlationId);
  }

  return chatFailedError(correlationId);
}

function makePostgresUrl(args: {
  readonly host: string;
  readonly port: number;
  readonly database: string;
  readonly user: string;
  readonly password: string;
}): string {
  const url = new URL(`postgresql://${args.host}:${args.port}/${args.database}`);
  url.username = args.user;
  url.password = args.password;
  return url.toString();
}

async function ensureEngineDbUrl(
  correlationId: string,
): Promise<Result<void, VexError>> {
  try {
    const cfg = await buildPoolConfig();
    if (cfg === null) return err(dbUnavailableError(correlationId));
    const nextUrl = makePostgresUrl(cfg);
    if (process.env.VEX_DB_URL === nextUrl) return ok(undefined);

    process.env.VEX_DB_URL = nextUrl;
    await closePool();
    log.info(
      `[ipc:vex:chat:submit] engine database connection refreshed correlationId=${correlationId}`,
    );
    return ok(undefined);
  } catch {
    return err(dbUnavailableError(correlationId));
  }
}

export function registerChatSubmitHandler(): () => void {
  return registerHandler({
    channel: CH.chat.submit,
    domain: "chat",
    inputSchema: chatSubmitInputSchema,
    outputSchema: chatSubmitResultSchema,
    handle: async (input, ctx): Promise<Result<ChatSubmitResult>> => {
      const session = await getSessionById(input.sessionId);
      if (!session.ok) return session;
      if (session.data === null) return err(sessionNotFoundError(ctx.requestId));

      let treatedAsInitialGoal = false;
      if (
        session.data.mode === "mission" &&
        (session.data.initialGoal === null ||
          session.data.initialGoal.trim().length === 0)
      ) {
        const goalOutcome = await setInitialMissionGoalIfUnset(
          input.sessionId,
          input.message,
        );
        if (!goalOutcome.ok) return goalOutcome;
        treatedAsInitialGoal = goalOutcome.data;
      }

      const dbUrlOutcome = await ensureEngineDbUrl(ctx.requestId);
      if (!dbUrlOutcome.ok) return dbUrlOutcome;

      // Blocker 2 (fix-wave): the renderer's mount gate is defense-in-depth,
      // not the authority — a mission session must never carry a per-turn
      // reasoningEffort, so strip it here from the session's OWN DB-read
      // mode, using the `session` this handler already fetched above. This
      // catches any renderer race (or future renderer bug) that lets a
      // reasoningEffort ride a mission-session submit.
      const forwardedReasoningEffort =
        input.reasoningEffort !== undefined && session.data.mode !== "mission"
          ? input.reasoningEffort
          : undefined;
      if (input.reasoningEffort !== undefined && session.data.mode === "mission") {
        log.debug(
          `[ipc:vex:chat:submit] stripped reasoningEffort for mission session correlationId=${ctx.requestId}`,
        );
      }

      try {
        const { submitOperatorInstruction } = await import(
          "@vex-agent/engine/index.js"
        );
        const result = await submitOperatorInstruction(
          input.sessionId,
          input.message,
          ctx.signal,
          // S6: per-turn reasoning effort, validated by chatSubmitInputSchema.
          // Absent (or stripped above for a mission session) → the field is
          // omitted entirely and the provider selects its own default; there
          // is no engine-side "medium" fallback.
          forwardedReasoningEffort === undefined
            ? undefined
            : { reasoningEffort: forwardedReasoningEffort },
        );
        log.info(
          `[ipc:vex:chat:submit] ok sessionId=${input.sessionId} ` +
            `initialGoal=${treatedAsInitialGoal} correlationId=${ctx.requestId}`,
        );
        return ok({
          text: result.text,
          toolCallsMade: result.toolCallsMade,
          pendingApprovals: result.pendingApprovals,
          stopReason: result.stopReason,
          missionStatus: result.missionStatus,
          treatedAsInitialGoal,
        });
      } catch (cause) {
        const kind = cause instanceof Error ? cause.name : typeof cause;
        // Diagnostic detail: engine failure messages carry no user content
        // (they name modules, tables, providers), so the first line is safe
        // to log locally — without it every failure collapses to kind=Error.
        const detail =
          cause instanceof Error
            ? ` message=${JSON.stringify(cause.message.split("\n")[0]?.slice(0, 300) ?? "")}` +
              ` at=${JSON.stringify(cause.stack?.split("\n")[1]?.trim().slice(0, 200) ?? "")}`
            : "";
        log.warn(
          `[ipc:vex:chat:submit] failed kind=${kind}${detail} correlationId=${ctx.requestId}`,
        );
        return err(classifyEngineError(cause, ctx.requestId));
      }
    },
  });
}
