import type { Result } from "../../../ipc/result.js";
import type {
  KnowledgeListInput,
  KnowledgeListResult,
  KnowledgeUpdateStatusInput,
  KnowledgeUpdateStatusResult,
} from "../../../schemas/knowledge.js";

/**
 * Knowledge management (stage 7-2a read + 7-2b mutation).
 *  - `list`: read-only sanitized list of the global knowledge store (no
 *    content_md / source_refs / embeddings).
 *  - `updateStatus`: disable/archive an active entry (one-way). User action;
 *    confirmed in the renderer + audited in main.
 */
export interface KnowledgeBridge {
  readonly list: (
    input: KnowledgeListInput,
  ) => Promise<Result<KnowledgeListResult>>;
  readonly updateStatus: (
    input: KnowledgeUpdateStatusInput,
  ) => Promise<Result<KnowledgeUpdateStatusResult>>;
}
