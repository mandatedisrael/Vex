import type { Message } from "../types.js";

const COMPACTION_MSG_TRUNCATE_CHARS = 500;

const COMPACTION_SYSTEM_PROMPT = "You are a session summarizer. Produce a structured summary that enables seamless continuation in a new session.";

export function getCompactionSystemPrompt(): string {
  return COMPACTION_SYSTEM_PROMPT;
}

export function buildCompactionPrompt(messages: Message[], loadedFilePaths?: string[]): string {
  const transcript = messages
    .filter(m => m.role !== "system")
    .map(m => `[${m.role}]: ${m.content.slice(0, COMPACTION_MSG_TRUNCATE_CHARS)}`)
    .join("\n\n");

  const loadedFilesSection = loadedFilePaths && loadedFilePaths.length > 0
    ? `\nLoaded knowledge files during this session:\n${loadedFilePaths.map(p => `- ${p}`).join("\n")}\n`
    : "\nNo knowledge files were loaded during this session.\n";

  return `You are summarizing a conversation session for memory preservation and continuation.
${loadedFilesSection}
Produce THREE sections:

## Session Summary
A concise summary of what happened in this session (max 300 words). Include:
- Key decisions made
- Trades executed and their outcomes
- Important information learned
- Current portfolio state if discussed

## Continuation Context
This section enables the next session to pick up where this one left off.
- **Last task in progress:** What were you working on when the session ended? Be specific.
- **Files to re-read:** Which knowledge/reference files should be loaded in the next session to continue? List file paths.
- **Active state:** Any live positions, pending orders, scheduled tasks, or ongoing work that needs attention.
- **Next steps:** What should be done next?

## Key Insights for Memory
Extract 3-10 bullet points of important learnings, patterns, or user preferences that should be permanently remembered. These will be appended to persistent memory.

Format each insight as: "- [CATEGORY] insight text"
Categories: TRADING, PREFERENCE, MARKET, STRATEGY, RISK, SOCIAL, TECHNICAL

---

Session transcript:
${transcript}`;
}
