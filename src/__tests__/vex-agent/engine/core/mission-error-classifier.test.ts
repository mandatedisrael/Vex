import { describe, it, expect } from "vitest";
import { classifyMissionRunError } from "../../../../vex-agent/engine/core/runner/mission-error-classifier.js";
import {
  normalizeOpenRouterError,
  attachStatus,
} from "../../../../vex-agent/inference/openrouter/errors.js";

/** Build an Error with arbitrary extra fields (status/code/retryable/name). */
function err(
  message: string,
  extra: Record<string, unknown> = {},
): Error {
  const e = new Error(message);
  Object.assign(e, extra);
  return e;
}

describe("classifyMissionRunError", () => {
  describe("transient", () => {
    // fix #2 (deliberate test update): the classifier no longer parses
    // `err.message` at all — every status-carrying error must classify from
    // the `status`/`statusCode` own-property. These two tests used to build
    // their fixtures from a "returned NNN" message string (the regex this
    // change removes); rewritten to set the status own-property instead.
    it("429 via status own-property (message parsing removed)", () => {
      expect(classifyMissionRunError(err("Provider rate limited", { status: 429 }))).toBe("transient");
    });
    it("5xx via status own-property (502/503/504/500) (message parsing removed)", () => {
      for (const s of [500, 502, 503, 504]) {
        expect(classifyMissionRunError(err("upstream failure", { status: s }))).toBe("transient");
      }
    });
    it("status field 429/503", () => {
      expect(classifyMissionRunError(err("x", { status: 429 }))).toBe("transient");
      expect(classifyMissionRunError(err("x", { statusCode: 503 }))).toBe("transient");
    });
    it("socket/network node codes", () => {
      for (const code of ["ETIMEDOUT", "ECONNRESET", "ECONNREFUSED", "EAI_AGAIN", "EPIPE"]) {
        expect(classifyMissionRunError(err("net", { code }))).toBe("transient");
      }
    });
    it("causeCode transient allow-list (own-property, no message parsing)", () => {
      for (const causeCode of [
        "ETIMEDOUT", "ECONNRESET", "ECONNREFUSED", "EAI_AGAIN", "EPIPE",
        "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT", "UND_ERR_SOCKET",
      ]) {
        expect(classifyMissionRunError(err("transport failure", { causeCode }))).toBe("transient");
      }
    });
    it("normalized-shaped error with causeCode:'ECONNRESET' (no status) is transient", () => {
      const normalized = err("OpenRouter streaming chat completion failed: unknown error", {
        causeCode: "ECONNRESET",
      });
      expect(classifyMissionRunError(normalized)).toBe("transient");
    });
    it("HTTP_TIMEOUT vex code (even when surfaced as AbortError)", () => {
      expect(classifyMissionRunError(err("timed out", { code: "HTTP_TIMEOUT", name: "AbortError" }))).toBe("transient");
    });
    it("explicit retryable marker from a mapper", () => {
      expect(classifyMissionRunError(err("khalani 5xx", { retryable: true }))).toBe("transient");
    });

    // ── fix #2: normalized OpenRouter errors classify from the STATUS PROPERTY,
    // not a message regex. The redacted message contains "status=NNN" but the
    // classifier must read the attached own-property; these messages are scrubbed
    // and deliberately do NOT contain the `\breturned NNN\b` shape the regex
    // would otherwise key off.
    it("normalized OpenRouter 429 is transient via the status own-property", () => {
      const sdkErr = Object.assign(new Error("sdk"), {
        statusCode: 429,
        error: { code: 429, message: "rate limited" },
      });
      const normalized = normalizeOpenRouterError(sdkErr, "chat completion");
      // Message intentionally lacks the legacy "returned NNN" regex anchor.
      expect(/\breturned\s+\d{3}\b/.test(normalized.message)).toBe(false);
      expect(classifyMissionRunError(normalized)).toBe("transient");
    });

    it("normalized OpenRouter 5xx is transient via the status own-property", () => {
      for (const status of [500, 502, 503, 504]) {
        const sdkErr = Object.assign(new Error("sdk"), {
          statusCode: status,
          error: { code: status, message: "upstream failure" },
        });
        const normalized = normalizeOpenRouterError(sdkErr, "chat completion");
        expect(/\breturned\s+\d{3}\b/.test(normalized.message)).toBe(false);
        expect(classifyMissionRunError(normalized)).toBe("transient");
      }
    });

    it("streaming-error status (attachStatus) classifies 429/5xx as transient", () => {
      // Mirrors stream-consumer.ts: chunk.error → new Error(message) with the
      // status attached from chunk.errorCode.
      for (const status of [429, 502, 503]) {
        const streamErr = attachStatus(new Error("stream error"), status);
        expect(classifyMissionRunError(streamErr)).toBe("transient");
      }
    });
  });

  describe("permanent (default-deny)", () => {
    it("user/abort without a timeout code", () => {
      expect(classifyMissionRunError(err("aborted", { name: "AbortError" }))).toBe("permanent");
    });
    it("4xx incl 401/403/404/422 (not 429)", () => {
      for (const s of [400, 401, 403, 404, 422]) {
        expect(classifyMissionRunError(err(`returned ${s}`))).toBe("permanent");
        expect(classifyMissionRunError(err("x", { status: s }))).toBe("permanent");
      }
    });
    it("validation / contract / business errors (unknown shape)", () => {
      expect(classifyMissionRunError(err("AGENT_VALIDATION_ERROR: bad args"))).toBe("permanent");
      expect(classifyMissionRunError(err("INSUFFICIENT_BALANCE"))).toBe("permanent");
      expect(classifyMissionRunError(err("HTTP_RESPONSE_INVALID: malformed json"))).toBe("permanent");
    });
    it("non-Error inputs", () => {
      expect(classifyMissionRunError("just a string")).toBe("permanent");
      expect(classifyMissionRunError(null)).toBe("permanent");
      expect(classifyMissionRunError({ message: "fake" })).toBe("permanent");
    });
    it("retryable:false does not force transient; unknown stays permanent", () => {
      expect(classifyMissionRunError(err("mystery", { retryable: false }))).toBe("permanent");
    });
    it("normalized OpenRouter 4xx (401/404/422) stays permanent via the status property", () => {
      for (const status of [401, 403, 404, 422]) {
        const sdkErr = Object.assign(new Error("sdk"), {
          statusCode: status,
          error: { code: status, message: "client error" },
        });
        const normalized = normalizeOpenRouterError(sdkErr, "chat completion");
        expect(classifyMissionRunError(normalized)).toBe("permanent");
      }
    });
    it("explicit permanent HTTP status beats a contradictory retryable:true", () => {
      // A mapper that wrongly set retryable:true must NOT promote a 401 to transient.
      expect(classifyMissionRunError(err("x", { retryable: true, status: 401 }))).toBe("permanent");
      expect(classifyMissionRunError(err("x", { retryable: true, status: 404 }))).toBe("permanent");
      // …but a 503 with retryable:true is still transient (consistent).
      expect(classifyMissionRunError(err("x", { retryable: true, status: 503 }))).toBe("transient");
    });

    it("causeCode hard-exclusions (incl. ABORT_ERR) always classify permanent", () => {
      for (const causeCode of [
        "ABORT_ERR", "UND_ERR_ABORTED", "ENOTFOUND", "UND_ERR_CLOSED",
        "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
      ]) {
        expect(classifyMissionRunError(err("x", { causeCode }))).toBe("permanent");
      }
    });

    it("an unknown errno-shaped causeCode stays permanent (not on any allow-list)", () => {
      expect(classifyMissionRunError(err("x", { causeCode: "SOME_UNKNOWN_ERRNO" }))).toBe("permanent");
    });

    it("a hard-exclusion causeCode beats a contradictory retryable:true (the operator-abort loophole)", () => {
      // If some other mapper wrongly stamped retryable:true on a normalized
      // abort, the hard-exclusion must still win — this is the ONLY defense
      // against auto-retrying an operator stop once `err.name` is erased.
      expect(classifyMissionRunError(err("x", { retryable: true, causeCode: "ABORT_ERR" }))).toBe("permanent");
      expect(classifyMissionRunError(err("x", { retryable: true, causeCode: "ENOTFOUND" }))).toBe("permanent");
    });
  });
});
