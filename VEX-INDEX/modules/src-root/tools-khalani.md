---
id: module.src-root.tools-khalani
kind: module
paths:
  - "src/tools/khalani/**"
source_commit: dee0d08
indexed_at: 2026-05-28
stale_when_paths_change:
  - "src/tools/khalani/**"
  - "src/tools/wallet/multi-auth.ts"
  - "src/config/store.ts"
  - "src/errors.ts"
  - "src/utils/http.ts"
  - "src/vex-agent/tools/protocols/khalani/**"
  - "src/vex-agent/tools/registry/khalani.ts"
  - "src/vex-agent/tools/internal/khalani.ts"
related:
  - module.vex-agent.tools-protocols
  - module.vex-agent.tools-internal
  - module.src-root.lib-wallet
---

# module.src-root.tools-khalani — Khalani Cross-Chain Bridge Client

## Purpose

This module is the **Z5 protocol client layer** for the Khalani HyperStream
cross-chain bridge. It provides all HTTP communication, response validation,
chain/token discovery, balance scanning, quote request preparation, deposit plan
execution (EVM and Solana), and typed error mapping for the Khalani API
(`https://api.hyperstream.dev`). The module is consumed by three distinct
callsites: the protocol tool handlers in
`src/vex-agent/tools/protocols/khalani/` (engine bridge), the sync/balance
infrastructure in `src/vex-agent/sync/`, and scattered read-side internal tool
handlers (`evm_read`, `wallet_read`, `wallet_resolve`).

The module does **not** own tool registration or manifest logic. It is a pure
protocol client + execution layer. All tool definitions, approval gating,
capture, and LLM visibility are managed by the vex-agent protocol layer above
it (see Related modules).

## Retrieval keywords

- khalani, hyperstream, cross-chain bridge, intent bridge, solver protocol
- KhalaniClient, getKhalaniClient, bridge executor
- getCachedKhalaniChains, resolveChainId, CHAIN_ALIASES
- getTokenBalancesAcrossChains, BalanceChainSelection
- executeDepositPlan, executeEvmContractCallPlan, executeSolanaContractCallPlan, executeTransferPlan
- signSolanaTransaction, signAndSendSolanaTransaction
- createDynamicWalletClient, createDynamicPublicClient, toViemChain
- prepareQuoteRequest, PreparedQuoteRequest, QuoteRequestInput
- mapKhalaniError, KHALANI_API_ERROR, KHALANI_QUOTE_EXPIRED, KHALANI_BROADCAST_FAILED
- DepositPlan, CONTRACT_CALL, PERMIT2, TRANSFER, ContractCallDepositPlan, TransferDepositPlan
- KhalaniChain, KhalaniToken, KhalaniOrder, QuoteRequest, QuoteResponse, QuoteRoute
- ChainFamily, eip155, solana, ChainWallet, EvmWallet, SolanaWallet
- PERMIT2 blocked, Solana TRANSFER blocked

## State owned

- **In-process singleton** (`client.ts:279`): `cachedClient` + `cachedBaseUrl` — reset when
  `config.services.khalaniApiUrl` changes across calls to `getKhalaniClient()`.
- **In-process chain cache** (`chains.ts:67`): `cachedChains` + `cachedAt` —
  24-hour TTL (`CHAIN_CACHE_TTL_MS = 86_400_000 ms`). Cleared with
  `clearKhalaniChainsCache()`. Stale if process restarts (no persistence).
- No DB state owned. No env secrets required (API is open, rate-limited).

## Boundary crossings

| Direction | Boundary |
|-----------|----------|
| Network (outbound) | Khalani HyperStream REST API (`config.services.khalaniApiUrl`); `fetchWithTimeout` with implicit HTTP timeout; no auth header |
| Network (outbound) | NDJSON stream for `streamQuotes` via ReadableStream reader |
| External EVM RPC (outbound) | `createDynamicWalletClient` / `createDynamicPublicClient` via viem `http()` transport; RPC URL from Khalani chain metadata; timeout 30s, retry 2 |
| External Solana RPC (outbound) | `@solana/web3.js Connection`; RPC URL from Khalani chain metadata; `sendRawTransaction` + `confirmTransaction("confirmed")` |
| Signing (EVM) | `privateKeyToAccount(wallet.privateKey)` from `ChainWallet.privateKey: Hex`; key is passed in from `resolveSigningWallet` (Z3 caller); this layer consumes the decrypted key but does not decrypt it |
| Signing (Solana) | `Keypair.fromSecretKey(wallet.secretKey)` from `ChainWallet.secretKey: Uint8Array`; same — key decrypted by caller |
| Config | `loadConfig()` (`src/config/store.ts`) — reads `services.khalaniApiUrl`; called inside `getKhalaniClient()` on each cold/URL-change call |
| Wallet inventory (read-only) | `helpers.ts` imports `getPrimaryEvmAddress`/`getPrimarySolanaAddress` from `src/tools/wallet/inventory.ts` for CLI/fallback address resolution (not used in agent bridge path — agent uses `resolveSelectedAddress` instead) |

## File map

- `src/tools/khalani/types.ts:1` — All domain interfaces: `ChainFamily`, `TradeType`, `DepositMethod`, `OrderStatus`, `KhalaniChain`, `KhalaniToken`, `TokenSearchResponse`, `AutocompleteResponse`, `QuoteRequest`, `QuoteRoute`, `QuoteStreamRoute`, `QuoteResponse`, `DepositBuildRequest`, `EvmApproval`, `SolanaApproval`, `Approval`, `ContractCallDepositPlan`, `Permit2DepositPlan`, `TransferDepositPlan`, `DepositPlan`, `SubmitRequest`, `SubmitResponse`, `KhalaniOrder`, `KhalaniErrorBody`. No Zod; these are interface contracts over validated-then-typed API responses.
- `src/tools/khalani/validation.ts:1` — Manual runtime validators for every API response shape (`unknown` → typed). Entry points: `validateChainsResponse`, `validateTokensResponse`, `validateTokenSearchResponse`, `validateAutocompleteResponse`, `validateQuoteResponse`, `validateQuoteStreamRoute`, `validateDepositPlan`, `validateSubmitResponse`, `validateOrdersResponse`, `validateOrderResponse`, `parseKhalaniErrorBody`. All throw `VexError(KHALANI_API_ERROR)` on shape mismatch. Notable: `parseNativeCurrencyName` has a quirk — Khalani `/v1/chains` can omit `nativeCurrency.name` for Solana even though docs say required; falls back to `symbol` silently.
- `src/tools/khalani/errors.ts:1` — `mapKhalaniError(status, body)`: maps HTTP status + Khalani exception name → typed `VexError` with `retryable` flag and `externalName`. 14 named exception cases + HTTP 429 + HTTP 5xx default. Retryable: `KHALANI_RATE_LIMITED`, `QuoteNotFoundException`, `InternalErrorException`, HTTP 5xx. Non-retryable: all others.
- `src/tools/khalani/client.ts:53` `KhalaniClient` — typed HTTP client; `getKhalaniClient()` singleton via URL-keyed cache. Methods: `getChains()`, `getTopTokens(chainIds?)`, `searchTokens(query, chainIds?)`, `autocompleteToken(keyword, opts?)`, `getTokenBalances(address, chainIds?)`, `getQuotes(request, opts?)`, `streamQuotes(request, opts?)` (NDJSON async generator), `buildDeposit(request)`, `submitDeposit(request)`, `getOrders(address, opts?)`, `getOrderById(orderId)`, `getChainIconUrl(chainId)`. Private `request<T>()` helper applies validator, maps errors.
  - `client.ts:279` `cachedClient`, `cachedBaseUrl` — URL-change invalidation (NOT TTL-based).
  - `client.ts:151` `streamQuotes` — NDJSON streaming; line-buffered; each line independently validated via `validateQuoteStreamRoute`; trailing non-newline buffer flushed on `done`.
- `src/tools/khalani/chains.ts:1` — Chain resolution and cache.
  - `:5` `CHAIN_ALIASES` — 40+ static name → chainId map (eth, sol, arb, base, op, polygon, etc.).
  - `:65` `CHAIN_CACHE_TTL_MS = 86_400_000` — 24h; `cachedChains`, `cachedAt`.
  - `:78` `getCachedKhalaniChains(forceRefresh?)` — returns cached or fresh `KhalaniChain[]`.
  - `:88` `clearKhalaniChainsCache()` — test/reset helper.
  - `:93` `resolveChainId(input, chains?)` — alias lookup → numeric → live-chain fuzzy slug match (`slugify`). Throws `KHALANI_UNSUPPORTED_CHAIN` if unresolved.
  - `:122` `getChain(chainId, chains)` — array lookup; throws `KHALANI_UNSUPPORTED_CHAIN` if not found.
  - `:134` `getChainFamily(chainId, chains)` — returns `ChainFamily` via `getChain`.
  - `:138` `getChainRpcUrl(chainId, chains)` — returns RPC URL string or throws `KHALANI_UNSUPPORTED_CHAIN`.
  - `:149` `getChainExplorerUrl(chainId, chains)` — returns optional explorer URL.
- `src/tools/khalani/evm-client.ts:1` — Dynamic viem client factory.
  - `:7` `EVM_RPC_TIMEOUT_MS = 30_000`, `EVM_RPC_RETRY_COUNT = 2`.
  - `:26` `createDynamicWalletClient(chain, chains, privateKey)` — viem `WalletClient`; account from `privateKeyToAccount(privateKey)`.
  - `:35` `createDynamicPublicClient(chain, chains)` — viem `PublicClient` (no key).
  - Both derive RPC URL from `getChainRpcUrl`; convert `KhalaniChain` → viem `Chain` via `toViemChain`.
- `src/tools/khalani/solana-signer.ts:5` `signSolanaTransaction(secretKey, base64Tx)` — pure sign: deserialize `VersionedTransaction`, sign with `Keypair.fromSecretKey(secretKey)`, return base64. Throws `KHALANI_SOLANA_SIGN_FAILED` on any error.
  - `:20` `signAndSendSolanaTransaction(rpcUrl, secretKey, base64Tx)` — sign + broadcast: `Connection.sendRawTransaction` → `confirmTransaction("confirmed")`. Throws `KHALANI_BROADCAST_FAILED` (or re-throws `VexError` from sign step).
- `src/tools/khalani/bridge-executor.ts:36` `parseBigintish(value, field)` — coerce `unknown` → `bigint`; used for EVM tx params. Throws `KHALANI_DEPOSIT_FAILED` on parse error.
  - `:69` `assertEvmApproval` / `:78` `assertSolanaApproval` — type assertion helpers with `VexError` throws.
  - `:87` `isNativeTransferToken(token)` — true for `"native"`, `0x000...000`, `0xeee...eee`.
  - `:94` `executeEvmApproval(approval, chain, chains, privateKey, expectedAddress)` — process a single `EvmApproval`: `wallet_switchEthereumChain` → validate chain ID + return null; `eth_sendTransaction` → `walletClient.sendTransaction` → optional `waitForTransactionReceipt`. Validates `from` field if present. Returns `Hash | null`.
  - `:165` `executeEvmContractCallPlan(plan, chain, chains, quoteId, routeId, signer)` — iterate `plan.approvals`, assert EVM, execute each; capture first hash where `deposit:true`; `submitDeposit`. Throws `KHALANI_DEPOSIT_FAILED` if no deposit action or no deposit hash.
  - `:203` `executeSolanaContractCallPlan(plan, chain, chains, quoteId, routeId, signer)` — iterate approvals, assert Solana, `signAndSendSolanaTransaction` per approval; capture signature where `deposit:true`; `submitDeposit`.
  - `:240` `executeTransferPlan(plan, chain, chains, quoteId, routeId, signer)` — EVM-only TRANSFER: native via `sendTransaction`; ERC20 via `writeContract(ERC20_ABI, "transfer")`; wait for receipt; `submitDeposit`. Solana TRANSFER throws `KHALANI_DEPOSIT_FAILED` immediately (not implemented).
  - `:284` `ExecuteDepositPlanArgs` interface — `plan`, `sourceChain`, `chains`, `quoteId`, `routeId`, `signer: ChainWallet`.
  - `:294` `executeDepositPlan(args)` — dispatch: PERMIT2 → throw `KHALANI_PERMIT2_BLOCKED`; TRANSFER → `executeTransferPlan`; CONTRACT_CALL → `executeSolanaContractCallPlan` or `executeEvmContractCallPlan` by `sourceChain.type`.
- `src/tools/khalani/balances.ts:8` — Multi-chain balance scanning.
  - `:29` `parseBalanceChainSelection(raw?)` — parse comma-separated chain identifiers → `BalanceChainSelection{rawProvided, byFamily: Map<ChainFamily, number[]>}`.
  - `:60` `getSelectedChainIdsForFamily(selection, family)` — returns chain IDs for family or `undefined` (scan all).
  - `:68` `getTokenBalancesAcrossChains({address, family, chainIds?, concurrency?})` — fan-out with configurable concurrency (default 4) via `mapWithConcurrency`; per-chain errors captured in `chainErrors` (partial success allowed); throws only if ALL chains fail; sorts by USD value descending; returns `TokenBalanceScanResult`.
  - `:157` `mapWithConcurrency<T>(values, concurrency, worker)` — worker-pool async concurrency limiter (plain closure, no external dep).
  - `:179` `calculateTokensTotalUsd(tokens)` — `balance * priceUsd` per token, guard on `isFinite`, sum.
- `src/tools/khalani/helpers.ts:14` — Pure domain helpers (mostly used by CLI/command layer).
  - `formatChainFamily`, `normalizeAddressForFamily`, `resolveConfiguredAddress` (reads `loadConfig()` → primary wallet from inventory), `parseChainIdsOption`, `resolveRouteBestIndex` (primary: max `amountOut`; tiebreaker: min `expectedDurationSeconds`).
- `src/tools/khalani/request.ts:11` — Quote request preparation (chain resolution + address normalization + amount parsing).
  - `:36` `resolveQuoteAddress(input?, family, fallbackRole)` — resolves from config if not given; throws `WALLET_NOT_CONFIGURED` if neither available.
  - `:53` `parseTradeType`, `:57` `parseReferrerFeeBps` (0–9999 integer), `:66` `parseAmountInSmallestUnits` (decimal or `0x` hex → positive decimal string).
  - `:85` `prepareQuoteRequest(input)` — resolves chains, chainIds, families, addresses, normalizes; returns `PreparedQuoteRequest{chains, fromChainId, toChainId, fromFamily, toFamily, request: QuoteRequest}`.
- `src/tools/khalani/Khalani.md` — inline human/LLM reference doc for commands and API surface (stale: last updated 2026-03-30, references `src/commands/khalani/` which is NOT the in-scope agent path).

## Key types & invariants

- `ChainFamily` (`types.ts:1`) — `"eip155" | "solana"`. All per-chain dispatch branches on this.
- `DepositPlan` (`types.ts:158`) — discriminated union on `kind`: `"CONTRACT_CALL" | "PERMIT2" | "TRANSFER"`. All executor dispatch branches on `plan.kind`.
- `Approval` (`types.ts:135`) — `EvmApproval | SolanaApproval`; discriminated on `approval.type`.
- `ChainWallet` (from `src/tools/wallet/multi-auth.ts:30`) — `EvmWallet | SolanaWallet`; discriminated on `family`. The signing path reads `wallet.privateKey: Hex` (EVM) or `wallet.secretKey: Uint8Array` (Solana). The module does NOT decrypt the key — callers must pass an already-decrypted `ChainWallet`.
- `KhalaniErrorBody` (`types.ts:225`) — `{message, name, details?}`; `name` drives error code mapping in `mapKhalaniError`.
- **PERMIT2 blocked invariant**: `executeDepositPlan` always throws `KHALANI_PERMIT2_BLOCKED` for `plan.kind === "PERMIT2"`. This is documented and intentional for v1 — not a bug.
- **Solana TRANSFER blocked invariant**: `executeTransferPlan` throws `KHALANI_DEPOSIT_FAILED` immediately when `chain.type !== "eip155"`. Solana TRANSFER deposits are not implemented.
- **`deposit: true` flag invariant**: Both `executeEvmContractCallPlan` and `executeSolanaContractCallPlan` require at least one approval with `deposit: true` and a non-null hash/signature from it. Missing either condition throws `KHALANI_DEPOSIT_FAILED`. This enforces that the caller cannot accidentally omit the submit step.
- **`from` address validation** (`bridge-executor.ts:133`): If the Khalani API provides a `txRequest.from` field, it is asserted against `expectedAddress` (`getAddress(txRequest.from) !== expectedAddress`) before signing. Mismatch → `KHALANI_ADDRESS_MISMATCH` throw (pre-broadcast; no on-chain effect).
- **Chain cache TTL**: 24 hours in-process. No persistent cross-restart caching. A cold process always fetches live chains on first call.
- **Error fingerprinting**: `solana-signer.ts` errors are typed `VexError(KHALANI_SOLANA_SIGN_FAILED | KHALANI_BROADCAST_FAILED)`. Raw error `.message` is included in the hint. **Note**: unlike `wallet_send_confirm` which uses SHA-256 fingerprinting (`summarizeWalletError`), this module surfaces raw error messages in VexError — these could leak chain-side details. Callers above (bridge handler) catch and serialize the whole `VexError.message` into `ToolResult.output`. See Open questions #1.
- **No approval gate in this module**: Approval gating, capture, and restriction enforcement are entirely the responsibility of the caller (vex-agent protocol runtime at `executeProtocolTool`). This module executes blindly once called with a `ChainWallet`.

## Capabilities (stable IDs)

- **CAP-khalani-bridge-evm-contract-call**: Execute an EVM CONTRACT_CALL deposit plan: iterate approvals (approve + deposit tx), capture deposit hash, submit to Khalani — `src/tools/khalani/bridge-executor.ts:165 executeEvmContractCallPlan`
- **CAP-khalani-bridge-solana-contract-call**: Execute a Solana CONTRACT_CALL deposit plan: sign + broadcast each approval, capture deposit signature, submit to Khalani — `src/tools/khalani/bridge-executor.ts:203 executeSolanaContractCallPlan`
- **CAP-khalani-bridge-evm-transfer**: Execute an EVM TRANSFER deposit plan: native or ERC-20 direct transfer to deposit address, wait for receipt, submit to Khalani — `src/tools/khalani/bridge-executor.ts:240 executeTransferPlan`
- **CAP-khalani-bridge-dispatch**: Top-level deposit plan dispatcher; routes by plan.kind; blocks PERMIT2; handles Solana/EVM routing — `src/tools/khalani/bridge-executor.ts:294 executeDepositPlan`
- **CAP-khalani-bridge-solana-sign**: Sign and optionally broadcast a Solana VersionedTransaction (base64) using a raw secret key — `src/tools/khalani/solana-signer.ts:5 signSolanaTransaction` / `:20 signAndSendSolanaTransaction`
- **CAP-khalani-read-chains**: Fetch + cache Khalani-supported chains (40+ EVM + Solana); chain alias resolution; RPC URL lookup — `src/tools/khalani/chains.ts:78 getCachedKhalaniChains`
- **CAP-khalani-read-chain-resolve**: Resolve chain name/alias/number → chainId; fuzzy slug fallback against live list — `src/tools/khalani/chains.ts:93 resolveChainId`
- **CAP-khalani-read-balances**: Fan-out token balance scan across all chains for one wallet family; partial success with per-chain errors; USD sorting — `src/tools/khalani/balances.ts:68 getTokenBalancesAcrossChains`
- **CAP-khalani-read-quotes**: Build and submit `QuoteRequest`; stream NDJSON quotes; select best route — `src/tools/khalani/client.ts:139 getQuotes` / `:151 streamQuotes`; `src/tools/khalani/request.ts:85 prepareQuoteRequest`; `src/tools/khalani/helpers.ts:47 resolveRouteBestIndex`
- **CAP-khalani-read-tokens**: Search, autocomplete, and list top tokens — `src/tools/khalani/client.ts:105 searchTokens` / `:118 autocompleteToken` / `:97 getTopTokens`
- **CAP-khalani-read-orders**: List and fetch Khalani bridge orders — `src/tools/khalani/client.ts:243 getOrders` / `:270 getOrderById`
- **CAP-khalani-evm-client**: Dynamic viem wallet/public client from Khalani chain metadata — `src/tools/khalani/evm-client.ts:26 createDynamicWalletClient` / `:35 createDynamicPublicClient`

## Public API (consumed by)

### Engine layer (Z3 — protocol handlers)

| Consumer | Import | Usage |
|----------|--------|-------|
| `src/vex-agent/tools/protocols/khalani/handlers/bridge.ts` | `client`, `chains`, `helpers`, `request`, `bridge-executor`, `types` | Full bridge execution: resolves session wallet, calls `prepareQuoteRequest`, `getQuotes`, `buildDeposit`, `executeDepositPlan` |
| `src/vex-agent/tools/protocols/khalani/handlers/read.ts` | `client`, `chains`, `balances`, `request`, `types` | All 8 read handlers: chains, tokens, autocomplete, balances, quote, orders |

### Engine layer (Z3 — internal tools)

| Consumer | Import | Usage |
|----------|--------|-------|
| `src/vex-agent/tools/internal/wallet/read.ts` | `balances`, `types` | `getTokenBalancesAcrossChains` for `wallet_read` tool balance scan |
| `src/vex-agent/tools/internal/wallet/resolve.ts` | `types` | `ChainFamily` type import only |
| `src/vex-agent/tools/internal/evm-read.ts` | `client`, `chains`, `evm-client` | `evm_read` tool: chain lookup + public client for read calls (balance, ERC20 metadata, tx receipts) |

### Engine layer (Z4 — sync)

| Consumer | Import | Usage |
|----------|--------|-------|
| `src/vex-agent/sync/chains.ts` | `chains`, `types` | `getCachedKhalaniChains`, `resolveChainId`, `ChainFamily` — chain normalization for portfolio projections |
| `src/vex-agent/sync/balance-sync.ts` | `balances`, `types` | `getTokenBalancesAcrossChains`, `KhalaniToken`, `ChainFamily` — balance sync jobs |
| `src/vex-agent/sync/portfolio-chain-map.ts` | `chains`, `types` | `CHAIN_ALIASES`, `getCachedKhalaniChains`, `KhalaniChain` — portfolio chain mapping |
| `src/vex-agent/sync/worker.ts` | `types` | `ChainFamily` type import only |

### Registry layer (Z3)

| Consumer | Import | Usage |
|----------|--------|-------|
| `src/vex-agent/tools/registry/khalani.ts` | (indirect via manifest) | Validates that `KHALANI_INTERNAL_TO_PROTOCOL` entries map to non-mutating manifests; derives `ToolDef` shapes from `KHALANI_TOOLS` manifests |
| `src/vex-agent/tools/internal/khalani.ts` | (no direct `@tools/khalani` import) | Thin alias shim: delegates `khalani_chains_list`, `khalani_tokens_top`, `token_find`, `khalani_tokens_balances` to `executeProtocolTool(KHALANI_INTERNAL_TO_PROTOCOL[name])` |

### Test layer

| Consumer | Import | Usage |
|----------|--------|-------|
| `src/__tests__/khalani/khalani-bridge-executor.test.ts` | `bridge-executor`, `types` | `parseBigintish` unit tests |
| `src/__tests__/khalani/khalani-chains.test.ts` | `chains`, `types` | `resolveChainId`, `getChain`, `getChainRpcUrl`, `getChainFamily` unit tests |
| `src/__tests__/khalani/khalani-client.test.ts` | `client` | `KhalaniClient` HTTP method unit tests |
| `src/__tests__/khalani/khalani-helpers.test.ts` | `helpers`, `request`, `bridge-executor`, `errors` | `resolveRouteBestIndex`, `parseTradeType`, `parseReferrerFeeBps`, `parseAmountInSmallestUnits`, `parseBigintish`, `mapKhalaniError` |
| `src/__tests__/khalani/khalani-validation.test.ts` | `validation` | All validator functions |

**No consumers in `vex-app/src/`** — the Khalani client is engine/tool-layer internal. The renderer reaches Khalani capabilities only via the engine IPC chain.

## Internal flow

### Bridge execution (khalani.bridge — mutating)

Triggered by `protocols/khalani/handlers/bridge.ts` after approval gate is passed by `executeProtocolTool` (Z3 runtime):

```
bridge handler:
  1. getCachedKhalaniChains()                     ← chain registry (cached 24h)
  2. getChainFamily(fromChainId) / getChainFamily(toChainId)  ← source/dest families
  3. resolveSelectedAddress(walletResolution, policy, fromFamily)   ← Z3 wallet/resolve
     └─ validate explicit fromAddress against session selection (fail-closed)
  4. recipient = explicit || resolveSelectedAddress(walletResolution, policy, toFamily)
  5. prepareQuoteRequest({fromChain, toChain, fromToken, toToken, amount, ...})
     ├─ getCachedKhalaniChains(refreshChains?)
     ├─ resolveChainId(fromChain|toChain)
     ├─ resolveQuoteAddress(fromAddress, family, "from") → normalizeAddressForFamily
     └─ returns PreparedQuoteRequest
  6. client.getQuotes(request, opts?)              ← POST /v1/quotes
  7. route selection: explicit routeId || resolveRouteBestIndex(routes)
  8. quote freshness check: quoteExpiresAt || validBefore vs Date.now()
  9. client.buildDeposit({from, quoteId, routeId, depositMethod?})  ← POST /v1/deposit/build
 10. if dryRun === true → return plan JSON (no signing, no broadcast)
 11. resolveSigningWallet(walletResolution, policy, fromFamily)      ← decrypt after dryRun gate
 12. executeDepositPlan({plan, sourceChain, chains, quoteId, routeId, signer})
     └─ plan.kind dispatch:
        PERMIT2  → throw KHALANI_PERMIT2_BLOCKED
        TRANSFER → executeTransferPlan (EVM only)
        CONTRACT_CALL:
          eip155 → executeEvmContractCallPlan
                   ├─ assertEvmApproval per approval
                   ├─ executeEvmApproval: sendTransaction + optional waitForReceipt
                   └─ submitDeposit({quoteId, routeId, txHash})  ← PUT /v1/deposit/submit
          solana → executeSolanaContractCallPlan
                   ├─ assertSolanaApproval per approval
                   ├─ signAndSendSolanaTransaction(rpcUrl, secretKey, base64Tx)
                   │   └─ signSolanaTransaction → VersionedTransaction.sign
                   │   └─ Connection.sendRawTransaction → confirmTransaction("confirmed")
                   └─ submitDeposit({quoteId, routeId, txHash})
 13. return {orderId, txHash, _tradeCapture: {type:"bridge", ...}}   ← capture hint for runtime
```

### Signing isolation

EVM signing:
- `createDynamicWalletClient(chain, chains, wallet.privateKey)` → viem `WalletClient` with `privateKeyToAccount(wallet.privateKey)`.
- Key is held in-scope for the duration of the `executeEvmApproval` call and garbage-collected after. Not stored in any singleton or cache.
- 30s RPC timeout; 2 retries for transient network failure.

Solana signing:
- `Keypair.fromSecretKey(secretKey)` → sign `VersionedTransaction`.
- Key bytes in-scope only during `signSolanaTransaction`; not cached.
- `Connection` is created fresh per `signAndSendSolanaTransaction` call (no singleton).
- Commitment level: `"confirmed"`.

Both chains: The signing key arrives as a field on `ChainWallet`, which is passed by the handler after `resolveSigningWallet` (Z3 `wallet/resolve.ts`). Decryption of the keystore happens in Z3, not here. This layer is key-consuming, not key-managing.

### Read path (khalani.tokens.balances example)

```
read handler:
  1. resolveWalletFamily(params) → "eip155" | "solana"
  2. resolveWalletAddress(params, context, family)
     ├─ resolveSelectedAddress(walletResolution, policy, family)  ← Z3 wallet/resolve
     └─ if explicit address + session scope: assert walletAddressesEqual
  3. parseBalanceChainSelection(chainIds?)  → BalanceChainSelection
  4. getTokenBalancesAcrossChains({address, family, chainIds})
     ├─ getCachedKhalaniChains()
     ├─ resolveTargetChains(chains, family, chainIds?)
     └─ mapWithConcurrency(targetChains, 4, async chain =>
           client.getTokenBalances(address, [chain.id]))   ← GET /v1/tokens/balances/{address}
  5. sort by USD desc, return TokenBalanceScanResult
```

## Dependencies

**Imports FROM:**
- `src/config/store.ts` — `loadConfig()` for `services.khalaniApiUrl` and wallet addresses (helpers.ts fallback)
- `src/errors.ts` — `VexError`, `ErrorCodes` (all KHALANI_* codes)
- `src/utils/http.ts` — `fetchWithTimeout`, `readJson`
- `src/utils/validation-helpers.ts` — `isRecord`, `createFieldValidators` (validation.ts)
- `src/tools/wallet/inventory.ts` — `getPrimaryEvmAddress`, `getPrimarySolanaAddress` (helpers.ts), `familyToInventory`, `walletAddressesEqual` (used by protocol handlers via this module's exports)
- `src/tools/wallet/multi-auth.ts` — `ChainWallet` type (bridge-executor.ts parameter)
- `src/constants/chain.ts` — `ERC20_ABI` (bridge-executor.ts ERC20 transfer)
- `viem` + `viem/accounts` — `createPublicClient`, `createWalletClient`, `http`, `privateKeyToAccount`, `getAddress`, `isAddress` (evm-client.ts, bridge-executor.ts)
- `@solana/web3.js` — `Connection`, `Keypair`, `VersionedTransaction` (solana-signer.ts)
- `node:buffer` — `Buffer` (solana-signer.ts base64 I/O)

**Consumed BY:**
- Z3 `module.vex-agent.tools-protocols` — khalani protocol handlers (primary engine consumer)
- Z3 `module.vex-agent.tools-internal` — `wallet_read` (balances), `evm_read` (public client + chain lookup), `wallet/resolve.ts` (ChainFamily type), internal khalani alias shim
- Z4 `module.vex-agent.data-memory-knowledge` (sync) — balance-sync, chains, portfolio-chain-map, worker
- Test suite — `src/__tests__/khalani/**`

## Cross-references

- vex-app coverage: `audits/current/coverage-gaps.md#CAP-khalani-bridge-dispatch`
- quality findings: `audits/current/quality-findings.md`
- related protocol engine wrapper: `module.vex-agent.tools-protocols` (manifest, approval gating, capture pipeline, protocol execution context)
- related internal tools: `module.vex-agent.tools-internal` (khalani internal alias shim, wallet_read, evm_read)
- related signing primitives: `module.src-root.lib-wallet` (keystore decrypt, `WalletResolution`, `ChainWallet` construction — key is decrypted before passing to this module)
- related decisions: `decisions/ADR-0001-global-model-session-wallet.md` — per-session wallet selection; `resolveSelectedAddress`/`resolveSigningWallet` enforce session scope before `executeDepositPlan` is called

## Refresh triggers

Stale when any of the following change:
- Any file under `src/tools/khalani/` (new endpoint, type change, executor logic, validation, error mapping)
- `src/vex-agent/tools/protocols/khalani/handlers/bridge.ts` or `handlers/read.ts` (signing isolation or session wallet enforcement)
- `src/vex-agent/tools/registry/khalani.ts` (internal alias registration or manifest assertion logic)
- `src/tools/wallet/multi-auth.ts` (`ChainWallet` shape changes)
- `src/config/store.ts` (if `services.khalaniApiUrl` path changes)

## Open questions

1. **Error message leakage in Solana signer**: `signSolanaTransaction` and `signAndSendSolanaTransaction` include raw `err.message` strings in the `VexError` hint. Unlike `wallet_send_confirm`'s `summarizeWalletError` (SHA-256 fingerprint), Khalani bridge errors can surface chain-side messages (e.g. RPC error text, transaction simulation output). These eventually appear in `ToolResult.output` (bridge handler line 55 `err.message`). Evaluate whether these need fingerprinting too — chain simulation errors can reveal internal state.

2. **`Khalani.md` is stale and misaligned**: The inline `.md` references `src/commands/khalani/` (CLI command layer), which is not within the declared scope of this module. If that commands layer is removed or restructured, this doc will silently mislead. Also last updated 2026-03-30 — it predates the per-session wallet integration (puzzle 5D-protocols p4, commit c5963c87). Consider removing or clearly marking as "CLI command reference, not agent path".

3. **`resolveConfiguredAddress` in `helpers.ts` vs session wallet scope**: `helpers.ts:32 resolveConfiguredAddress` reads the PRIMARY wallet from `loadConfig()` (global config, not session-scoped). This function is used by `request.ts:prepareQuoteRequest` as the fallback when `fromAddress` is not provided. In the agent bridge path, the handler (bridge.ts) always provides explicit addresses via `resolveSelectedAddress` before calling `prepareQuoteRequest` — so this fallback is not reached from the agent. But if any future caller invokes `prepareQuoteRequest` without pre-resolving the session wallet, it silently falls back to the config-level primary wallet rather than the session-selected one. Confirm this is acceptable or add a guard.

4. **`client.ts` singleton vs URL change**: The `cachedClient` singleton is invalidated only when `config.services.khalaniApiUrl` changes. In practice this URL is static per config, so this is fine. But if `loadConfig()` is hot-reloaded without restart (e.g. after onboarding wizard rewrites `config.json`), the old client is dropped and a new one created on the next call. No warmup or teardown — acceptable for stateless HTTP.

5. **Chain cache cross-process**: Both Z5 (`getCachedKhalaniChains`) and Z3 handlers use the same module-level `cachedChains` cache because they share the same Node.js module instance (engine runs in-process). But if the engine is ever moved to a utility process (separate Node.js runtime), each process would maintain its own 24h cache independently. Currently this is a non-issue; note for architectural change tracking.
