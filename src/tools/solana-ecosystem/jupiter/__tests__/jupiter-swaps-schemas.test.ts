/**
 * codex-002 financial gates for the Jupiter Swap V2 response schemas.
 *
 * These responses feed transaction signing, so the schema must accept valid
 * shapes (incl. forward-compatible extra fields) and reject malformed ones:
 * missing requestId, a non-base64 transaction blob, an empty success
 * signature, or an instruction with a bad pubkey / non-base64 data.
 */

import { describe, expect, it } from "vitest";
import {
  jupiterSwapBuildResponseSchema,
  jupiterSwapExecuteResponseSchema,
  jupiterSwapOrderResponseSchema,
} from "../jupiter-swaps/schemas.js";

const PUBKEY = "So11111111111111111111111111111111111111112";
const B64 = "AQIDBA=="; // base64 of [1,2,3,4]

function validOrder(): Record<string, unknown> {
  return {
    mode: "manual",
    inputMint: PUBKEY,
    outputMint: PUBKEY,
    inAmount: "1000",
    outAmount: "990",
    otherAmountThreshold: "980",
    routePlan: [],
    transaction: B64,
    requestId: "req-123",
  };
}

describe("jupiterSwapOrderResponseSchema", () => {
  it("accepts a valid order, including unknown forward-compat fields", () => {
    const r = jupiterSwapOrderResponseSchema.safeParse({
      ...validOrder(),
      someFutureField: { x: 1 },
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.requestId).toBe("req-123");
  });

  it("accepts transaction:null (RFQ path, no tx yet)", () => {
    expect(
      jupiterSwapOrderResponseSchema.safeParse({ ...validOrder(), transaction: null })
        .success,
    ).toBe(true);
  });

  it("rejects a missing requestId", () => {
    const { requestId: _omit, ...rest } = validOrder();
    expect(jupiterSwapOrderResponseSchema.safeParse(rest).success).toBe(false);
  });

  it("rejects a non-base64 transaction blob", () => {
    expect(
      jupiterSwapOrderResponseSchema.safeParse({ ...validOrder(), transaction: "!!not b64!!" })
        .success,
    ).toBe(false);
  });

  it("rejects a base64 string of impossible length", () => {
    // length 1 is not a valid base64 encoding
    expect(
      jupiterSwapOrderResponseSchema.safeParse({ ...validOrder(), transaction: "A" }).success,
    ).toBe(false);
  });

  it("accepts transaction:\"\" on Jupiter's 200-level error path (errorCode present)", () => {
    // The service maps {errorCode, transaction:""} to SOLANA_QUOTE_FAILED — the
    // schema must not pre-empt that with HTTP_RESPONSE_INVALID.
    expect(
      jupiterSwapOrderResponseSchema.safeParse({
        ...validOrder(),
        transaction: "",
        errorCode: 1001,
        errorMessage: "no route",
      }).success,
    ).toBe(true);
  });

  it("rejects transaction:\"\" when no error field is present", () => {
    expect(
      jupiterSwapOrderResponseSchema.safeParse({ ...validOrder(), transaction: "" }).success,
    ).toBe(false);
  });

  it("rejects an empty inAmount", () => {
    expect(
      jupiterSwapOrderResponseSchema.safeParse({ ...validOrder(), inAmount: "" }).success,
    ).toBe(false);
  });
});

describe("jupiterSwapExecuteResponseSchema", () => {
  const base = {
    code: 0,
    inputAmountResult: "1000",
    outputAmountResult: "990",
  };

  it("accepts Success with a signature", () => {
    expect(
      jupiterSwapExecuteResponseSchema.safeParse({ ...base, status: "Success", signature: "sig" })
        .success,
    ).toBe(true);
  });

  it("rejects Success with an empty signature", () => {
    expect(
      jupiterSwapExecuteResponseSchema.safeParse({ ...base, status: "Success", signature: "" })
        .success,
    ).toBe(false);
  });

  it("accepts Failed with an empty signature", () => {
    expect(
      jupiterSwapExecuteResponseSchema.safeParse({ ...base, status: "Failed", signature: "" })
        .success,
    ).toBe(true);
  });
});

describe("jupiterSwapBuildResponseSchema", () => {
  const instruction = {
    programId: PUBKEY,
    accounts: [{ pubkey: PUBKEY, isWritable: true, isSigner: false }],
    data: B64,
  };

  function validBuild(): Record<string, unknown> {
    return {
      inputMint: PUBKEY,
      outputMint: PUBKEY,
      inAmount: "1000",
      outAmount: "990",
      otherAmountThreshold: "980",
      routePlan: [],
      computeBudgetInstructions: [],
      setupInstructions: [],
      swapInstruction: instruction,
      cleanupInstruction: null,
      otherInstructions: [],
    };
  }

  it("accepts a valid build response", () => {
    expect(jupiterSwapBuildResponseSchema.safeParse(validBuild()).success).toBe(true);
  });

  it("rejects an instruction with non-base64 data", () => {
    expect(
      jupiterSwapBuildResponseSchema.safeParse({
        ...validBuild(),
        swapInstruction: { ...instruction, data: "@@@" },
      }).success,
    ).toBe(false);
  });

  it("rejects an instruction account with a bad pubkey", () => {
    expect(
      jupiterSwapBuildResponseSchema.safeParse({
        ...validBuild(),
        swapInstruction: {
          ...instruction,
          accounts: [{ pubkey: "0", isWritable: true, isSigner: false }],
        },
      }).success,
    ).toBe(false);
  });
});
