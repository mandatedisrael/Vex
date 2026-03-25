import { type FC, useState, useEffect, useCallback } from "react";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { FloatingWidget } from "./components/FloatingWidget";
import SubagentPanel from "./components/SubagentPanel";
import LoopStatusBar from "./components/LoopStatusBar";
import { ChatView } from "./views/ChatView";
import { TradesView } from "./views/TradesView";
import { PortfolioView } from "./views/PortfolioView";
import { PredictionsView } from "./views/PredictionsView";
import { MemoryView } from "./views/MemoryView";
import { OpsWidget } from "./views/OpsWidget";
import { TelegramView } from "./views/TelegramView";
import {
  HugeiconsIcon, MessageMultiple01Icon, Activity01Icon,
  Wallet01Icon, BrainIcon, Settings01Icon, TelegramIcon, Robot01Icon, ChartLineData01Icon,
} from "./components/icons";
import { initAuth, getStatus, getRecentTrades, getRuntimeUpdateStatus as getLauncherRuntimeUpdateStatus, retryRuntimeUpdatePull, applyRuntimeUpdate, startLoop, stopLoop } from "./api";
import { useSubagents } from "./hooks/useSubagents";
import type { AgentStatus, RuntimeUpdateStatus, TradeEntry, TradeSummary } from "./types";
import { cn } from "./utils";
import { buildRuntimeUpdateBannerModel } from "./runtime-update";

const STATUS_POLL_MS = 10_000;

type WidgetType = "trades" | "portfolio" | "predictions" | "memory" | "ops" | "telegram";

export const App: FC = () => {
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [openWidgets, setOpenWidgets] = useState<Set<WidgetType>>(new Set());
  const [liveBurn, setLiveBurn] = useState({ sessionCost: 0, providerBalance: null as number | null, estimatedRemaining: 0, isLowBalance: false, model: null as string | null, priceCurrency: "" });
  const [liveSessionId, setLiveSessionId] = useState<string | undefined>(undefined);
  const [recentTrades, setRecentTrades] = useState<TradeEntry[]>([]);
  const [tradeSummary, setTradeSummary] = useState<TradeSummary | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [isOffline, setIsOffline] = useState(false);
  const [runtimeUpdate, setRuntimeUpdate] = useState<RuntimeUpdateStatus | null>(null);
  const [runtimeUpdateBusy, setRuntimeUpdateBusy] = useState<"apply" | "retry" | null>(null);
  const [runtimeUpdateActionError, setRuntimeUpdateActionError] = useState<string | null>(null);
  const [subagentPanelOpen, setSubagentPanelOpen] = useState(false);
  const { subagents, hasActive: hasActiveSubagents } = useSubagents(authReady);

  useEffect(() => { initAuth().then(() => setAuthReady(true)).catch(() => setAuthReady(true)); }, []);

  const refreshStatus = useCallback(async () => {
    if (!authReady) return;
    try {
      setStatus(await getStatus());
      setIsOffline(false);
    } catch {
      setIsOffline(true);
    }

    try {
      setRuntimeUpdate(await getLauncherRuntimeUpdateStatus());
    } catch {
      setRuntimeUpdate(null);
    }

    try {
      const res = await getRecentTrades(3);
      setRecentTrades(res.trades); setTradeSummary(res.summary);
    } catch (err) { console.warn("[App] trade fetch failed:", err); }
  }, [authReady]);

  useEffect(() => { if (authReady) refreshStatus(); }, [authReady, refreshStatus]);
  useEffect(() => { const id = setInterval(refreshStatus, STATUS_POLL_MS); return () => clearInterval(id); }, [refreshStatus]);

  const toggleWidget = (w: WidgetType) => {
    setOpenWidgets(prev => {
      const next = new Set(prev);
      if (next.has(w)) next.delete(w); else next.add(w);
      return next;
    });
  };

  const runtimeUpdateBanner = buildRuntimeUpdateBannerModel(runtimeUpdate, status);

  const handleRuntimeUpdateAction = useCallback(async (action: "apply" | "retry") => {
    setRuntimeUpdateActionError(null);
    setRuntimeUpdateBusy(action);
    try {
      if (action === "apply") {
        const result = await applyRuntimeUpdate();
        setRuntimeUpdate(result.status);
      } else {
        const result = await retryRuntimeUpdatePull();
        setRuntimeUpdate(result.status);
      }
      await refreshStatus();
    } catch (err) {
      setRuntimeUpdateActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setRuntimeUpdateBusy(null);
    }
  }, [refreshStatus]);

  // ── Loop / Txs control handlers ──────────────────────────────────
  const handleTxsToggle = async () => {
    if (!status?.loop) return;
    const newMode = status.loop.mode === "full" ? "restricted" : "full";
    try { await startLoop(newMode as "full" | "restricted", status.loop.intervalMs); } catch { /* ignore */ }
    refreshStatus();
  };
  const handleLoopToggle = async () => {
    if (!status?.loop) return;
    try {
      if (status.loop.active) await stopLoop();
      else await startLoop(status.loop.mode as "full" | "restricted");
    } catch { /* ignore */ }
    refreshStatus();
  };
  const handleIntervalChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const ms = Number(e.target.value);
    if (!status?.loop || !ms) return;
    try { await startLoop(status.loop.mode as "full" | "restricted", ms); } catch { /* ignore */ }
    refreshStatus();
  };

  // Mode indicator derived from loop state
  const loopActive = status?.loop?.active ?? false;
  const txsMode = status?.loop?.mode ?? "restricted";
  const modeLabel = loopActive
    ? (txsMode === "full" ? "Autonomous (full)" : "Autonomous (restricted)")
    : "Manual";
  const modeDescription = loopActive
    ? (txsMode === "full" ? "Full autonomy. All auto-approved." : "Proactive. Trades need approval.")
    : "Respond-only. No proactive actions.";
  const modeColor = loopActive
    ? (txsMode === "full" ? "text-status-ok" : "text-status-warn")
    : "text-muted-foreground";

  const navItems: Array<{ key: WidgetType | "chat"; label: string; icon: unknown }> = [
    { key: "chat", label: "Chat", icon: MessageMultiple01Icon },
    { key: "trades", label: "Trades", icon: Activity01Icon },
    { key: "portfolio", label: "Portfolio", icon: Wallet01Icon },
    { key: "predictions", label: "Predictions", icon: ChartLineData01Icon },
    { key: "memory", label: "Memory", icon: BrainIcon },
    { key: "agents", label: "Agents", icon: Robot01Icon },
    { key: "ops", label: "Ops", icon: Settings01Icon },
    { key: "telegram", label: "Telegram", icon: TelegramIcon },
  ];

  return (
    <div className="dark h-screen flex overflow-hidden bg-background text-foreground relative">
      {/* ── Sidebar ──────────────────────────────────────── */}
      <aside
        onMouseEnter={() => setSidebarOpen(true)}
        onMouseLeave={() => setSidebarOpen(false)}
        className={cn(
          "relative z-20 flex flex-col bg-[#0a0a0a]/90 backdrop-blur-3xl transition-all duration-300 shrink-0 border-r border-white/5",
          sidebarOpen ? "w-64 shadow-[10px_0_30px_rgba(0,0,0,0.5)]" : "w-[68px]",
        )}
      >
        {/* Agent avatar / Logo area */}
        <div className="flex items-center gap-3 px-4 py-6 border-b border-white/5 shrink-0">
          <img
            src="/landing.png"
            alt="EchoClaw"
            className="shrink-0 drop-shadow-[0_10px_24px_rgba(82,138,255,0.14)]"
            style={{ height: sidebarOpen ? 36 : 30 }}
          />
          {sidebarOpen && (
            <div className="animate-fade-in min-w-0">
              <div className="text-[11px] text-muted-foreground/60 font-mono truncate tracking-wide uppercase mt-0.5">{status?.model ?? "Connecting..."}</div>
            </div>
          )}
        </div>

        {/* Nav */}
        <nav className="flex-1 py-4 px-2 space-y-1">
          {navItems.map(item => {
            const isChat = item.key === "chat";
            const isAgents = item.key === "agents";
            const isActive = isChat || (isAgents ? subagentPanelOpen : openWidgets.has(item.key as WidgetType));
            return (
              <button
                key={item.key}
                onClick={() => {
                  if (isChat) return;
                  if (isAgents) { setSubagentPanelOpen((v) => !v); return; }
                  toggleWidget(item.key as WidgetType);
                }}
                className={cn(
                  "flex items-center gap-3.5 w-full px-3 py-2.5 rounded-xl transition-all group relative",
                  isActive 
                    ? "bg-white/10 text-white shadow-sm" 
                    : "text-muted-foreground hover:bg-white/5 hover:text-foreground",
                )}
              >
                <div className="flex items-center justify-center w-6 h-6 shrink-0">
                  <HugeiconsIcon
                    icon={item.icon as never}
                    size={20}
                    className={cn(
                      "transition-transform duration-200",
                      isActive ? "text-white" : "text-muted-foreground group-hover:text-foreground group-hover:scale-110"
                    )}
                    strokeWidth={isActive ? 2 : 1.5}
                  />
                </div>
                {sidebarOpen && <span className="animate-fade-in truncate text-[13px] font-medium tracking-wide">{item.label}</span>}
                {isAgents && hasActiveSubagents && !sidebarOpen && (
                  <div className="absolute top-1 right-1 w-2 h-2 rounded-full bg-accent animate-pulse" />
                )}
              </button>
            );
          })}
        </nav>

        {/* Bottom: controls + stats */}
        {sidebarOpen && status && (
          <div className="px-4 py-3 border-t border-white/5 animate-fade-in space-y-3">
            {/* Txs / Loop / Interval controls */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-2xs uppercase tracking-wider text-muted-foreground/60 font-semibold" title="All trades require approval (Manual) or execute automatically (Auto)">Txs</span>
                <button onClick={handleTxsToggle}
                  className={cn("px-2.5 py-0.5 text-[10px] rounded-full transition-all font-medium border",
                    status.loop.mode === "full" ? "bg-status-warn/10 text-status-warn border-status-warn/20" : "bg-card border-border/50 text-muted-foreground hover:text-foreground",
                  )}>
                  {status.loop.mode === "full" ? "Auto" : "Manual"}
                </button>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-2xs uppercase tracking-wider text-muted-foreground/60 font-semibold" title="Agent runs autonomously at chosen interval">Loop</span>
                <button onClick={handleLoopToggle}
                  className={cn("px-2.5 py-0.5 text-[10px] rounded-full transition-all font-medium border",
                    status.loop.active ? "bg-status-ok/10 text-status-ok border-status-ok/20" : "bg-card border-border/50 text-muted-foreground hover:text-foreground",
                  )}>
                  {status.loop.active ? "On" : "Off"}
                </button>
              </div>
              {status.loop.active && (
                <div className="flex items-center justify-between">
                  <span className="text-2xs uppercase tracking-wider text-muted-foreground/60 font-semibold">Interval</span>
                  <select
                    value={status.loop.intervalMs}
                    onChange={handleIntervalChange}
                    className="bg-[#1a1a1a] border border-border/50 text-[10px] text-foreground rounded-lg px-1.5 py-0.5 font-mono outline-none [&>option]:bg-[#1a1a1a] [&>option]:text-foreground"
                  >
                    <option value={30000}>30s</option>
                    <option value={60000}>1m</option>
                    <option value={120000}>2m</option>
                    <option value={180000}>3m</option>
                    <option value={300000}>5m</option>
                  </select>
                </div>
              )}
            </div>
            {/* Stats */}
            <div className="text-[10px] text-muted-foreground/50 font-mono space-y-1">
              <div className="flex items-center justify-between">
                <span>Lifetime</span>
                <span className="text-foreground/70">{(status.usage.lifetimeTokens / 1000).toFixed(0)}k</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Knowledge</span>
                <span className="text-foreground/70">{status.knowledgeFileCount} files</span>
              </div>
            </div>
          </div>
        )}
      </aside>

      {/* ── Main area ────────────────────────────────────── */}
      <main className="flex-1 relative z-10 flex flex-col min-w-0">
        {/* Top bar */}
        <div className="flex items-center gap-3 px-4 py-2 shrink-0">
          {(liveSessionId || status?.sessionId) && (
            <span className="text-2xs text-muted-foreground font-mono truncate max-w-[200px]">
              {liveSessionId || status?.sessionId}
            </span>
          )}
          <div className="flex-1 flex items-center justify-center gap-1.5 text-[11px]">
            <span className={cn("font-semibold uppercase tracking-wider", modeColor)}>{modeLabel}</span>
            <span className="text-muted-foreground/40">&mdash;</span>
            <span className="text-muted-foreground/50">{modeDescription}</span>
          </div>
        </div>

        {/* Offline banner */}
        {isOffline && (
          <div className="flex items-center justify-center gap-2 px-4 py-2 bg-status-warn/10 border-b border-status-warn/20 text-status-warn text-xs font-medium shrink-0">
            <div className="h-2 w-2 rounded-full bg-status-warn animate-pulse" />
            Agent offline — retrying...
          </div>
        )}

        {runtimeUpdateBanner && (
          <div
            className={cn(
              "flex flex-col gap-3 border-b px-4 py-3 text-xs shrink-0 md:flex-row md:items-center md:justify-between",
              runtimeUpdateBanner.tone === "error"
                ? "border-rose-500/20 bg-rose-500/10 text-rose-100"
                : "border-sky-500/20 bg-sky-500/10 text-sky-100",
            )}
          >
            <div className="min-w-0">
              <div className="font-semibold tracking-wide">{runtimeUpdateBanner.title}</div>
              <div className={cn(
                "mt-1 leading-relaxed",
                runtimeUpdateBanner.tone === "error" ? "text-rose-100/80" : "text-sky-100/80",
              )}>
                {runtimeUpdateBanner.message}
              </div>
              {runtimeUpdateActionError && (
                <div className="mt-2 text-rose-200/90">{runtimeUpdateActionError}</div>
              )}
            </div>

            {runtimeUpdateBanner.action && runtimeUpdateBanner.actionLabel && (
              <button
                type="button"
                onClick={() => handleRuntimeUpdateAction(runtimeUpdateBanner.action!)}
                disabled={runtimeUpdateBusy !== null || runtimeUpdateBanner.disabled}
                className={cn(
                  "inline-flex shrink-0 items-center justify-center rounded-xl px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] transition",
                  "disabled:cursor-not-allowed disabled:opacity-60",
                  runtimeUpdateBanner.tone === "error"
                    ? "bg-rose-100 text-rose-950 hover:bg-white"
                    : "bg-sky-100 text-sky-950 hover:bg-white",
                )}
              >
                {runtimeUpdateBusy === runtimeUpdateBanner.action
                  ? runtimeUpdateBanner.action === "apply" ? "Restarting..." : "Retrying..."
                  : runtimeUpdateBanner.actionLabel}
              </button>
            )}
          </div>
        )}

        {/* Loop status bar */}
        {status?.loop && <LoopStatusBar loop={status.loop} />}

        {/* Chat — always visible (wait for auth before rendering to avoid 401) */}
        {authReady && (
          <ErrorBoundary>
            <ChatView status={status} onRefreshStatus={refreshStatus} onBurnStateChange={setLiveBurn} onSessionIdChange={setLiveSessionId} />
          </ErrorBoundary>
        )}
      </main>

      {/* ── Subagent panel (right side) ─────────────────── */}
      <SubagentPanel
        subagents={subagents}
        visible={subagentPanelOpen || hasActiveSubagents}
        onClose={() => setSubagentPanelOpen(false)}
      />

      {/* ── Floating widgets (each wrapped in ErrorBoundary) ── */}
      {openWidgets.has("trades") && (
        <ErrorBoundary>
          <FloatingWidget
            title="Trades"
            icon={<HugeiconsIcon icon={Activity01Icon} size={14} className="text-accent" />}
            onClose={() => toggleWidget("trades")}
            defaultWidth={520} defaultHeight={500}
          >
            <TradesView onBack={() => toggleWidget("trades")} />
          </FloatingWidget>
        </ErrorBoundary>
      )}
      {openWidgets.has("portfolio") && (
        <ErrorBoundary>
          <FloatingWidget
            title="Portfolio"
            icon={<HugeiconsIcon icon={Wallet01Icon} size={14} className="text-accent" />}
            onClose={() => toggleWidget("portfolio")}
            defaultWidth={480} defaultHeight={460}
          >
            <PortfolioView onBack={() => toggleWidget("portfolio")} />
          </FloatingWidget>
        </ErrorBoundary>
      )}
      {openWidgets.has("predictions") && (
        <ErrorBoundary>
          <FloatingWidget
            title="Predictions"
            icon={<HugeiconsIcon icon={ChartLineData01Icon} size={14} className="text-accent" />}
            onClose={() => toggleWidget("predictions")}
            defaultWidth={520} defaultHeight={520}
          >
            <PredictionsView onBack={() => toggleWidget("predictions")} />
          </FloatingWidget>
        </ErrorBoundary>
      )}
      {openWidgets.has("memory") && (
        <ErrorBoundary>
          <FloatingWidget
            title="Memory"
            icon={<HugeiconsIcon icon={BrainIcon} size={14} className="text-accent" />}
            onClose={() => toggleWidget("memory")}
            defaultWidth={500} defaultHeight={480}
          >
            <MemoryView onBack={() => toggleWidget("memory")} />
          </FloatingWidget>
        </ErrorBoundary>
      )}
      {openWidgets.has("ops") && (
        <ErrorBoundary>
          <FloatingWidget
            title="Operations"
            icon={<HugeiconsIcon icon={Settings01Icon} size={14} className="text-accent" />}
            onClose={() => toggleWidget("ops")}
            defaultWidth={420} defaultHeight={500}
          >
            <OpsWidget onBack={() => toggleWidget("ops")} />
          </FloatingWidget>
        </ErrorBoundary>
      )}
      {openWidgets.has("telegram") && (
        <ErrorBoundary>
          <FloatingWidget
            title="Telegram"
            icon={<HugeiconsIcon icon={TelegramIcon} size={14} className="text-accent" />}
            onClose={() => toggleWidget("telegram")}
            defaultWidth={400} defaultHeight={520}
          >
            <TelegramView onBack={() => toggleWidget("telegram")} />
          </FloatingWidget>
        </ErrorBoundary>
      )}
    </div>
  );
};
