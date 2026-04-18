/**
 * Registry completeness — structural invariants for the protocol catalog.
 *
 * Dopełnia `sync/capture-contract.test.ts` (which already asserts
 * `mutating → MUTATION_MATRIX` coverage). This file asserts the symmetric
 * side: manifest ↔ handler pairing, no duplicate tool IDs, namespace
 * allowlist coherence, and registration table consistency.
 *
 * Written against the post-PR1 `NAMESPACE_MODULES` registration model —
 * `catalog.ts` builds its indices from this table at module load and
 * throws on duplicates, so these tests are defense-in-depth: they catch
 * regressions earlier (fail one test instead of the whole module graph)
 * and document the invariants explicitly.
 */

import { describe, it, expect } from "vitest";
import {
  NAMESPACE_MODULES,
  PROTOCOL_TOOLS,
  PROTOCOL_NAMESPACE_ALLOWLIST,
  NAMESPACE_DEFAULTS,
  getProtocolHandler,
  getProtocolManifest,
  isAdvertisedProtocolNamespace,
  isKnownProtocolNamespace,
} from "@echo-agent/tools/protocols/catalog.js";

describe("registry completeness", () => {
  it("every manifest has a handler and every handler has a manifest", () => {
    const manifestIds = new Set(PROTOCOL_TOOLS.map((m) => m.toolId));
    const handlerIds = new Set<string>();
    for (const mod of NAMESPACE_MODULES) {
      for (const id of Object.keys(mod.handlers)) handlerIds.add(id);
    }

    // manifest → handler
    const manifestsWithoutHandler = [...manifestIds].filter((id) => !handlerIds.has(id));
    expect(manifestsWithoutHandler, "manifests missing a handler").toEqual([]);

    // handler → manifest
    const handlersWithoutManifest = [...handlerIds].filter((id) => !manifestIds.has(id));
    expect(handlersWithoutManifest, "orphaned handlers (no manifest)").toEqual([]);
  });

  it("no duplicate toolId across namespace modules", () => {
    const seen = new Map<string, string>(); // toolId → namespace that registered it
    const duplicates: string[] = [];
    for (const mod of NAMESPACE_MODULES) {
      for (const manifest of mod.manifests) {
        const prior = seen.get(manifest.toolId);
        if (prior !== undefined) {
          duplicates.push(`${manifest.toolId}: ${prior} vs ${mod.namespace}`);
        } else {
          seen.set(manifest.toolId, mod.namespace);
        }
      }
    }
    expect(duplicates, "duplicate toolId across namespaces").toEqual([]);
  });

  it("every manifest.namespace matches the namespace module that registered it", () => {
    const mismatches: string[] = [];
    for (const mod of NAMESPACE_MODULES) {
      for (const manifest of mod.manifests) {
        if (manifest.namespace !== mod.namespace) {
          mismatches.push(`${manifest.toolId}: declares ${manifest.namespace}, registered under ${mod.namespace}`);
        }
      }
    }
    expect(mismatches, "manifest namespace mismatch").toEqual([]);
  });

  it("getProtocolManifest returns O(1) lookup equal to the registered manifest", () => {
    for (const manifest of PROTOCOL_TOOLS) {
      const fetched = getProtocolManifest(manifest.toolId);
      expect(fetched, `lookup missed for ${manifest.toolId}`).toBeDefined();
      expect(fetched).toBe(manifest); // reference equality — same object
    }
    expect(getProtocolManifest("definitely-nonexistent-tool-id")).toBeUndefined();
  });

  it("getProtocolHandler returns a function for every manifest.toolId", () => {
    const missing: string[] = [];
    for (const manifest of PROTOCOL_TOOLS) {
      const handler = getProtocolHandler(manifest.toolId);
      if (typeof handler !== "function") missing.push(manifest.toolId);
    }
    expect(missing, "manifests with no handler function").toEqual([]);
  });

  it("PROTOCOL_NAMESPACE_ALLOWLIST is covered by NAMESPACE_DEFAULTS", () => {
    for (const ns of PROTOCOL_NAMESPACE_ALLOWLIST) {
      expect(NAMESPACE_DEFAULTS[ns], `missing default for namespace ${ns}`).toBeDefined();
    }
  });

  it("every namespace in NAMESPACE_MODULES is in the allowlist", () => {
    const allowed = new Set<string>(PROTOCOL_NAMESPACE_ALLOWLIST);
    const extra = NAMESPACE_MODULES.map((m) => m.namespace).filter((ns) => !allowed.has(ns));
    expect(extra, "NAMESPACE_MODULES entry missing from PROTOCOL_NAMESPACE_ALLOWLIST").toEqual([]);
  });

  it("advertised namespaces are a subset of the allowlist", () => {
    for (const ns of PROTOCOL_NAMESPACE_ALLOWLIST) {
      if (isAdvertisedProtocolNamespace(ns)) {
        expect(isKnownProtocolNamespace(ns)).toBe(true);
      }
    }
  });

  it("reserved namespaces (known but without a module) still resolve through helpers", () => {
    // `0g-compute` and `0g-storage` are in the allowlist but have no
    // NAMESPACE_MODULES entry (reserved placeholders — navigation metadata
    // only). The catalog helpers must handle them without crashing.
    const modNamespaces = new Set(NAMESPACE_MODULES.map((m) => m.namespace));
    const reserved = PROTOCOL_NAMESPACE_ALLOWLIST.filter((ns) => !modNamespaces.has(ns));
    for (const ns of reserved) {
      expect(isKnownProtocolNamespace(ns)).toBe(true);
      // Reserved namespaces have no manifests, so count is 0 — not a crash.
      // We don't assert a specific number here because navigation state can
      // change; we just assert the helper is callable.
      expect(NAMESPACE_DEFAULTS[ns]).toBeDefined();
    }
  });
});
