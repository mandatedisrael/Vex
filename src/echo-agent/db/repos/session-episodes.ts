/**
 * Session-episodes repo — barrel over the split submodules.
 *
 * Sits between `sessions.summary` (rolling per-session) and
 * `knowledge_entries` (canonical, cross-session, manually curated via
 * `knowledge_write` / `knowledge_supersede`). Episodes are write-once,
 * scoped by `memory_scope_key`, and used for recall-only augmentation of
 * the prompt — they never flow into knowledge automatically.
 *
 * Pre-split import `import * as sessionEpisodesRepo from
 * "@echo-agent/db/repos/session-episodes.js"` continues to resolve every
 * name below (types + functions).
 */

export {
  EPISODE_COLUMNS,
  EPISODE_KINDS,
  mapRow,
  type EpisodeKind,
  type NewEpisode,
  type RecallFilters,
  type RecallHit,
  type SessionEpisode,
  type SessionEpisodeRecallRow,
  type SessionEpisodeRow,
} from "./session-episodes/types.js";

export {
  getById,
  insertEpisodes,
  listRecentBySession,
} from "./session-episodes/crud.js";

export { recallTopK } from "./session-episodes/recall.js";
