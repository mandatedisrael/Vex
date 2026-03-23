/**
 * Ops widget — operational controls: backup, restore, billing, soul edit, settings.
 * Accessible via sidebar or floating widget.
 */

import { type FC, useState, useEffect, useCallback } from "react";
import { triggerBackup, triggerRestore, getBackups, getBilling, getSoul, updateSoul, getAgentConfig, updateAgentConfig, type AgentConfig } from "../api";
import type { BillingState } from "../types";
import { cn } from "../utils";
import {
  HugeiconsIcon,
  Settings02Icon,
  AiWebBrowsingIcon,
  SlidersHorizontalIcon,
  SystemUpdate01Icon,
  CheckmarkCircle02Icon,
  AlertCircleIcon,
} from "../components/icons";

interface OpsWidgetProps {
  onBack: () => void;
}

export const OpsWidget: FC<OpsWidgetProps> = ({ onBack }) => {
  const [tab, setTab] = useState<"backup" | "billing" | "soul" | "settings">("backup");
  const [backups, setBackups] = useState<Array<Record<string, unknown>>>([]);
  const [billing, setBilling] = useState<BillingState | null>(null);
  const [soul, setSoul] = useState("");
  const [restoreHash, setRestoreHash] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [config, setConfig] = useState<AgentConfig | null>(null);

  // Settings form state
  const [contextLimit, setContextLimit] = useState(66000);
  const [tavilyKey, setTavilyKey] = useState("");

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      if (tab === "backup") {
        const res = await getBackups();
        if (signal?.aborted) return;
        setBackups(res.backups);
      } else if (tab === "billing") {
        const res = await getBilling();
        if (signal?.aborted) return;
        setBilling(res);
      } else if (tab === "soul") {
        const res = await getSoul();
        if (signal?.aborted) return;
        setSoul(res.content ?? "");
      } else if (tab === "settings") {
        const res = await getAgentConfig();
        if (signal?.aborted) return;
        setConfig(res);
        setContextLimit(res.contextLimit);
      }
    } catch (err) {
      if (signal?.aborted) return;
      console.warn("[OpsWidget] load failed:", err);
      setMessage(`Failed to load: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (!signal?.aborted) setLoading(false);
  }, [tab]);

  useEffect(() => {
    const ac = new AbortController();
    load(ac.signal);
    return () => ac.abort();
  }, [load]);

  // Fetch config on mount for header status
  useEffect(() => {
    getAgentConfig().then(c => setConfig(c)).catch(() => setConfig(null));
  }, []);

  const handleBackup = async () => {
    setLoading(true); setMessage(null);
    try {
      const res = await triggerBackup();
      const backup = res.backup as Record<string, unknown>;
      setMessage(`Backup complete! Root: ${String(backup.rootHash).slice(0, 20)}...`);
      load();
    } catch (err) {
      setMessage(`Backup failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    setLoading(false);
  };

  const handleRestore = async () => {
    if (!restoreHash.startsWith("0x")) { setMessage("Root hash must start with 0x"); return; }
    setLoading(true); setMessage(null);
    try {
      await triggerRestore(restoreHash);
      setMessage("Restore complete!");
      setRestoreHash("");
    } catch (err) {
      setMessage(`Restore failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    setLoading(false);
  };

  const handleSaveSoul = async () => {
    setLoading(true);
    try { await updateSoul(soul); setMessage("Soul updated"); } catch { setMessage("Failed to save soul"); }
    setLoading(false);
  };

  const handleSaveContextLimit = async () => {
    setLoading(true); setMessage(null);
    try {
      await updateAgentConfig({ contextLimit });
      setMessage("Context limit updated");
      load();
    } catch (err) {
      setMessage(`Failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    setLoading(false);
  };

  const handleSaveTavily = async () => {
    if (!tavilyKey.trim()) return;
    setLoading(true); setMessage(null);
    try {
      await updateAgentConfig({ tavilyApiKey: tavilyKey });
      setMessage("Tavily API key saved! Web search is now active.");
      setTavilyKey("");
      load();
    } catch (err) {
      setMessage(`Failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    setLoading(false);
  };

  const tabs = [
    { key: "backup" as const, label: "Backup" },
    { key: "billing" as const, label: "Billing" },
    { key: "soul" as const, label: "Soul" },
    { key: "settings" as const, label: "Settings" },
  ];

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-4 px-4 py-3 border-b border-border">
        <button onClick={onBack} className="text-muted-foreground hover:text-foreground text-sm transition">&larr;</button>
        <h2 className="text-sm font-semibold text-foreground">Operations</h2>
        {config && (
          <div className="ml-auto flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <span className={`h-1.5 w-1.5 rounded-full ${config.tavilyConfigured ? "bg-status-ok" : "bg-muted-foreground"}`} />
              <span className="text-2xs text-muted-foreground">{config.tavilyConfigured ? "Search" : "No search"}</span>
            </div>
            <span className="text-2xs text-muted-foreground">v{config.version}</span>
          </div>
        )}
      </div>

      <div className="flex gap-1 px-4 py-2 border-b border-border">
        {tabs.map(t => (
          <button key={t.key} onClick={() => { setTab(t.key); setMessage(null); }}
            className={cn("px-3 py-1.5 text-xs rounded-lg transition", tab === t.key ? "bg-accent/20 text-accent" : "text-muted-foreground hover:text-foreground")}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {message && (
          <div className={cn("text-xs px-3 py-2 rounded-lg", message.includes("failed") || message.includes("Failed") ? "bg-status-error/10 text-status-error" : "bg-status-ok/10 text-status-ok")}>
            {message}
          </div>
        )}

        {tab === "backup" && (
          <>
            <button onClick={handleBackup} disabled={loading}
              className="w-full px-4 py-2 text-sm font-medium rounded-lg bg-accent/15 text-accent hover:bg-accent/25 transition disabled:opacity-50">
              {loading ? "Backing up..." : "Backup Now"}
            </button>

            <div className="flex gap-2">
              <input value={restoreHash} onChange={e => setRestoreHash(e.target.value)}
                placeholder="0x... root hash" className="flex-1 px-3 py-2 text-xs rounded-lg bg-card border border-border text-foreground placeholder:text-muted-foreground" />
              <button onClick={handleRestore} disabled={loading || !restoreHash}
                className="px-4 py-2 text-xs font-medium rounded-lg bg-card border border-border text-foreground hover:bg-accent/10 transition disabled:opacity-50">
                Restore
              </button>
            </div>

            <div className="text-2xs text-muted-foreground font-medium uppercase tracking-wide mt-2">Recent Backups</div>
            {backups.map((b, i) => (
              <div key={i} className="text-xs text-muted-foreground px-3 py-2 rounded-lg bg-card border border-border">
                <div className="font-mono text-foreground truncate">{String(b.rootHash)}</div>
                <div className="flex gap-3 mt-1">
                  <span>{b.fileCount as number} files</span>
                  <span>{b.trigger as string}</span>
                  <span>{String(b.createdAt).slice(0, 16)}</span>
                </div>
              </div>
            ))}
            {backups.length === 0 && !loading && <div className="text-xs text-muted-foreground">No backups yet.</div>}
          </>
        )}

        {tab === "billing" && (
          billing ? (
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Model</span><span className="text-foreground font-medium">{billing.model}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Ledger Available</span><span className="text-foreground">{billing.ledgerAvailableOg.toFixed(4)} 0G</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Provider Locked</span><span className="text-foreground">{billing.providerLockedOg.toFixed(4)} 0G</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Session Burn</span><span className="text-foreground">{billing.sessionBurnOg.toFixed(6)} 0G</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Lifetime Burn</span><span className="text-foreground">{billing.lifetimeBurnOg.toFixed(4)} 0G</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Avg Cost/Request</span><span className="text-foreground">{billing.avgCostPerRequest.toFixed(6)} 0G</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Est. Remaining</span><span className="text-foreground">~{billing.estimatedRequestsRemaining} requests</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Pricing (in/out per M)</span><span className="text-foreground">{billing.pricing.inputPerM} / {billing.pricing.outputPerM}</span></div>
              {billing.isLowBalance && <div className="text-status-error text-xs font-medium mt-2">Low balance warning active</div>}
            </div>
          ) : !loading ? (
            <div className="text-xs text-muted-foreground text-center py-8">No billing data available.</div>
          ) : null
        )}

        {tab === "soul" && (
          <>
            <textarea value={soul} onChange={e => setSoul(e.target.value)} rows={12}
              className="w-full px-3 py-2 text-sm rounded-lg bg-card border border-border text-foreground font-mono resize-y" />
            <button onClick={handleSaveSoul} disabled={loading}
              className="px-4 py-2 text-sm font-medium rounded-lg bg-accent/15 text-accent hover:bg-accent/25 transition disabled:opacity-50">
              Save Soul
            </button>
          </>
        )}

        {tab === "settings" && (
          <div className="space-y-5">
            {/* Context Limit */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <HugeiconsIcon icon={SlidersHorizontalIcon} className="h-4 w-4 text-accent" />
                <span className="text-sm font-medium text-foreground">Context Limit</span>
              </div>
              <p className="text-2xs text-muted-foreground">
                Maximum tokens per session. Compaction triggers at 75% of this value.
              </p>
              <div className="flex gap-2">
                <input type="number" value={contextLimit} onChange={e => setContextLimit(Number(e.target.value))}
                  min={10000} max={200000} step={1000}
                  className="flex-1 px-3 py-2 text-sm rounded-lg bg-card border border-border text-foreground font-mono" />
                <button onClick={handleSaveContextLimit} disabled={loading}
                  className="px-4 py-2 text-xs font-medium rounded-lg bg-accent/15 text-accent hover:bg-accent/25 transition disabled:opacity-50">
                  Save
                </button>
              </div>
              <p className="text-2xs text-muted-foreground">
                Compaction at: ~{Math.round(contextLimit * (config?.compactionThreshold ?? 0.75)).toLocaleString()} tokens
              </p>
            </div>

            {/* Tavily Web Search */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <HugeiconsIcon icon={AiWebBrowsingIcon} className="h-4 w-4 text-accent" />
                <span className="text-sm font-medium text-foreground">Web Search (Tavily)</span>
                {config && (
                  <HugeiconsIcon
                    icon={config.tavilyConfigured ? CheckmarkCircle02Icon : AlertCircleIcon}
                    className={cn("h-3.5 w-3.5 ml-auto", config.tavilyConfigured ? "text-status-ok" : "text-muted-foreground")}
                  />
                )}
              </div>
              <p className="text-2xs text-muted-foreground">
                Web search lets your agent research tokens, projects, news, and documentation from the internet.
              </p>
              <div className="flex gap-2">
                <input type="password" value={tavilyKey} onChange={e => setTavilyKey(e.target.value)}
                  placeholder={config?.tavilyConfigured ? "tvly-•••• (configured)" : "tvly-... paste your API key"}
                  className="flex-1 px-3 py-2 text-sm rounded-lg bg-card border border-border text-foreground placeholder:text-muted-foreground font-mono" />
                <button onClick={handleSaveTavily} disabled={loading || !tavilyKey.trim()}
                  className="px-4 py-2 text-xs font-medium rounded-lg bg-accent/15 text-accent hover:bg-accent/25 transition disabled:opacity-50">
                  Save
                </button>
              </div>
              <div className="text-2xs text-muted-foreground space-y-1 mt-1">
                <p className="font-medium">How to get a free API key:</p>
                <ol className="list-decimal list-inside space-y-0.5 ml-1">
                  <li>Go to <a href="https://tavily.com" target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">tavily.com</a> and sign up</li>
                  <li>Copy your API key from the dashboard</li>
                  <li>Paste it above and click Save</li>
                </ol>
                <p className="text-muted-foreground/60 mt-1">Free tier: 1,000 credits/month, no credit card needed.</p>
              </div>
            </div>

            {/* Version */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <HugeiconsIcon icon={SystemUpdate01Icon} className="h-4 w-4 text-accent" />
                <span className="text-sm font-medium text-foreground">Version</span>
              </div>
              {config && (
                <div className="text-sm text-muted-foreground">
                  <span className="text-foreground font-mono">v{config.version}</span>
                  <span className="ml-2">Uptime: {formatUptime(config.uptime)}</span>
                </div>
              )}
            </div>
          </div>
        )}

        {loading && <div className="flex justify-center py-4"><div className="h-5 w-5 rounded-full border-2 border-accent/30 border-t-accent animate-spin" /></div>}
      </div>
    </div>
  );
};

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}
