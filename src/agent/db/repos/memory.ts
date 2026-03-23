import { query, execute } from "../client.js";

interface MemoryRow { id: number; content: string; category: string | null; source: string | null; created_at: string }

export async function appendMemory(content: string, category?: string, source = "agent"): Promise<void> {
  await execute(
    "INSERT INTO memory_entries (content, category, source) VALUES ($1, $2, $3)",
    [content, category ?? null, source],
  );
}

export async function getMemoryEntries(limit = 200): Promise<MemoryRow[]> {
  return query<MemoryRow>(
    "SELECT id, content, category, source, created_at FROM memory_entries ORDER BY created_at ASC LIMIT $1",
    [limit],
  );
}

/** Concatenate all memory entries into a single text block (replaces memory.md). */
export async function getMemoryAsText(): Promise<string> {
  const entries = await getMemoryEntries(500);
  if (entries.length === 0) return "";
  return entries.map(e => e.content).join("\n\n");
}

export async function getMemorySize(): Promise<number> {
  const text = await getMemoryAsText();
  return Buffer.byteLength(text, "utf-8");
}

// ── CRUD operations for memory_manage tool ──────────────────────────

export interface MemoryEntry {
  id: number;
  content: string;
  category: string | null;
  createdAt: string;
}

/** List all entries with IDs so the agent can reference them for replace/delete. */
export async function listEntriesWithIds(limit = 500): Promise<MemoryEntry[]> {
  const rows = await query<MemoryRow>(
    "SELECT id, content, category, created_at FROM memory_entries ORDER BY created_at ASC LIMIT $1",
    [limit],
  );
  return rows.map(r => ({
    id: r.id,
    content: r.content,
    category: r.category,
    createdAt: r.created_at,
  }));
}

/** Replace the content of a specific memory entry by ID. */
export async function replaceEntry(id: number, content: string): Promise<boolean> {
  if (id <= 0) return false;
  if (!content || content.trim().length === 0) return false;
  const rowCount = await execute(
    "UPDATE memory_entries SET content = $1 WHERE id = $2",
    [content, id],
  );
  return rowCount === 1;
}

/** Delete a specific memory entry by ID. */
export async function deleteEntry(id: number): Promise<boolean> {
  if (id <= 0) return false;
  const rowCount = await execute(
    "DELETE FROM memory_entries WHERE id = $1",
    [id],
  );
  return rowCount === 1;
}
