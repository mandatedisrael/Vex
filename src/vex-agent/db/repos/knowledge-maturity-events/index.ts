/**
 * knowledge_maturity_events repo — public re-exports (controlled surface).
 */

export type {
  MaturityEventRecord,
  MaturityEventRow,
  MaturityEvent,
  MaturityReasonCode,
  MaturityDecidedBy,
  MaturityTriggerRefs,
} from "./types.js";

export { MATURITY_EVENT_COLUMNS, mapRow } from "./types.js";

export { recordMaturityEvent, getMaturityEventsForEntry } from "./crud.js";
