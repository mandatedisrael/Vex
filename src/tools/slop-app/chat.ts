/**
 * Slop App chat — Socket.IO wrappers for short-lived post/read operations.
 *
 * Unlike long-lived WS streams (DexScreener, Polymarket), these are
 * connect→action→disconnect flows that fit the discover/execute model.
 */

import { io, type Socket } from "socket.io-client";
import { EchoError, ErrorCodes } from "../../errors.js";
import type { ChatMessage, ChatPostResult } from "./types.js";

const CONNECT_TIMEOUT_MS = 30_000;
const POST_TIMEOUT_MS = 60_000;
const READ_TIMEOUT_MS = 15_000;

/**
 * Post a message to global chat via Socket.IO.
 * Connects, authenticates, sends, waits for own echo, then disconnects.
 */
export function postChatMessage(
  wsUrl: string,
  accessToken: string,
  message: string,
  gifUrl?: string | null,
): Promise<ChatPostResult> {
  return new Promise((resolve, reject) => {
    const socket: Socket = io(wsUrl, {
      transports: ["websocket"],
      timeout: CONNECT_TIMEOUT_MS,
    });

    let authenticated = false;
    const timeoutHandle = setTimeout(() => {
      socket.disconnect();
      reject(new EchoError(ErrorCodes.HTTP_TIMEOUT, "Chat connection timed out"));
    }, POST_TIMEOUT_MS);

    socket.on("connect", () => {
      socket.emit("chat:auth", { accessToken });
    });

    socket.on("chat:auth_ok", () => {
      authenticated = true;
      socket.emit("chat:send", {
        content: message,
        gifUrl: gifUrl || null,
      });
    });

    socket.on("chat:auth_failed", (data: { error: string }) => {
      clearTimeout(timeoutHandle);
      socket.disconnect();
      reject(new EchoError(ErrorCodes.CHAT_NOT_AUTHENTICATED, data.error || "Authentication failed"));
    });

    socket.on("chat:new", (msg: { id: string; senderAddress: string | null; content: string; timestamp: number }) => {
      // Wait for own message echo — compare content as sender confirmation
      if (authenticated && msg.content === message) {
        clearTimeout(timeoutHandle);
        socket.disconnect();
        resolve({ messageId: msg.id, timestamp: msg.timestamp });
      }
    });

    socket.on("chat:error", (data: { error: string }) => {
      clearTimeout(timeoutHandle);
      socket.disconnect();
      reject(new EchoError(ErrorCodes.CHAT_SEND_FAILED, data.error || "Chat error"));
    });

    socket.on("connect_error", (err: Error) => {
      clearTimeout(timeoutHandle);
      socket.disconnect();
      reject(new EchoError(ErrorCodes.HTTP_REQUEST_FAILED, `Connection failed: ${err.message}`));
    });

    socket.on("disconnect", (reason: string) => {
      if (!authenticated) {
        clearTimeout(timeoutHandle);
        reject(new EchoError(ErrorCodes.CHAT_SEND_FAILED, `Disconnected: ${reason}`));
      }
    });
  });
}

/**
 * Read recent chat messages. Connects, receives history, disconnects.
 * No authentication required.
 */
export function readChatHistory(
  wsUrl: string,
  limit?: number,
): Promise<ChatMessage[]> {
  return new Promise((resolve, reject) => {
    const query: Record<string, string> = {};
    if (limit) query.historyLimit = String(limit);

    const socket: Socket = io(wsUrl, {
      transports: ["websocket"],
      timeout: READ_TIMEOUT_MS,
      query,
    });

    const timeoutHandle = setTimeout(() => {
      socket.disconnect();
      reject(new EchoError(ErrorCodes.HTTP_TIMEOUT, "Chat history request timed out"));
    }, READ_TIMEOUT_MS);

    socket.on("chat:history", (messages: ChatMessage[]) => {
      clearTimeout(timeoutHandle);
      socket.disconnect();
      resolve(messages);
    });

    socket.on("connect_error", (err: Error) => {
      clearTimeout(timeoutHandle);
      socket.disconnect();
      reject(new EchoError(ErrorCodes.HTTP_REQUEST_FAILED, `Connection failed: ${err.message}`));
    });

    socket.on("chat:error", (data: { error: string }) => {
      clearTimeout(timeoutHandle);
      socket.disconnect();
      reject(new EchoError(ErrorCodes.CHAT_SEND_FAILED, data.error || "Chat error"));
    });
  });
}
