/**
 * Prompt assertion for episode extraction.
 *
 * Why: `summary_en` is already named for English, but the other text-bearing
 * fields in the episode schema (facts / decisions / open_loops / tool_outcomes
 * / entities) are arbitrary JSONB. These payloads are carried forward into
 * recall and downstream summarization, so they must also be in English to
 * stay aligned with Gemma's embedding space.
 */

import { describe, it, expect, vi } from "vitest";

import { extractEpisodes } from "@echo-agent/engine/checkpoint/extract.js";
import type { MessageWithId } from "@echo-agent/db/repos/messages.js";

function msg(id: number, role: MessageWithId["role"], content: string): MessageWithId {
  return {
    id,
    role,
    content,
    timestamp: `2026-04-17T00:00:${String(id).padStart(2, "0")}Z`,
  };
}

describe("extractEpisodes prompt", () => {
  it("mandates English for ALL text fields, not just summary_en", async () => {
    const seen: Array<{ role: string; content: string }> = [];
    const provider = {
      chatCompletionSimple: vi.fn().mockImplementation(async (messages: any) => {
        seen.push(...messages);
        return { content: "[]", usage: {} };
      }),
    };

    await extractEpisodes(
      [msg(1, "user", "cześć"), msg(2, "assistant", "hi")],
      provider as any,
      {} as any,
    );

    expect(seen).toHaveLength(1);
    const prompt = seen[0].content;

    // Global English directive covering every text field.
    expect(prompt).toMatch(/all text values/i);
    expect(prompt).toMatch(/must be in english/i);

    // Field-level reinforcement on the JSON schema sample.
    expect(prompt).toMatch(/facts.*english/is);
    expect(prompt).toMatch(/decisions.*english/is);
    expect(prompt).toMatch(/open_loops.*english/is);
    expect(prompt).toMatch(/tool_outcomes.*english/is);
    expect(prompt).toMatch(/entities.*english/is);
  });
});
