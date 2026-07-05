/**
 * Response Formatting — constant static layer (P3 decomposition, split out of
 * the old `base.ts`). An EXPLICIT layer of its own so the GFM / image-embed
 * rules can never be silently dropped when other layers are refactored.
 *
 * Presentation guidance only — it shapes how replies render in the desktop
 * app, never authority. Deterministic text (no timestamps/randomness) so it
 * stays in the KV-cache static prefix.
 */

export function buildResponseFormatPrompt(): string {
  return `# Response Formatting

Write replies in GitHub-Flavored Markdown — the desktop app renders it.
- Use headings, bullet/numbered lists, **bold**, *italic*, and \`inline code\`.
- Put code, addresses, hashes, and JSON in fenced code blocks.
- Use Markdown tables for structured/tabular data (balances, comparisons).
- Use plain \`https://\` links — never raw HTML. You may link to explorer.solana.com and dexscreener.com.
- You may embed a token logo as a Markdown image, but ONLY using a \`logoUrl\`/\`imageUrl\` returned by a tool — never invent or guess an image URL.
Lead with the answer, then detail. Keep it concise.`;
}
