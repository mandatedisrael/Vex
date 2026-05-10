/**
 * Typed ReplayBus singleton for database migration progress events.
 * Backed by the generic `ReplayBus<T>` primitive in `../events/event-bus.ts`.
 *
 * Replay note (codex turn 4): subscribe-time replay only fires for
 * in-process listeners. To deliver "latest state to a late renderer"
 * across the IPC boundary, the database handler explicitly calls
 * `peek()` and forwards the value to `ctx.event.sender.send(...)` for
 * joined single-flight invocations. The bus does NOT cross IPC alone.
 */

import type { MigrateProgress } from "@shared/schemas/database.js";
import { ReplayBus } from "../events/event-bus.js";

export const migrationProgressBus = new ReplayBus<MigrateProgress>();
