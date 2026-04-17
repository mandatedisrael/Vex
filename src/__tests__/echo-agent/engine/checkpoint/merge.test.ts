/**
 * Prompt assertion for the rolling-summary merge step.
 *
 * Why: summaries are embedded and queried by Gemma, which aligns best on
 * English text. A source conversation in another language must be translated
 * before it is written into `sessions.summary` — otherwise recall quality
 * degrades silently.
 */

import { describe, it, expect, vi } from "vitest";

import { summarizePrefix } from "@echo-agent/engine/checkpoint/merge.js";
import type { MessageWithId } from "@echo-agent/db/repos/messages.js";

function msg(id: number, role: MessageWithId["role"], content: string): MessageWithId {
  return {
    id,
    role,
    content,
    timestamp: `2026-04-17T00:00:${String(id).padStart(2, "0")}Z`,
  };
}

describe("summarizePrefix prompt", () => {
  it("instructs the summarizer to output in English", async () => {
    const seen: Array<{ role: string; content: string }> = [];
    const provider = {
      chatCompletionSimple: vi.fn().mockImplementation(async (messages: any) => {
        seen.push(...messages);
        return { content: "summary", usage: {} };
      }),
    };

    await summarizePrefix(
      [msg(1, "user", "cześć"), msg(2, "assistant", "hi")],
      null,
      provider as any,
      {} as any,
    );

    expect(seen).toHaveLength(1);
    expect(seen[0].role).toBe("system");
    expect(seen[0].content).toMatch(/output in english/i);
  });
});
