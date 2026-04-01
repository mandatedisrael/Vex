/**
 * Capture validator — runtime boundary check for _tradeCapture contracts.
 *
 * Called by runtime.ts after handler return, before projection pipeline.
 * Blocks capture:"full" results that lack required fields — fail-loud
 * instead of silent null-fill in downstream.
 */

import { MUTATION_MATRIX, isExpectedType } from "./mutation-matrix.js";
import logger from "@utils/logger.js";

/**
 * Validate a capture against its mutation contract.
 * Returns true if capture is valid and should proceed to projection pipeline.
 * Returns false if capture is invalid — caller should skip projection.
 */
export function validateCaptureContract(
  toolId: string,
  tradeCapture: Record<string, unknown> | null,
): boolean {
  const contract = MUTATION_MATRIX.get(toolId);
  if (!contract) {
    // Tool not in matrix — non-mutating or unknown. Let it through (no contract to validate against).
    return true;
  }

  if (contract.capture === "none") {
    // No capture expected — nothing to validate.
    return true;
  }

  // capture === "full" — handler must provide _tradeCapture
  if (!tradeCapture) {
    logger.error("capture.validator.missing_capture", {
      toolId,
      role: contract.role,
      hint: `Handler returned success without _tradeCapture but matrix requires capture:"full"`,
    });
    return false;
  }

  // Validate expectedType (type is now a required field — always present after field check)
  const actualType = typeof tradeCapture.type === "string" ? tradeCapture.type : "";
  if (actualType && !isExpectedType(contract, actualType)) {
    logger.error("capture.validator.unexpected_type", {
      toolId,
      expected: contract.expectedType,
      actual: actualType,
    });
    return false;
  }

  // Check required fields (with exception support)
  const missingFields: string[] = [];
  for (const field of contract.requiredFields) {
    const value = tradeCapture[field];
    if (value === undefined || value === null || value === "") {
      // Check if this field has an exception
      const hasException = contract.exceptions?.some(e =>
        e.toLowerCase().includes(`no ${field.toLowerCase()}`),
      );
      if (!hasException) {
        missingFields.push(field);
      }
    }
  }

  if (missingFields.length > 0) {
    logger.error("capture.validator.missing_fields", {
      toolId,
      role: contract.role,
      missingFields,
      hint: `Required fields for ${contract.role}: [${contract.requiredFields.join(", ")}]`,
    });
    return false;
  }

  // W4: validate required meta fields (e.g. contracts for prediction MTM)
  if (contract.requiredMetaFields && contract.requiredMetaFields.length > 0) {
    const meta = tradeCapture.meta as Record<string, unknown> | undefined;
    const missingMeta: string[] = [];
    for (const field of contract.requiredMetaFields) {
      const value = meta?.[field];
      if (value === undefined || value === null || value === "") {
        missingMeta.push(field);
      }
    }
    if (missingMeta.length > 0) {
      logger.error("capture.validator.missing_meta_fields", {
        toolId,
        missingMetaFields: missingMeta,
        hint: `Required meta fields: [${contract.requiredMetaFields.join(", ")}]`,
      });
      return false;
    }
  }

  // W4A valuation guard — hard fail when exact handler omits USD economics.
  // Blocks projection: capture without valuation from an "exact" handler is a handler regression.
  if (contract.valuationExpected === "exact") {
    const hasInputUsd = typeof tradeCapture.inputValueUsd === "string" && tradeCapture.inputValueUsd !== "";
    const hasOutputUsd = typeof tradeCapture.outputValueUsd === "string" && tradeCapture.outputValueUsd !== "";
    const vs = typeof tradeCapture.valuationSource === "string" ? tradeCapture.valuationSource : "";

    if (!hasInputUsd && !hasOutputUsd) {
      logger.error("capture.validator.missing_valuation", {
        toolId,
        valuationExpected: "exact",
        hint: "Handler must emit inputValueUsd or outputValueUsd for exact valuation tools",
      });
      return false;
    }
    if (!vs || vs === "none") {
      logger.error("capture.validator.missing_valuation_source", {
        toolId,
        valuationExpected: "exact",
        hint: "Handler must emit valuationSource != 'none' for exact valuation tools",
      });
      return false;
    }
  }

  return true;
}

/**
 * Check if a tool execution is a preview (dryRun) based on mutation contract.
 * Returns true if the tool supports preview AND the params indicate dryRun.
 */
export function isPreviewExecution(
  toolId: string,
  params: Record<string, unknown>,
): boolean {
  const contract = MUTATION_MATRIX.get(toolId);
  return contract?.previewSupport === true && params.dryRun === true;
}
