import type { Result } from "../../../ipc/result.js";
import type {
  KnowledgeListInput,
  KnowledgeListResult,
} from "../../../schemas/knowledge.js";

/**
 * Knowledge management — read-only list of the global knowledge store
 * (agent integration stage 7-2a). Sanitized metadata only (no content_md /
 * source_refs / embeddings). Disable/archive mutation lands in 7-2b.
 */
export interface KnowledgeBridge {
  readonly list: (
    input: KnowledgeListInput,
  ) => Promise<Result<KnowledgeListResult>>;
}
