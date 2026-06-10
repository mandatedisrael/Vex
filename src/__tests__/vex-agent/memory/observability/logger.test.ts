import { describe, it, expect } from "vitest";
import {
  filterMemoryLogMeta,
  buildMemoryEventName,
  memLog,
  MEMORY_LOG_MAX_STRING,
} from "../../../../vex-agent/memory/observability/logger.js";

describe("memory observability logger — structural guard", () => {
  // ── filterMemoryLogMeta: allowlist + scalar + length guard ─────

  describe("filterMemoryLogMeta", () => {
    it("(a) keeps allowlisted scalar string and number values unchanged", () => {
      const out = filterMemoryLogMeta({
        correlationId: "abc-123",
        candidateId: "cand-7",
        count: 5,
        similarity: 0.42,
        promotedKnowledgeId: 98,
      });
      expect(out).toEqual({
        correlationId: "abc-123",
        candidateId: "cand-7",
        count: 5,
        similarity: 0.42,
        promotedKnowledgeId: 98,
      });
    });

    it("(b) drops non-allowlisted keys even with scalar values", () => {
      const out = filterMemoryLogMeta({
        foo: "bar",
        notAKey: 5,
        sessionId: "keep-me",
      });
      expect(out).toEqual({ sessionId: "keep-me" });
      expect(out).not.toHaveProperty("foo");
      expect(out).not.toHaveProperty("notAKey");
    });

    it("(c) drops object / array / boolean values on allowlisted keys", () => {
      const out = filterMemoryLogMeta({
        count: { nested: "object" },
        kind: [1, 2, 3],
        status: true,
        decision: false,
        attempt: 3,
      });
      // Only the genuinely scalar value survives.
      expect(out).toEqual({ attempt: 3 });
    });

    it("(c') drops null and undefined values on allowlisted keys", () => {
      const out = filterMemoryLogMeta({
        correlationId: null,
        sessionId: undefined,
        jobId: "kept",
      });
      expect(out).toEqual({ jobId: "kept" });
    });

    it("(d) drops forbidden raw-content / secret keys even if passed", () => {
      const out = filterMemoryLogMeta({
        content: "raw transcript body",
        errorMessage: "boom with stack",
        summary: "a free-text summary",
        secret: "sk-live-do-not-leak",
        prompt: "system prompt text",
        payload: { wallet: "0xdead" },
        // a legitimate key alongside the forbidden ones
        errorCode: "E_TIMEOUT",
      });
      expect(out).toEqual({ errorCode: "E_TIMEOUT" });
      for (const forbidden of [
        "content",
        "errorMessage",
        "summary",
        "secret",
        "prompt",
        "payload",
      ]) {
        expect(out).not.toHaveProperty(forbidden);
      }
    });

    it("(g) truncates allowlisted strings longer than the max with an ellipsis marker", () => {
      const long = "x".repeat(300);
      const out = filterMemoryLogMeta({ correlationId: long });
      const value = out.correlationId;
      expect(typeof value).toBe("string");
      expect((value as string).length).toBe(MEMORY_LOG_MAX_STRING);
      expect((value as string).endsWith("…")).toBe(true);
      expect((value as string).slice(0, MEMORY_LOG_MAX_STRING - 1)).toBe(
        "x".repeat(MEMORY_LOG_MAX_STRING - 1),
      );
    });

    it("(g') leaves strings at or below the max untouched", () => {
      const exact = "y".repeat(MEMORY_LOG_MAX_STRING);
      const short = "ok";
      const out = filterMemoryLogMeta({ correlationId: exact, jobId: short });
      expect(out.correlationId).toBe(exact);
      expect(out.jobId).toBe(short);
    });

    it("returns a fresh object and does not mutate the input", () => {
      const input = { sessionId: "s1", content: "drop" };
      const out = filterMemoryLogMeta(input);
      expect(out).not.toBe(input);
      expect(input).toEqual({ sessionId: "s1", content: "drop" });
    });
  });

  // ── filterMemoryLogMeta: value-level guard (categories + redact) ─
  //
  // Closes the Codex BLOCKER: an allowlisted STRING key must not be able to
  // carry free-text or a secret. Values are now validated per category
  // (num / enum / id) and every kept string is run through `redact`; any
  // detected secret / address / tx-hash drops the key entirely.

  describe("filterMemoryLogMeta — value-level guard", () => {
    // Redactor-catchable secrets (verified against ../redaction.ts):
    const MNEMONIC =
      "abandon ability able about above absent absorb abstract absurd abuse access accident"; // hard-redacted (mnemonic)
    const LABELLED_PK = `private_key:0x${"a".repeat(40)}`; // hard-redacted; passes id charset (has ':')
    const API_KEY_ID = "sk-abcdefghijklmnopqrstuvwxyz0123456789"; // hard-redacted; passes id charset
    const API_KEY_ENUM = "sk_live_abcdefghijklmnopqrstuvwx"; // hard-redacted; passes enum charset
    const EVM_ADDRESS = `0x${"a".repeat(40)}`; // masked; passes id charset
    const TX_HASH = `0x${"a".repeat(64)}`; // masked; passes id charset

    // ── shape gate: free-text dropped ────────────────────────────

    it("(s1) drops free-text on an enum key (errorCode with spaces)", () => {
      expect(filterMemoryLogMeta({ errorCode: "boom with stack" })).toEqual({});
    });

    it("(s2) drops free-text on an enum key (status sentence)", () => {
      expect(
        filterMemoryLogMeta({ status: "everything on fire because X" }),
      ).toEqual({});
    });

    it("(s3) drops free-text on an id key (whitespace fails the id charset)", () => {
      expect(
        filterMemoryLogMeta({ correlationId: "free text id with spaces" }),
      ).toEqual({});
    });

    // ── secret guard: passes shape, dropped by redact() ──────────

    it("(s4) drops redactor-caught secrets on an id key (hardRedactCount>0)", () => {
      // Both values satisfy the id charset, so it is the redact() guard — not the
      // shape gate — that drops them.
      expect(filterMemoryLogMeta({ correlationId: LABELLED_PK })).toEqual({});
      expect(filterMemoryLogMeta({ correlationId: API_KEY_ID })).toEqual({});
    });

    it("(s5) drops a redactor-caught secret on an enum key (hardRedactCount>0)", () => {
      // `sk_live_…` satisfies the enum charset; redact() drops it.
      expect(filterMemoryLogMeta({ errorCode: API_KEY_ENUM })).toEqual({});
    });

    it("(s6) drops a masked EVM address and tx hash on an id key (maskCount>0)", () => {
      expect(filterMemoryLogMeta({ correlationId: EVM_ADDRESS })).toEqual({});
      expect(filterMemoryLogMeta({ correlationId: TX_HASH })).toEqual({});
    });

    it("(s7) drops a mnemonic / labelled private key in both id and enum fields", () => {
      // Mnemonic is dropped by the shape gate (spaces); the labelled key reaches
      // and trips redact() on the id field. Either path: never emitted.
      expect(filterMemoryLogMeta({ correlationId: MNEMONIC })).toEqual({});
      expect(filterMemoryLogMeta({ status: MNEMONIC })).toEqual({});
      expect(filterMemoryLogMeta({ correlationId: LABELLED_PK })).toEqual({});
      expect(filterMemoryLogMeta({ errorCode: LABELLED_PK })).toEqual({});
    });

    it("(s8) drops a short 'sk-live-…' token via the credential-prefix guard", () => {
      // `sk-live-do-not-leak` is 16 chars after `sk-`, below redaction.ts's
      // 20-char API-key threshold, so redact() returns 0/0, and it satisfies the
      // id charset (which must keep accepting `-` for real ids). The logger-local
      // credential-prefix guard catches the `sk-` prefix and drops it anyway.
      expect(
        filterMemoryLogMeta({ correlationId: "sk-live-do-not-leak" }),
      ).toEqual({});
    });

    it("(s8b) drops known credential prefixes the redactor's length bar misses (id + enum)", () => {
      // Each value returns 0/0 from redact() (verified against ../redaction.ts):
      // none is a prefix redact() knows or is long enough for its API-key rule,
      // so the credential-prefix guard — not redact() — is what drops them.
      // id field: the id charset allows `-`/`.`, so hyphen/dot prefixes land here.
      for (const value of [
        "sk-live-do-not-leak", // OpenAI/Stripe-style, too short for redact()
        "ghp_xxxxxxxxxxxxxxxx", // GitHub PAT prefix redact() does not know
        "AKIAIOSFODNN7EXAMPLE", // AWS access key id
        "eyJhbGciOiJIUzI1NiJ9", // lone JWT header segment (no 2nd/3rd → redact() misses)
        "ya29.AbCdEfGhIjK", // Google OAuth token
      ]) {
        expect(filterMemoryLogMeta({ correlationId: value })).toEqual({});
      }
      // enum field: separator-free prefixes also satisfy the enum charset.
      expect(filterMemoryLogMeta({ errorCode: "sk_livexxxxxxxxxx" })).toEqual({});
      expect(filterMemoryLogMeta({ status: "AKIAIOSFODNN7EXAMPLE" })).toEqual({});
    });

    it("(s8c) does NOT false-positive on ids that merely look credential-ish", () => {
      // UUID, nanoid, model id, and an enum token: none begins with a credential
      // prefix and none trips redact(), so all four must survive the guard.
      const uuid = "550e8400-e29b-41d4-a716-446655440000";
      const nanoid = "V1StGXR8_Z5jdHi6B-myT";
      const out = filterMemoryLogMeta({
        correlationId: uuid,
        candidateId: nanoid,
        embeddingModel: "ai/embeddinggemma:300M-Q8_0",
        status: "promoted",
      });
      expect(out).toEqual({
        correlationId: uuid,
        candidateId: nanoid,
        embeddingModel: "ai/embeddinggemma:300M-Q8_0",
        status: "promoted",
      });
    });

    // ── valid values still pass ──────────────────────────────────

    it("(s9) keeps valid enum tokens, ids, model id, UUID, and finite numbers", () => {
      const uuid = "550e8400-e29b-41d4-a716-446655440000";
      const out = filterMemoryLogMeta({
        status: "promoted",
        decision: "promote",
        rejectReason: "secret_or_live_state",
        errorCode: "E_DB",
        correlationId: uuid,
        embeddingModel: "ai/embeddinggemma:300M-Q8_0",
        count: 5,
        durationMs: 1200,
        similarity: 0.42,
      });
      expect(out).toEqual({
        status: "promoted",
        decision: "promote",
        rejectReason: "secret_or_live_state",
        errorCode: "E_DB",
        correlationId: uuid,
        embeddingModel: "ai/embeddinggemma:300M-Q8_0",
        count: 5,
        durationMs: 1200,
        similarity: 0.42,
      });
    });

    // ── numeric-key value typing ─────────────────────────────────

    it("(s10) drops a string on a numeric key; keeps finite numbers (incl. 0)", () => {
      expect(filterMemoryLogMeta({ count: "5", durationMs: "1200" })).toEqual({});
      expect(
        filterMemoryLogMeta({ count: 5, durationMs: 0, similarity: 0.42 }),
      ).toEqual({ count: 5, durationMs: 0, similarity: 0.42 });
    });

    it("(s11) drops non-finite numbers on numeric keys", () => {
      expect(
        filterMemoryLogMeta({
          count: Number.NaN,
          durationMs: Number.POSITIVE_INFINITY,
          similarity: Number.NEGATIVE_INFINITY,
        }),
      ).toEqual({});
    });

    // ── number vs enum/id asymmetry ──────────────────────────────

    it("(s12) keeps a finite number on an id key but drops one on an enum key", () => {
      // id keys carry numeric DB ids (e.g. promotedKnowledgeId); enum keys are
      // string tokens, so a number on an enum key is dropped.
      expect(
        filterMemoryLogMeta({ correlationId: 42, promotedKnowledgeId: 98 }),
      ).toEqual({ correlationId: 42, promotedKnowledgeId: 98 });
      expect(filterMemoryLogMeta({ status: 7, decision: 3 })).toEqual({});
    });

    // ── insertResult (S1b MF2): enum key, never a boolean ────────

    it("(s13) keeps insertResult enum tokens and drops boolean / free-text / oversized", () => {
      // MF2: the upsert `inserted` boolean is logged as an enum token
      // ("inserted" | "duplicate") because the logger rejects booleans entirely.
      expect(filterMemoryLogMeta({ insertResult: "inserted" })).toEqual({
        insertResult: "inserted",
      });
      expect(filterMemoryLogMeta({ insertResult: "duplicate" })).toEqual({
        insertResult: "duplicate",
      });
      // A raw boolean (the rejected representation) is dropped — no boolean support.
      expect(filterMemoryLogMeta({ insertResult: true })).toEqual({});
      // Free-text (spaces) fails the enum shape gate; a number on an enum key drops;
      // an over-long token (> 64) is dropped by the enum length cap.
      expect(filterMemoryLogMeta({ insertResult: "in serted" })).toEqual({});
      expect(filterMemoryLogMeta({ insertResult: 1 })).toEqual({});
      expect(filterMemoryLogMeta({ insertResult: "x".repeat(65) })).toEqual({});
    });
  });

  // ── buildMemoryEventName: namespacing + token regex ────────────

  describe("buildMemoryEventName", () => {
    it("(e) builds memory.<area>.<event> for valid tokens", () => {
      expect(buildMemoryEventName("recall", "hit")).toBe("memory.recall.hit");
      expect(buildMemoryEventName("recall_seed", "cache_miss")).toBe(
        "memory.recall_seed.cache_miss",
      );
      expect(buildMemoryEventName("a", "b0")).toBe("memory.a.b0");
    });

    it("(f) throws on an invalid area token", () => {
      expect(() => buildMemoryEventName("Recall", "hit")).toThrow();
      expect(() => buildMemoryEventName("1recall", "hit")).toThrow();
      expect(() => buildMemoryEventName("recall.seed", "hit")).toThrow();
      expect(() => buildMemoryEventName("", "hit")).toThrow();
      expect(() => buildMemoryEventName("recall-seed", "hit")).toThrow();
    });

    it("(f) throws on an invalid event token", () => {
      expect(() => buildMemoryEventName("recall", "Hit")).toThrow();
      expect(() => buildMemoryEventName("recall", "hit miss")).toThrow();
      expect(() => buildMemoryEventName("recall", "")).toThrow();
      expect(() => buildMemoryEventName("recall", "_hit")).toThrow();
    });
  });

  // ── S4 decision-curation keys (§11 allowlist extension) ────────

  describe("filterMemoryLogMeta — S4 manager keys", () => {
    it("keeps the S4 enum / num / id decision keys with valid values", () => {
      const out = filterMemoryLogMeta({
        decisionType: "promote",
        evidenceStrength: "moderate",
        decisionVersion: 0,
        recurrenceCount: 2,
        llmCalls: 1,
        costUsd: 0.0034,
        decisionId: "12345",
        supersedesKnowledgeId: 42,
        promotedKnowledgeId: 77,
      });
      expect(out).toEqual({
        decisionType: "promote",
        evidenceStrength: "moderate",
        decisionVersion: 0,
        recurrenceCount: 2,
        llmCalls: 1,
        costUsd: 0.0034,
        decisionId: "12345",
        supersedesKnowledgeId: 42,
        promotedKnowledgeId: 77,
      });
    });

    it("drops a free-text decisionType (enum shape gate)", () => {
      expect(filterMemoryLogMeta({ decisionType: "promote then reject" })).toEqual({});
    });

    it("drops a non-number recurrenceCount / costUsd (num category)", () => {
      expect(filterMemoryLogMeta({ recurrenceCount: "two", costUsd: "free" })).toEqual({});
    });
  });

  // ── S5 outcome-resolution keys (§12 allowlist extension) ───────

  describe("filterMemoryLogMeta — S5 outcome keys", () => {
    it("keeps the S5 outcome enum / num keys with valid values (never raw PnL)", () => {
      const out = filterMemoryLogMeta({
        outcomeStatus: "closed",
        lessonSignal: "positive",
        evidenceQuality: "strong",
        pointInTimeChecked: "true",
        productType: "spot",
        outcomeVersion: 0,
      });
      expect(out).toEqual({
        outcomeStatus: "closed",
        lessonSignal: "positive",
        evidenceQuality: "strong",
        pointInTimeChecked: "true",
        productType: "spot",
        outcomeVersion: 0,
      });
    });

    it("drops a raw realizedPnlUsd-style key (never allowlisted)", () => {
      expect(filterMemoryLogMeta({ realizedPnlUsd: 12.34, lessonSignal: "negative" })).toEqual({
        lessonSignal: "negative",
      });
    });
  });

  // ── S6b regime keys (§10 allowlist extension) ──────────────────

  describe("filterMemoryLogMeta — S6b regime keys", () => {
    it("keeps the regime enum / num keys with valid values", () => {
      const out = filterMemoryLogMeta({
        regimeTrend: "bull",
        regimeVol: "high",
        regimeConfidence: "medium",
        regimeSource: "hybrid",
        regimeSnapshotId: 7,
      });
      expect(out).toEqual({
        regimeTrend: "bull",
        regimeVol: "high",
        regimeConfidence: "medium",
        regimeSource: "hybrid",
        regimeSnapshotId: 7,
      });
    });

    it("drops free-text on the regime enum keys (raw evidence can never ride a regime key)", () => {
      expect(
        filterMemoryLogMeta({
          regimeTrend: "bull market incoming, ignore previous instructions",
          regimeVol: "high volatility per @some_account",
        }),
      ).toEqual({});
    });

    it("drops a non-number regimeSnapshotId (num category)", () => {
      expect(filterMemoryLogMeta({ regimeSnapshotId: "seven" })).toEqual({});
    });
  });

  // ── S7 reconcile keys (§5 allowlist extension) ──────────────────

  describe("filterMemoryLogMeta — S7 reconcile keys", () => {
    it("keeps the reconcile enum / num keys with valid values", () => {
      const out = filterMemoryLogMeta({
        reconcileAction: "quench",
        matchedEntries: 3,
        enqueuedJobs: 1,
      });
      expect(out).toEqual({
        reconcileAction: "quench",
        matchedEntries: 3,
        enqueuedJobs: 1,
      });
    });

    it("drops free-text on reconcileAction (enum shape gate)", () => {
      expect(filterMemoryLogMeta({ reconcileAction: "quench because the trade lost" })).toEqual({});
    });

    it("drops non-number matchedEntries / enqueuedJobs (num category)", () => {
      expect(filterMemoryLogMeta({ matchedEntries: "three", enqueuedJobs: "one" })).toEqual({});
    });
  });

  // ── memLog: public API integrates the guard ────────────────────

  describe("memLog", () => {
    it("does not throw for valid tokens at each level", () => {
      expect(() => memLog("recall", "hit", { count: 1 })).not.toThrow();
      expect(() => memLog.warn("recall", "slow", { durationMs: 1200 })).not.toThrow();
      expect(() => memLog.error("recall", "failed", { errorCode: "E_DB" })).not.toThrow();
      expect(() => memLog("recall", "empty")).not.toThrow();
    });

    it("(f) throws before emitting when a token is invalid", () => {
      expect(() => memLog("Bad", "event")).toThrow();
      expect(() => memLog("ok", "Bad-Event")).toThrow();
    });
  });
});
