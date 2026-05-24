/**
 * Shared vi.mock setup for dispatcher test files.
 *
 * Imported as a side-effect by each dispatcher-*.test.ts file
 * BEFORE any dynamic import of the dispatcher module so that
 * vi.mock registrations are in effect when the dispatcher loads
 * its lazy-imported handlers.
 *
 * Mock spies are exported by name so individual tests can override
 * resolved values, assert call args, or clear between cases.
 */

import { vi } from "vitest";

vi.mock("@tools/wallet/multi-auth.js", () => ({
  requireEvmWallet: () => ({
    family: "eip155",
    address: "0x1234567890abcdef1234567890abcdef12345678",
    privateKey: `0x${"ab".repeat(32)}`,
  }),
  requireSolanaWallet: () => ({
    family: "solana",
    address: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
    secretKey: new Uint8Array(64),
  }),
}));

// Phase 5B: wallet_read / send / khalani read resolve through the engine
// resolver (resolve.ts), not the zero-arg multi-auth primitives. Mock that
// boundary so dispatcher routing tests get the test wallet addresses.
vi.mock("../../../vex-agent/tools/internal/wallet/resolve.js", () => ({
  resolveSelectedAddress: (_r: unknown, _p: unknown, family: string) =>
    family === "solana"
      ? "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM"
      : "0x1234567890abcdef1234567890abcdef12345678",
  resolveSigningWallet: (_r: unknown, _p: unknown, family: string) =>
    family === "solana"
      ? { family: "solana", address: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM", secretKey: new Uint8Array(64) }
      : { family: "eip155", address: "0x1234567890abcdef1234567890abcdef12345678", privateKey: `0x${"ab".repeat(32)}` },
  walletScopeErrorToResult: (err: unknown) => { throw err; },
}));

vi.mock("@tools/wallet/family.js", () => ({
  normalizeWalletChain: (input?: string) => {
    if (!input || input === "eip155" || input === "evm") return "eip155";
    if (input === "solana" || input === "sol") return "solana";
    throw new Error(`Unsupported wallet chain: ${input}`);
  },
}));

const KHALANI_TEST_CHAINS = [
  { id: 1, name: "Ethereum", type: "eip155" as const, nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 } },
  { id: 20011000000, name: "Solana", type: "solana" as const, nativeCurrency: { name: "Solana", symbol: "SOL", decimals: 9 } },
];

vi.mock("@tools/khalani/client.js", () => ({
  getKhalaniClient: () => ({
    getChains: vi.fn().mockResolvedValue(KHALANI_TEST_CHAINS),
    getTopTokens: vi.fn().mockResolvedValue([]),
    searchTokens: vi.fn().mockResolvedValue({ data: [] }),
    getTokenBalances: vi.fn().mockImplementation(async (_address: string, chainIds?: number[]) => {
      const chainId = chainIds?.[0] ?? 1;
      return [
        {
          address: chainId === 20011000000 ? "So11111111111111111111111111111111111111112" : "native",
          chainId,
          symbol: chainId === 20011000000 ? "SOL" : "ETH",
          name: chainId === 20011000000 ? "Solana" : "Ether",
          decimals: chainId === 20011000000 ? 9 : 18,
          extensions: { balance: "1000000000", price: { usd: "1.0" } },
        },
      ];
    }),
  }),
}));

// Mock vex-agent DB repos (no real DB in unit tests)
vi.mock("@vex-agent/db/repos/search.js", () => ({
  getCached: vi.fn().mockResolvedValue(null),
  cacheResult: vi.fn().mockResolvedValue(undefined),
  getCachedFetch: vi.fn().mockResolvedValue(null),
  cacheFetchResult: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@vex-agent/db/repos/documents.js", () => ({
  getDocument: vi.fn().mockResolvedValue(null),
  upsertDocument: vi.fn().mockResolvedValue({ id: 1, space: "notes", folderId: null, title: "test", slug: "test", contentMd: "content", sizeBytes: 7, createdAt: "2024-01-01", updatedAt: "2024-01-01" }),
  listDocuments: vi.fn().mockResolvedValue([]),
  softDeleteDocument: vi.fn().mockResolvedValue(true),
  countDocuments: vi.fn().mockResolvedValue(1),
}));

vi.mock("@vex-agent/db/repos/folders.js", () => ({
  getFolderBySlug: vi.fn().mockResolvedValue(null),
  createFolder: vi.fn().mockResolvedValue({ id: 1, space: "notes", parentId: null, name: "test", slug: "test", createdAt: "2024-01-01" }),
  listFolders: vi.fn().mockResolvedValue([]),
  deleteFolder: vi.fn().mockResolvedValue(true),
}));

export const mockKnowledgeInsert = vi.fn().mockResolvedValue({
  entry: {
    id: 42, kind: "memo", title: "test", summary: "test", contentMd: "test",
    tags: [], sourceRefs: {}, confidence: null, status: "active", pinned: false,
    validFrom: "2026-04-06T12:00:00Z", validUntil: "2026-04-13T12:00:00Z",
    contentHash: "f".repeat(64),
    embeddingModel: "ai/embeddinggemma:300M-Q8_0", embeddingDim: 768,
    sourceSurface: "vex_agent", sourceSession: null,
    supersedesId: null, statusReason: null, changeSummary: null, whatFailed: null,
    createdAt: "2026-04-06T12:00:00Z", updatedAt: "2026-04-06T12:00:00Z",
  },
  inserted: true,
});
// Default: short-circuit lookup misses (no duplicate). Tests that need
// the duplicate path override this.
export const mockKnowledgeFindByContentHash = vi.fn().mockResolvedValue(null);
export const mockKnowledgeGetById = vi.fn().mockResolvedValue(null);
export const mockKnowledgeUpdateStatus = vi.fn().mockResolvedValue({ ok: true });
export const mockKnowledgeRecallTopK = vi.fn().mockResolvedValue([]);
export const mockKnowledgeListActive = vi.fn().mockResolvedValue([]);
export const mockKnowledgeListKinds = vi.fn().mockResolvedValue([]);
export const mockKnowledgeGetLineageChain = vi.fn().mockResolvedValue(null);
export const mockKnowledgeListHistory = vi.fn().mockResolvedValue([]);

vi.mock("@vex-agent/db/repos/knowledge.js", () => ({
  insertEntry: (...args: unknown[]) => mockKnowledgeInsert(...args),
  findByContentHash: (...args: unknown[]) => mockKnowledgeFindByContentHash(...args),
  getById: (...args: unknown[]) => mockKnowledgeGetById(...args),
  updateStatus: (...args: unknown[]) => mockKnowledgeUpdateStatus(...args),
  recallTopK: (...args: unknown[]) => mockKnowledgeRecallTopK(...args),
  listActiveForHotContext: (...args: unknown[]) => mockKnowledgeListActive(...args),
  listKnownKinds: (...args: unknown[]) => mockKnowledgeListKinds(...args),
  getLineageChain: (...args: unknown[]) => mockKnowledgeGetLineageChain(...args),
  listHistory: (...args: unknown[]) => mockKnowledgeListHistory(...args),
}));

// knowledge_supersede repo — lazy-imported by the handler. Tests override
// mockKnowledgeSupersede's resolved value to assert routing / param passing.
export const mockKnowledgeSupersede = vi.fn().mockResolvedValue({
  successor: {
    id: 43, kind: "memo", title: "new", summary: "new", contentMd: "new",
    tags: [], sourceRefs: {}, confidence: null, status: "active", pinned: false,
    validFrom: "2026-04-06T12:00:00Z", validUntil: "2026-04-13T12:00:00Z",
    contentHash: "b".repeat(64),
    embeddingModel: "ai/embeddinggemma:300M-Q8_0", embeddingDim: 768,
    sourceSurface: "vex_agent", sourceSession: null,
    supersedesId: 42, statusReason: null,
    changeSummary: null, whatFailed: null,
    createdAt: "2026-04-06T12:00:00Z", updatedAt: "2026-04-06T12:00:00Z",
  },
  predecessor: {
    id: 42, kind: "memo", title: "old", summary: "old", contentMd: "old",
    tags: [], sourceRefs: {}, confidence: null, status: "superseded", pinned: false,
    validFrom: "2026-04-01T00:00:00Z", validUntil: null,
    contentHash: "a".repeat(64),
    embeddingModel: "ai/embeddinggemma:300M-Q8_0", embeddingDim: 768,
    sourceSurface: "vex_agent", sourceSession: null,
    supersedesId: null, statusReason: "reason",
    changeSummary: null, whatFailed: null,
    createdAt: "2026-04-01T00:00:00Z", updatedAt: "2026-04-06T12:00:00Z",
  },
});

vi.mock("@vex-agent/db/repos/knowledge-lifecycle.js", async () => {
  // Keep SupersedeError as the real class so handler `instanceof` checks still work.
  const actual = await vi.importActual<typeof import("@vex-agent/db/repos/knowledge-lifecycle.js")>(
    "@vex-agent/db/repos/knowledge-lifecycle.js",
  );
  return {
    ...actual,
    supersedeEntry: (...args: unknown[]) => mockKnowledgeSupersede(...args),
  };
});

export const mockCacheWrite = vi.fn().mockResolvedValue({ cacheKey: "rcl-test", expiresAt: "2026-04-06T12:15:00Z" });
export const mockCacheRead = vi.fn().mockResolvedValue(null);
export const mockCacheCleanup = vi.fn().mockResolvedValue(0);

export const mockGenerateCacheKey = vi.fn((..._args: unknown[]) => "rcl-test");

vi.mock("@vex-agent/db/repos/recall-cache.js", () => ({
  writeCache: (...args: unknown[]) => mockCacheWrite(...args),
  readCache: (...args: unknown[]) => mockCacheRead(...args),
  cleanupExpired: (...args: unknown[]) => mockCacheCleanup(...args),
  generateCacheKey: (...args: unknown[]) => mockGenerateCacheKey(...args),
}));

export const TEST_EMBEDDING = Array.from({ length: 768 }, () => 0.1);
export const TEST_PROVIDER_MODEL = "ai/embeddinggemma:300M-Q8_0";
export const mockEmbedDocument = vi.fn().mockResolvedValue({
  embedding: TEST_EMBEDDING,
  providerModel: TEST_PROVIDER_MODEL,
});
export const mockEmbedQuery = vi.fn().mockResolvedValue({
  embedding: TEST_EMBEDDING,
  providerModel: TEST_PROVIDER_MODEL,
});

vi.mock("@vex-agent/embeddings/client.js", () => ({
  embedDocument: (...args: unknown[]) => mockEmbedDocument(...args),
  embedQuery: (...args: unknown[]) => mockEmbedQuery(...args),
  formatDocumentInput: (t: string, s: string) => `title: ${t} | text: ${s}`,
  formatQueryInput: (q: string) => `task: search result | query: ${q}`,
}));

vi.mock("@vex-agent/embeddings/config.js", () => ({
  loadEmbeddingConfig: () => ({
    baseUrl: "http://localhost:12434/engines/llama.cpp/v1",
    model: "ai/embeddinggemma:300M-Q8_0",
    dim: 768,
    provider: "local",
  }),
  MIN_EMBEDDING_DIM: 1,
  MAX_EMBEDDING_DIM: 8192,
}));

// knowledge_write / knowledge_supersede now run under the maintenance lease
// gate. Dispatcher routing tests only care about handler wiring, so keep the
// lease layer as a pass-through and avoid touching a real pool.
vi.mock("@vex-agent/db/repos/maintenance-lease.js", () => ({
  withLeaseSharedLock: async <T>(
    _pool: unknown,
    fn: (tx: unknown) => Promise<T>,
  ): Promise<T> => fn({ query: () => ({ rows: [], rowCount: 0 }) }),
  MaintenanceActiveError: class MaintenanceActiveError extends Error {
    readonly code = "MAINTENANCE_ACTIVE" as const;
    readonly ownerId: string;
    constructor(ownerId: string) {
      super(`maintenance active — lease held by "${ownerId}"`);
      this.name = "MaintenanceActiveError";
      this.ownerId = ownerId;
    }
  },
  acquireReembedLease: vi.fn(),
  releaseReembedLease: vi.fn(),
  inspectLease: vi.fn(),
}));

vi.mock("@vex-agent/db/client.js", () => ({
  getPool: () => ({ connect: async () => ({ query: vi.fn(), release: vi.fn() }) }),
  query: vi.fn(),
  queryOne: vi.fn(),
  execute: vi.fn(),
}));

vi.mock("@vex-agent/db/repos/subagents.js", () => ({
  insert: vi.fn().mockResolvedValue(undefined),
  getById: vi.fn().mockResolvedValue(null),
  getActive: vi.fn().mockResolvedValue([]),
  getRecent: vi.fn().mockResolvedValue([]),
  updateStatus: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@vex-agent/db/repos/sessions.js", () => ({
  createSession: vi.fn().mockResolvedValue(undefined),
  setScope: vi.fn().mockResolvedValue(undefined),
  getSession: vi.fn().mockResolvedValue(null),
}));

vi.mock("@vex-agent/db/repos/session-links.js", () => ({
  linkSessions: vi.fn().mockResolvedValue({ id: 1 }),
}));

vi.mock("@vex-agent/db/repos/executions.js", () => ({
  recordExecution: vi.fn().mockResolvedValue(1),
}));

vi.mock("@vex-agent/db/repos/sync.js", () => ({
  getJobsForNamespace: vi.fn().mockResolvedValue([]),
  enqueueRun: vi.fn().mockResolvedValue(1),
}));
