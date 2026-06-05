// ── Production provider gate ───────────────────────────────────────

/**
 * Production provider/config gate. Wake resumes run the agent turn loop, which
 * needs the OpenRouter provider (OPENROUTER_API_KEY) and a model (AGENT_MODEL).
 * Mirrors the compact executor's pre-claim gate so a wake never consumes a row
 * it cannot service (e.g. before the vault injects the key at unlock).
 */
export function isWakeProviderConfigured(): boolean {
  return (
    Boolean(process.env.OPENROUTER_API_KEY) && Boolean(process.env.AGENT_MODEL)
  );
}
