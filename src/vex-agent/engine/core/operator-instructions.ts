/**
 * Operator instructions — user messages injected while a loop is already
 * active. They are real transcript rows, but marked so the live loop can
 * merge only those rows between iterations.
 */

import type { Message, MessageWithId } from "@vex-agent/db/repos/messages.js";
import * as messagesRepo from "@vex-agent/db/repos/messages.js";
import {
  appendEngineMessage,
  appendMessage,
} from "@vex-agent/engine/events/index.js";

export const OPERATOR_INTERRUPT_MESSAGE_TYPE = "operator_interrupt";

const OPERATOR_INTERRUPT_CUE = [
  "[Engine: operator_interrupt — The operator sent new guidance while this autonomous run was active.",
  "Acknowledge the latest operator instruction briefly, apply it if it is compatible with the active contract, then continue the run.",
  "Do not ask the operator to start or continue the mission again unless they explicitly ask to leave execution.]",
].join(" ");

export function maxOperatorInstructionId(messages: readonly Message[]): number {
  let max = 0;
  for (const message of messages) {
    if (
      message.id !== undefined
      && message.role === "user"
      && message.metadata?.messageType === OPERATOR_INTERRUPT_MESSAGE_TYPE
      && message.id > max
    ) {
      max = message.id;
    }
  }
  return max;
}

export async function addOperatorInstruction(
  sessionId: string,
  content: string,
  payload: Record<string, unknown> = {},
): Promise<void> {
  await appendMessage(
    sessionId,
    { role: "user", content, timestamp: new Date().toISOString() },
    {
      source: "user",
      messageType: OPERATOR_INTERRUPT_MESSAGE_TYPE,
      visibility: "user",
      payload: { operatorInstruction: true, ...payload },
    },
  );
}

export async function addOperatorCue(sessionId: string): Promise<void> {
  await appendEngineMessage(
    sessionId,
    OPERATOR_INTERRUPT_CUE,
    {
      source: "engine",
      messageType: OPERATOR_INTERRUPT_MESSAGE_TYPE,
      visibility: "internal",
      payload: { operatorInstructionCue: true },
    },
  );
}

export async function appendPendingOperatorInstructions(input: {
  sessionId: string;
  afterId: number;
  liveMessages: Message[];
}): Promise<number> {
  const pending = await messagesRepo.getOperatorInstructionsAfter(input.sessionId, input.afterId);
  if (pending.length === 0) return input.afterId;

  const existingIds = new Set(input.liveMessages.map((message) => message.id));
  input.liveMessages.push(
    ...pending
      .filter((message) => !existingIds.has(message.id))
      .map(toLiveMessage),
  );
  await addOperatorCue(input.sessionId);
  input.liveMessages.push({
    role: "system",
    content: OPERATOR_INTERRUPT_CUE,
    timestamp: new Date().toISOString(),
    metadata: {
      source: "engine",
      messageType: OPERATOR_INTERRUPT_MESSAGE_TYPE,
      visibility: "internal",
      payload: { operatorInstructionCue: true },
    },
  });

  return pending[pending.length - 1]?.id ?? input.afterId;
}

function toLiveMessage(message: MessageWithId): Message {
  return {
    role: message.role,
    content: message.content,
    toolCallId: message.toolCallId,
    toolCalls: message.toolCalls,
    timestamp: message.timestamp,
    id: message.id,
    metadata: message.metadata,
  };
}
