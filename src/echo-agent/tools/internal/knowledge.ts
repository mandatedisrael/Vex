/**
 * Internal knowledge tool handlers — canonical agent memory layer.
 *
 * Public surface for all 6 knowledge_* handlers; implementations live in
 * ./knowledge/ submodules (one per handler). `params.ts` is an internal
 * helper used by write + supersede and is NOT re-exported here.
 *
 * All entries MUST be written in English regardless of conversation language —
 * see Knowledge Layer Rules in tool-usage.ts and registry tool descriptions.
 */

export { handleKnowledgeWrite } from "./knowledge/write.js";
export { handleKnowledgeRecall, handleKnowledgeRecallOverflow } from "./knowledge/recall.js";
export { handleKnowledgeGet } from "./knowledge/get.js";
export { handleKnowledgeUpdateStatus } from "./knowledge/update-status.js";
export { handleKnowledgeSupersede } from "./knowledge/supersede.js";
