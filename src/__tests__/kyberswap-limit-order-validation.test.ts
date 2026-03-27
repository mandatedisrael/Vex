import { describe, it, expect } from "vitest";
import {
  validateEip712Message,
  validateOrdersResponse,
  validateCreateOrderResponse,
  validateActiveMakingAmount,
  validateOperatorSignature,
  validateEncodedCalldata,
  validateTradingPairsResponse,
  validateContractAddressResponse,
} from "../tools/kyberswap/limit-order/validation.js";

describe("validateEip712Message", () => {
  const VALID = {
    domain: { name: "KyberSwap", version: "1", chainId: 137, verifyingContract: "0xcab2FA2eeab7065B45CBcF6E3936dDE2506b4f6C" },
    types: { Order: [{ name: "makerAsset", type: "address" }] },
    primaryType: "Order",
    message: { salt: "12345", makerAsset: "0x1234567890123456789012345678901234567890" },
  };

  it("rejects non-object", () => { expect(() => validateEip712Message(null)).toThrow(); });
  it("rejects missing message", () => { expect(() => validateEip712Message({ domain: {}, types: {} })).toThrow(); });
  it("requires message.salt", () => { expect(() => validateEip712Message({ ...VALID, message: {} })).toThrow(); });

  it("parses valid EIP-712 message", () => {
    const result = validateEip712Message(VALID);
    expect(result.domain.name).toBe("KyberSwap");
    expect(result.domain.chainId).toBe(137);
    expect(result.primaryType).toBe("Order");
    expect(result.message.salt).toBe("12345");
  });
});

describe("validateOrdersResponse", () => {
  const ORDER = {
    id: 1, chainId: "137", makerAsset: "0x1", takerAsset: "0x2",
    maker: "0x3", makingAmount: "100", takingAmount: "200",
    filledMakingAmount: "0", filledTakingAmount: "0",
    status: "active", expiredAt: 9999999999, salt: "salt", signature: "sig",
    createdAt: "2024-01-01", updatedAt: "2024-01-01",
  };

  it("parses { orders: [...] } envelope", () => {
    const result = validateOrdersResponse({ orders: [ORDER] });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(1);
  });

  it("parses raw array", () => {
    const result = validateOrdersResponse([ORDER]);
    expect(result).toHaveLength(1);
  });

  it("defaults filled amounts to '0'", () => {
    const { filledMakingAmount, filledTakingAmount, ...orderNoFills } = ORDER;
    const result = validateOrdersResponse([orderNoFills]);
    expect(result[0].filledMakingAmount).toBe("0");
    expect(result[0].filledTakingAmount).toBe("0");
  });
});

describe("validateCreateOrderResponse", () => {
  it("parses { id: N }", () => {
    expect(validateCreateOrderResponse({ id: 42 })).toEqual({ orderId: 42 });
  });

  it("parses { orderId: N }", () => {
    expect(validateCreateOrderResponse({ orderId: 99 })).toEqual({ orderId: 99 });
  });

  it("rejects non-object", () => {
    expect(() => validateCreateOrderResponse(null)).toThrow();
  });
});

describe("validateActiveMakingAmount", () => {
  it("parses from activeMakingAmount", () => {
    expect(validateActiveMakingAmount({ activeMakingAmount: "500" })).toBe("500");
  });

  it("parses from data fallback", () => {
    expect(validateActiveMakingAmount({ data: "300" })).toBe("300");
  });

  it("rejects non-object", () => {
    expect(() => validateActiveMakingAmount(null)).toThrow();
  });
});

describe("validateOperatorSignature", () => {
  it("parses string array", () => {
    const result = validateOperatorSignature({ operatorSignatures: ["sig1", "sig2"] });
    expect(result.operatorSignatures).toEqual(["sig1", "sig2"]);
  });

  it("filters non-string entries", () => {
    const result = validateOperatorSignature({ operatorSignatures: ["sig1", 42, null] });
    expect(result.operatorSignatures).toEqual(["sig1"]);
  });

  it("returns empty array when missing", () => {
    const result = validateOperatorSignature({});
    expect(result.operatorSignatures).toEqual([]);
  });
});

describe("validateEncodedCalldata", () => {
  it("parses encodedData", () => {
    const result = validateEncodedCalldata({ encodedData: "0xabcdef" });
    expect(result.encodedData).toBe("0xabcdef");
  });

  it("parses optional routerAddress", () => {
    const result = validateEncodedCalldata({ encodedData: "0xabc", routerAddress: "0x1234567890123456789012345678901234567890" });
    expect(result.routerAddress).toBe("0x1234567890123456789012345678901234567890");
  });

  it("rejects non-object", () => {
    expect(() => validateEncodedCalldata(null)).toThrow();
  });

  it("rejects missing encodedData", () => {
    expect(() => validateEncodedCalldata({})).toThrow();
  });
});

describe("validateTradingPairsResponse", () => {
  it("parses array of pairs", () => {
    const result = validateTradingPairsResponse([
      { makerAsset: "0x1", takerAsset: "0x2", chainId: "1" },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].makerAsset).toBe("0x1");
  });

  it("parses { pairs: [...] } envelope", () => {
    const result = validateTradingPairsResponse({
      pairs: [{ makerAsset: "0x1", takerAsset: "0x2", chainId: "137" }],
    });
    expect(result).toHaveLength(1);
  });

  it("parses { data: [...] } envelope", () => {
    const result = validateTradingPairsResponse({
      data: [{ makerAsset: "0xA", takerAsset: "0xB", chainId: "56" }],
    });
    expect(result).toHaveLength(1);
    expect(result[0].chainId).toBe("56");
  });

  it("rejects non-array/non-object", () => {
    expect(() => validateTradingPairsResponse("bad")).toThrow();
  });
});

describe("validateContractAddressResponse", () => {
  it("parses object with string values", () => {
    const result = validateContractAddressResponse({ "1": "0xabc", "137": "0xdef" });
    expect(result["1"]).toBe("0xabc");
    expect(result["137"]).toBe("0xdef");
  });

  it("ignores non-string values", () => {
    const result = validateContractAddressResponse({ "1": "0xabc", "bad": 42 });
    expect(result["1"]).toBe("0xabc");
    expect(result["bad"]).toBeUndefined();
  });

  it("rejects non-object", () => {
    expect(() => validateContractAddressResponse(null)).toThrow();
  });
});
