/**
 * Subagent messages repo — mama-dziecko communication channel.
 *
 * Schema: subagent_messages(id, subagent_id, direction, content, created_at)
 * Direction: 'to_parent' | 'to_child'
 */

import { query, queryOne, execute } from "../client.js";

export interface SubagentMessage {
  id: number;
  subagentId: string;
  direction: "to_parent" | "to_child";
  content: string;
  createdAt: string;
}

/** Send a message in the mama-dziecko channel. */
export async function sendMessage(
  subagentId: string,
  direction: "to_parent" | "to_child",
  content: string,
): Promise<number> {
  const row = await queryOne<{ id: number }>(
    "INSERT INTO subagent_messages (subagent_id, direction, content) VALUES ($1, $2, $3) RETURNING id",
    [subagentId, direction, content],
  );
  return row?.id ?? 0;
}

/** Get messages for a subagent, ordered by time. */
export async function getMessages(subagentId: string, limit = 100): Promise<SubagentMessage[]> {
  const rows = await query<Record<string, unknown>>(
    "SELECT * FROM subagent_messages WHERE subagent_id = $1 ORDER BY created_at ASC LIMIT $2",
    [subagentId, limit],
  );
  return rows.map(mapRow);
}

/** Get unread messages (direction filter — e.g. parent reads 'to_parent' messages). */
export async function getMessagesByDirection(
  subagentId: string,
  direction: "to_parent" | "to_child",
  limit = 50,
): Promise<SubagentMessage[]> {
  const rows = await query<Record<string, unknown>>(
    "SELECT * FROM subagent_messages WHERE subagent_id = $1 AND direction = $2 ORDER BY created_at ASC LIMIT $3",
    [subagentId, direction, limit],
  );
  return rows.map(mapRow);
}

function mapRow(r: Record<string, unknown>): SubagentMessage {
  return {
    id: r.id as number,
    subagentId: r.subagent_id as string,
    direction: r.direction as "to_parent" | "to_child",
    content: r.content as string,
    createdAt: (r.created_at as Date).toISOString(),
  };
}
