/**
 * Zod response schemas for the Jupiter Prediction API (codex-002) —
 * barrel re-export.
 *
 * Structurally split into the nested `./schemas/` subdirectory, grouped by
 * resource (events / markets / orderbooks / orders / positions / history /
 * profile / trades / leaderboard / vault / transactions). The shared PRIVATE
 * base schemas (`marketSchema`, `eventSchema`, `orderSchema`, `positionSchema`,
 * pagination/metadata bases, and the transaction-blob pieces) live in
 * `./schemas/_shared.js` and are single-sourced there.
 *
 * These gate the SHAPE of prediction responses at the HTTP boundary before any
 * value feeds transaction signing. The write endpoints (`/orders`,
 * `DELETE /positions(/:id)`, `/positions/:id/claim`) return a `transaction`
 * blob that `service.ts` hands to `signAndSendVersionedTx`, so the blob is
 * validated FIRMLY as standard base64 when present.
 *
 * ERROR-PATH PRESERVATION: the service treats a FALSEY transaction value
 * (`null` or `""`) as a DOMAIN error (`requireTransaction` → HTTP_REQUEST_FAILED,
 * service.ts:79-90, used at :101). The prediction wire carries no `errorCode`/
 * `errorMessage` companion field, so the schema must accept a falsey transaction
 * value UNCONDITIONALLY — it must NOT pre-empt that domain mapping with
 * HTTP_RESPONSE_INVALID. The `transaction` KEY is still required (it is present
 * in every wire response, never absent); only its VALUE may be `""`/`null`.
 * Hence the refine allows `""`/`null` and enforces base64 only for a non-empty
 * string.
 *
 * Every object `.passthrough()`es unknown keys: prediction services forward the
 * raw upstream body downstream, so forward-compatible fields must survive.
 *
 * Schemas are NOT the type source of truth — the wire interfaces in `types/`
 * stay canonical. Each client function keeps its declared return type, so `tsc`
 * verifies `z.infer<schema>` is assignable to the interface.
 *
 * Zod gates shape only; it cannot prove a transaction is economically safe.
 * Downstream deserialize/sign checks remain authoritative for that.
 */

export * from "./schemas/events.js";
export * from "./schemas/markets.js";
export * from "./schemas/orderbooks.js";
export * from "./schemas/orders.js";
export * from "./schemas/positions.js";
export * from "./schemas/history.js";
export * from "./schemas/profile.js";
export * from "./schemas/trades.js";
export * from "./schemas/leaderboard.js";
export * from "./schemas/vault.js";
export * from "./schemas/transactions.js";
