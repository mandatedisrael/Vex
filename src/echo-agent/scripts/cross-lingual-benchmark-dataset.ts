/**
 * Cross-lingual benchmark dataset — curated retrieval pairs.
 *
 * Each pair represents one realistic Vex session memory lookup: a user query
 * in their native language that should retrieve ONE specific episode summary
 * from a pool of ~N episodes across various topics.
 *
 * Languages covered: en, pl, fr, zh, vi (5 × 6 pairs = 30 pairs total).
 * Topic distribution per language is identical — for every topic there is
 * exactly one pair per language. That makes Mode A (cross-lingual) comparable
 * across languages: the English document pool is the same regardless of
 * which query language is being probed.
 *
 * Title fields (titleEn / titleNative) simulate the LLM-generated title that
 * PR2 introduces into extractEpisodes JSON output. They are ≤100 characters,
 * content-aware, and in the document's language. We test the planned PR2
 * shape — NOT the legacy `summary.slice(0, 120)` that production uses today.
 * Rationale: if we benchmark the old slice-based title, we measure a baseline
 * we're about to abandon, and then have to redo the benchmark post-PR2.
 *
 * Shape — per pair:
 *   id:            unique identifier (lang-topic)
 *   lang:          ISO code (matches `memory_language_code` contract from PR2)
 *   topic:         semantic theme — also serves as distractor control
 *   queryNative:   what the user types in their native language (recall side)
 *   titleEn:       simulated LLM-generated episode title, English
 *   titleNative:   simulated LLM-generated episode title, native language
 *   summaryEn:     episode summary as it currently lives in `session_episodes.summary_en`
 *   summaryNative: what the summary will look like post-PR2 in the same language as the session
 *
 * Mode A (cross-lingual, legacy EN corpus): query=queryNative, doc=(titleEn, summaryEn).
 *   Measures whether we can cut the hot-path translation today without losing
 *   recall on sessions that still have English summaries.
 *
 * Mode B (same-language, post-PR2 target): query=queryNative, doc=(titleNative, summaryNative).
 *   Measures whether the multilingual session-memory rewrite retrieves cleanly
 *   in each language.
 *
 * NOT machine-translated. Every non-English variant is a natural-sounding
 * equivalent, not a word-for-word render — that's the whole point of testing
 * a multilingual embedder. If the model can retrieve a natural PL query
 * against a natural PL document (Mode B) and a natural PL query against the
 * EN document (Mode A), the pivot is safe.
 */

export interface BenchmarkPair {
  id: string;
  lang: "en" | "pl" | "fr" | "zh" | "vi";
  topic: string;
  queryNative: string;
  titleEn: string;
  titleNative: string;
  summaryEn: string;
  summaryNative: string;
}

export const BENCHMARK_PAIRS: readonly BenchmarkPair[] = [
  // ── English (6) ─────────────────────────────────────────────────────
  {
    id: "en-balance",
    lang: "en",
    topic: "balance",
    queryNative: "what is my USDC balance on Solana",
    titleEn: "USDC balance check on Solana",
    titleNative: "USDC balance check on Solana",
    summaryEn:
      "User asked to check USDC balance on Solana. Agent reported 1250 USDC in wallet 4QpN...xyz via balance_check tool.",
    summaryNative:
      "User asked to check USDC balance on Solana. Agent reported 1250 USDC in wallet 4QpN...xyz via balance_check tool.",
  },
  {
    id: "en-swap",
    lang: "en",
    topic: "swap",
    queryNative: "when did I last swap USDC to SOL",
    titleEn: "USDC to SOL swap on Jupiter",
    titleNative: "USDC to SOL swap on Jupiter",
    summaryEn:
      "Agent executed a swap of 100 USDC into SOL at 0.005 SOL per USDC on Jupiter. Transaction hash 4aB...Qz, confirmed in 3 slots.",
    summaryNative:
      "Agent executed a swap of 100 USDC into SOL at 0.005 SOL per USDC on Jupiter. Transaction hash 4aB...Qz, confirmed in 3 slots.",
  },
  {
    id: "en-slippage",
    lang: "en",
    topic: "slippage_pref",
    queryNative: "what are my slippage settings",
    titleEn: "User slippage preference: max 0.5%",
    titleNative: "User slippage preference: max 0.5%",
    summaryEn:
      "User stated a preference for low-slippage swaps, tolerating at most 0.5 percent across all DEX routes.",
    summaryNative:
      "User stated a preference for low-slippage swaps, tolerating at most 0.5 percent across all DEX routes.",
  },
  {
    id: "en-hold-eth",
    lang: "en",
    topic: "hold_decision",
    queryNative: "why did I hold ETH during the drawdown",
    titleEn: "Decision to hold ETH long through 12% drawdown",
    titleNative: "Decision to hold ETH long through 12% drawdown",
    summaryEn:
      "User decided to keep the ETH long position despite a 12 percent drawdown. Rationale noted: thesis on the upcoming upgrade remained unchanged.",
    summaryNative:
      "User decided to keep the ETH long position despite a 12 percent drawdown. Rationale noted: thesis on the upcoming upgrade remained unchanged.",
  },
  {
    id: "en-pnl",
    lang: "en",
    topic: "pnl_report",
    queryNative: "show me portfolio performance last week",
    titleEn: "7-day portfolio PnL report",
    titleNative: "7-day portfolio PnL report",
    summaryEn:
      "Portfolio PnL for the last 7 days: +4.2 percent unrealized and -0.8 percent realized on the closed BTC short position.",
    summaryNative:
      "Portfolio PnL for the last 7 days: +4.2 percent unrealized and -0.8 percent realized on the closed BTC short position.",
  },
  {
    id: "en-gas",
    lang: "en",
    topic: "gas_cost",
    queryNative: "what are gas costs for trading on L2",
    titleEn: "Gas cost comparison: Base vs Ethereum mainnet",
    titleNative: "Gas cost comparison: Base vs Ethereum mainnet",
    summaryEn:
      "Gas on Base averaged around 0.003 USD per swap during the session, while Ethereum mainnet sat near 12 USD for the same operation.",
    summaryNative:
      "Gas on Base averaged around 0.003 USD per swap during the session, while Ethereum mainnet sat near 12 USD for the same operation.",
  },

  // ── Polish (6) ──────────────────────────────────────────────────────
  {
    id: "pl-balance",
    lang: "pl",
    topic: "balance",
    queryNative: "jaki jest mój balans USDC na Solanie",
    titleEn: "USDC balance check on Solana",
    titleNative: "Sprawdzenie stanu USDC na Solanie",
    summaryEn:
      "User asked to check USDC balance on Solana. Agent reported 1250 USDC in wallet 4QpN...xyz via balance_check tool.",
    summaryNative:
      "User zapytał o stan USDC na Solanie. Agent zgłosił 1250 USDC w portfelu 4QpN...xyz przez narzędzie balance_check.",
  },
  {
    id: "pl-swap",
    lang: "pl",
    topic: "swap",
    queryNative: "kiedy ostatnio zamieniałem USDC na SOL",
    titleEn: "USDC to SOL swap on Jupiter",
    titleNative: "Swap USDC na SOL na Jupiter",
    summaryEn:
      "Agent executed a swap of 100 USDC into SOL at 0.005 SOL per USDC on Jupiter. Transaction hash 4aB...Qz, confirmed in 3 slots.",
    summaryNative:
      "Agent wykonał swap 100 USDC na SOL po kursie 0.005 SOL za USDC na Jupiter. Hash transakcji 4aB...Qz, potwierdzony w 3 slotach.",
  },
  {
    id: "pl-slippage",
    lang: "pl",
    topic: "slippage_pref",
    queryNative: "jakie mam ustawienia slippage",
    titleEn: "User slippage preference: max 0.5%",
    titleNative: "Preferencja slippage użytkownika: maks. 0,5%",
    summaryEn:
      "User stated a preference for low-slippage swaps, tolerating at most 0.5 percent across all DEX routes.",
    summaryNative:
      "User zadeklarował preferencję dla swapów z niskim slippage, tolerując maksymalnie 0,5 procenta na wszystkich trasach DEX.",
  },
  {
    id: "pl-hold-eth",
    lang: "pl",
    topic: "hold_decision",
    queryNative: "dlaczego trzymałem ETH podczas spadku",
    titleEn: "Decision to hold ETH long through 12% drawdown",
    titleNative: "Decyzja o utrzymaniu longa ETH mimo 12% drawdownu",
    summaryEn:
      "User decided to keep the ETH long position despite a 12 percent drawdown. Rationale noted: thesis on the upcoming upgrade remained unchanged.",
    summaryNative:
      "User zdecydował się trzymać long ETH mimo 12 procent drawdownu. Powód: teza o nadchodzącym upgradzie pozostała bez zmian.",
  },
  {
    id: "pl-pnl",
    lang: "pl",
    topic: "pnl_report",
    queryNative: "pokaż wyniki portfela z ostatniego tygodnia",
    titleEn: "7-day portfolio PnL report",
    titleNative: "Raport PnL portfela za 7 dni",
    summaryEn:
      "Portfolio PnL for the last 7 days: +4.2 percent unrealized and -0.8 percent realized on the closed BTC short position.",
    summaryNative:
      "PnL portfela za ostatnie 7 dni: +4,2 procent niezrealizowany i -0,8 procent zrealizowany na zamkniętej pozycji short BTC.",
  },
  {
    id: "pl-gas",
    lang: "pl",
    topic: "gas_cost",
    queryNative: "koszty gazu dla tradingu na L2",
    titleEn: "Gas cost comparison: Base vs Ethereum mainnet",
    titleNative: "Porównanie kosztów gazu: Base vs Ethereum mainnet",
    summaryEn:
      "Gas on Base averaged around 0.003 USD per swap during the session, while Ethereum mainnet sat near 12 USD for the same operation.",
    summaryNative:
      "Gas na Base wynosił średnio około 0,003 USD za swap w czasie sesji, podczas gdy Ethereum mainnet utrzymywał się przy 12 USD za tę samą operację.",
  },

  // ── French (6) ──────────────────────────────────────────────────────
  {
    id: "fr-balance",
    lang: "fr",
    topic: "balance",
    queryNative: "quel est mon solde USDC sur Solana",
    titleEn: "USDC balance check on Solana",
    titleNative: "Vérification du solde USDC sur Solana",
    summaryEn:
      "User asked to check USDC balance on Solana. Agent reported 1250 USDC in wallet 4QpN...xyz via balance_check tool.",
    summaryNative:
      "L'utilisateur a demandé de vérifier le solde USDC sur Solana. L'agent a rapporté 1250 USDC dans le portefeuille 4QpN...xyz via l'outil balance_check.",
  },
  {
    id: "fr-swap",
    lang: "fr",
    topic: "swap",
    queryNative: "quand ai-je échangé USDC contre SOL pour la dernière fois",
    titleEn: "USDC to SOL swap on Jupiter",
    titleNative: "Swap USDC vers SOL sur Jupiter",
    summaryEn:
      "Agent executed a swap of 100 USDC into SOL at 0.005 SOL per USDC on Jupiter. Transaction hash 4aB...Qz, confirmed in 3 slots.",
    summaryNative:
      "L'agent a exécuté un swap de 100 USDC vers SOL au taux de 0,005 SOL par USDC sur Jupiter. Hash de transaction 4aB...Qz, confirmé en 3 slots.",
  },
  {
    id: "fr-slippage",
    lang: "fr",
    topic: "slippage_pref",
    queryNative: "quels sont mes réglages de slippage",
    titleEn: "User slippage preference: max 0.5%",
    titleNative: "Préférence de slippage de l'utilisateur: max 0,5%",
    summaryEn:
      "User stated a preference for low-slippage swaps, tolerating at most 0.5 percent across all DEX routes.",
    summaryNative:
      "L'utilisateur a déclaré préférer les swaps à faible slippage, tolérant au maximum 0,5 pour cent sur toutes les routes DEX.",
  },
  {
    id: "fr-hold-eth",
    lang: "fr",
    topic: "hold_decision",
    queryNative: "pourquoi ai-je gardé ETH pendant la baisse",
    titleEn: "Decision to hold ETH long through 12% drawdown",
    titleNative: "Décision de conserver la position longue ETH malgré 12% de baisse",
    summaryEn:
      "User decided to keep the ETH long position despite a 12 percent drawdown. Rationale noted: thesis on the upcoming upgrade remained unchanged.",
    summaryNative:
      "L'utilisateur a décidé de conserver la position longue sur ETH malgré un drawdown de 12 pour cent. Motif: la thèse sur la mise à niveau à venir reste inchangée.",
  },
  {
    id: "fr-pnl",
    lang: "fr",
    topic: "pnl_report",
    queryNative: "montre les performances de mon portefeuille la semaine dernière",
    titleEn: "7-day portfolio PnL report",
    titleNative: "Rapport PnL du portefeuille sur 7 jours",
    summaryEn:
      "Portfolio PnL for the last 7 days: +4.2 percent unrealized and -0.8 percent realized on the closed BTC short position.",
    summaryNative:
      "PnL du portefeuille sur les 7 derniers jours: +4,2 pour cent non réalisé et -0,8 pour cent réalisé sur la position short BTC clôturée.",
  },
  {
    id: "fr-gas",
    lang: "fr",
    topic: "gas_cost",
    queryNative: "coûts de gas pour le trading sur L2",
    titleEn: "Gas cost comparison: Base vs Ethereum mainnet",
    titleNative: "Comparaison des coûts de gas: Base vs Ethereum mainnet",
    summaryEn:
      "Gas on Base averaged around 0.003 USD per swap during the session, while Ethereum mainnet sat near 12 USD for the same operation.",
    summaryNative:
      "Le gas sur Base s'est établi en moyenne autour de 0,003 USD par swap pendant la session, tandis qu'Ethereum mainnet tournait près de 12 USD pour la même opération.",
  },

  // ── Chinese (simplified) (6) ────────────────────────────────────────
  {
    id: "zh-balance",
    lang: "zh",
    topic: "balance",
    queryNative: "我在 Solana 上的 USDC 余额是多少",
    titleEn: "USDC balance check on Solana",
    titleNative: "Solana 上的 USDC 余额查询",
    summaryEn:
      "User asked to check USDC balance on Solana. Agent reported 1250 USDC in wallet 4QpN...xyz via balance_check tool.",
    summaryNative:
      "用户请求查询 Solana 上的 USDC 余额。代理通过 balance_check 工具报告钱包 4QpN...xyz 中有 1250 USDC。",
  },
  {
    id: "zh-swap",
    lang: "zh",
    topic: "swap",
    queryNative: "我上次把 USDC 换成 SOL 是什么时候",
    titleEn: "USDC to SOL swap on Jupiter",
    titleNative: "在 Jupiter 上的 USDC 到 SOL 兑换",
    summaryEn:
      "Agent executed a swap of 100 USDC into SOL at 0.005 SOL per USDC on Jupiter. Transaction hash 4aB...Qz, confirmed in 3 slots.",
    summaryNative:
      "代理在 Jupiter 上以 0.005 SOL/USDC 的汇率将 100 USDC 兑换为 SOL。交易哈希 4aB...Qz，在 3 个 slot 内确认。",
  },
  {
    id: "zh-slippage",
    lang: "zh",
    topic: "slippage_pref",
    queryNative: "我的滑点设置是什么",
    titleEn: "User slippage preference: max 0.5%",
    titleNative: "用户滑点偏好：最多 0.5%",
    summaryEn:
      "User stated a preference for low-slippage swaps, tolerating at most 0.5 percent across all DEX routes.",
    summaryNative:
      "用户表示偏好低滑点兑换，在所有 DEX 路由上最多容忍 0.5%。",
  },
  {
    id: "zh-hold-eth",
    lang: "zh",
    topic: "hold_decision",
    queryNative: "我为什么在下跌时持有 ETH",
    titleEn: "Decision to hold ETH long through 12% drawdown",
    titleNative: "12% 回撤期间继续持有 ETH 多头的决定",
    summaryEn:
      "User decided to keep the ETH long position despite a 12 percent drawdown. Rationale noted: thesis on the upcoming upgrade remained unchanged.",
    summaryNative:
      "用户决定在 12% 回撤期间继续持有 ETH 多头仓位。理由：对即将到来的升级的论点保持不变。",
  },
  {
    id: "zh-pnl",
    lang: "zh",
    topic: "pnl_report",
    queryNative: "显示我上周的投资组合表现",
    titleEn: "7-day portfolio PnL report",
    titleNative: "7 天投资组合 PnL 报告",
    summaryEn:
      "Portfolio PnL for the last 7 days: +4.2 percent unrealized and -0.8 percent realized on the closed BTC short position.",
    summaryNative:
      "过去 7 天投资组合 PnL：未实现 +4.2%，在已平仓的 BTC 空头仓位上已实现 -0.8%。",
  },
  {
    id: "zh-gas",
    lang: "zh",
    topic: "gas_cost",
    queryNative: "L2 交易的 gas 费用是多少",
    titleEn: "Gas cost comparison: Base vs Ethereum mainnet",
    titleNative: "Gas 费用对比：Base 与 Ethereum 主网",
    summaryEn:
      "Gas on Base averaged around 0.003 USD per swap during the session, while Ethereum mainnet sat near 12 USD for the same operation.",
    summaryNative:
      "会话期间 Base 网络每笔兑换的 gas 平均约 0.003 美元，而以太坊主网同一操作约为 12 美元。",
  },

  // ── Vietnamese (6) ──────────────────────────────────────────────────
  {
    id: "vi-balance",
    lang: "vi",
    topic: "balance",
    queryNative: "số dư USDC của tôi trên Solana là bao nhiêu",
    titleEn: "USDC balance check on Solana",
    titleNative: "Kiểm tra số dư USDC trên Solana",
    summaryEn:
      "User asked to check USDC balance on Solana. Agent reported 1250 USDC in wallet 4QpN...xyz via balance_check tool.",
    summaryNative:
      "Người dùng yêu cầu kiểm tra số dư USDC trên Solana. Agent báo cáo 1250 USDC trong ví 4QpN...xyz thông qua công cụ balance_check.",
  },
  {
    id: "vi-swap",
    lang: "vi",
    topic: "swap",
    queryNative: "lần cuối tôi đổi USDC sang SOL là khi nào",
    titleEn: "USDC to SOL swap on Jupiter",
    titleNative: "Swap USDC sang SOL trên Jupiter",
    summaryEn:
      "Agent executed a swap of 100 USDC into SOL at 0.005 SOL per USDC on Jupiter. Transaction hash 4aB...Qz, confirmed in 3 slots.",
    summaryNative:
      "Agent đã thực hiện swap 100 USDC sang SOL với tỷ giá 0,005 SOL mỗi USDC trên Jupiter. Hash giao dịch 4aB...Qz, được xác nhận trong 3 slot.",
  },
  {
    id: "vi-slippage",
    lang: "vi",
    topic: "slippage_pref",
    queryNative: "cài đặt slippage của tôi là gì",
    titleEn: "User slippage preference: max 0.5%",
    titleNative: "Ưu tiên slippage của người dùng: tối đa 0,5%",
    summaryEn:
      "User stated a preference for low-slippage swaps, tolerating at most 0.5 percent across all DEX routes.",
    summaryNative:
      "Người dùng bày tỏ ưu tiên các swap có slippage thấp, chấp nhận tối đa 0,5 phần trăm trên tất cả các tuyến DEX.",
  },
  {
    id: "vi-hold-eth",
    lang: "vi",
    topic: "hold_decision",
    queryNative: "tại sao tôi giữ ETH khi giá giảm",
    titleEn: "Decision to hold ETH long through 12% drawdown",
    titleNative: "Quyết định giữ vị thế long ETH qua drawdown 12%",
    summaryEn:
      "User decided to keep the ETH long position despite a 12 percent drawdown. Rationale noted: thesis on the upcoming upgrade remained unchanged.",
    summaryNative:
      "Người dùng quyết định giữ vị thế long ETH bất chấp drawdown 12 phần trăm. Lý do: luận điểm về lần nâng cấp sắp tới không thay đổi.",
  },
  {
    id: "vi-pnl",
    lang: "vi",
    topic: "pnl_report",
    queryNative: "xem hiệu suất danh mục tuần trước",
    titleEn: "7-day portfolio PnL report",
    titleNative: "Báo cáo PnL danh mục 7 ngày",
    summaryEn:
      "Portfolio PnL for the last 7 days: +4.2 percent unrealized and -0.8 percent realized on the closed BTC short position.",
    summaryNative:
      "PnL danh mục trong 7 ngày qua: +4,2 phần trăm chưa thực hiện và -0,8 phần trăm đã thực hiện trên vị thế short BTC đã đóng.",
  },
  {
    id: "vi-gas",
    lang: "vi",
    topic: "gas_cost",
    queryNative: "chi phí gas cho trading trên L2",
    titleEn: "Gas cost comparison: Base vs Ethereum mainnet",
    titleNative: "So sánh chi phí gas: Base và Ethereum mainnet",
    summaryEn:
      "Gas on Base averaged around 0.003 USD per swap during the session, while Ethereum mainnet sat near 12 USD for the same operation.",
    summaryNative:
      "Gas trên Base trung bình khoảng 0,003 USD mỗi swap trong phiên, trong khi Ethereum mainnet ở mức gần 12 USD cho cùng một thao tác.",
  },
];

/** Unique languages present in the dataset, in the order they appear. */
export const BENCHMARK_LANGS = ["en", "pl", "fr", "zh", "vi"] as const;
export type BenchmarkLang = (typeof BENCHMARK_LANGS)[number];
