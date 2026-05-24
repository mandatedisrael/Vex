/**
 * Signer-import allowlist regression (puzzle 5 phase 5B).
 *
 * Pins the per-session wallet invariant at the source level:
 *   1. Only the un-migrated protocol signer files may import the zero-arg
 *      `requireEvmWallet/requireSolanaWallet/requireWalletForChain` primitives
 *      (which resolve the PRIMARY wallet, bypassing session scope). The runtime
 *      deny-guard blocks them under `source:"session"`; this test prevents a
 *      migrated tool (or a new tool) from silently re-introducing primary
 *      signing. The allowlist shrinks as 5D-protocols migrates each.
 *   2. The protocol manifest actionKind census stays within
 *      {read, user_wallet_broadcast, external_post}. The deny-guard covers the
 *      two signing kinds; a NEW signing kind would slip past it, so its
 *      appearance must force a deny-guard review (this test fails).
 */

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const TOOLS_DIR = join(process.cwd(), "src/vex-agent/tools");
const SIGNER_RE = /\b(requireEvmWallet|requireSolanaWallet|requireWalletForChain)\b/;

// Un-migrated protocol signers, hard-denied under source:"session" by the
// runtime guard. Paths relative to src/vex-agent/tools.
const ALLOWLIST = new Set([
  "protocols/kyberswap/handlers/swap.ts",
  "protocols/kyberswap/handlers/zap.ts",
  "protocols/kyberswap/handlers/limit-order.ts",
  "protocols/polymarket/handlers-clob.ts",
  "protocols/solana-jupiter/handlers/core.ts",
]);

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      out.push(...walk(full));
    } else if (name.endsWith(".ts") && !name.endsWith(".test.ts")) {
      out.push(full);
    }
  }
  return out;
}

function importsSigner(src: string): boolean {
  return src.split("\n").some((line) => {
    const t = line.trim();
    return t.startsWith("import") && SIGNER_RE.test(t);
  });
}

describe("signer import allowlist", () => {
  it("only allowlisted protocol files import zero-arg signer primitives", () => {
    const offenders: string[] = [];
    for (const file of walk(TOOLS_DIR)) {
      const rel = file.slice(TOOLS_DIR.length + 1).split("\\").join("/");
      if (importsSigner(readFileSync(file, "utf-8")) && !ALLOWLIST.has(rel)) {
        offenders.push(rel);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("migrated wallet tools no longer import signer primitives", () => {
    const migrated = [
      "internal/wallet/read.ts",
      "internal/wallet/send.ts",
      "internal/wallet/send-execute-evm.ts",
      "internal/wallet/send-execute-solana.ts",
      "protocols/khalani/handlers/read.ts",
    ];
    for (const rel of migrated) {
      const src = readFileSync(join(TOOLS_DIR, rel), "utf-8");
      expect({ rel, imports: importsSigner(src) }).toEqual({ rel, imports: false });
    }
  });

  it("protocol manifest actionKinds stay within the deny-covered census", () => {
    const allowedKinds = new Set(["read", "user_wallet_broadcast", "external_post"]);
    const seen = new Set<string>();
    for (const file of walk(join(TOOLS_DIR, "protocols"))) {
      const src = readFileSync(file, "utf-8");
      for (const m of src.matchAll(/actionKind:\s*"([a-z_]+)"/g)) {
        seen.add(m[1]);
      }
    }
    const outside = [...seen].filter((k) => !allowedKinds.has(k));
    // A new signing-capable actionKind outside {user_wallet_broadcast,
    // external_post} would bypass the runtime deny-guard — review it there.
    expect(outside).toEqual([]);
  });
});
