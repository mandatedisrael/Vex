import React from "react";
import { Box, Text } from "ink";
import { readAppEnvMap } from "../../../../../src/cli/setup/status.js";
import { getOpenAITools } from "../../../../../src/vex-agent/tools/registry.js";
import {
  type MissionRunStatus,
  ACTIVE_OR_PAUSED_RUN_STATUSES,
} from "../../../../../src/vex-agent/engine/types.js";
import {
  abortActiveMission,
  approveById,
  rejectById,
  startReadyMission,
  switchProviderFlow,
} from "../../../engine-actions.js";
import {
  createShellSession,
  endShellSession,
  summarizeSession,
} from "../../../platform/session-host.js";
import type { Store } from "../../state/store.js";
import { useStore } from "../../state/store.js";
import { Hint, Label, maskSecret } from "./shared.js";
import { moveCursor, setToast, startEdit, type InkKey, hydrateTabData } from "./logic.js";

export function handleProviderInput(store: Store, input: string): void {
  if (input === "k") {
    startEdit(store, {
      tab: "provider",
      field: "OPENROUTER_API_KEY",
      kind: "secret",
      value: "",
      placeholder: "OpenRouter API key",
    });
    return;
  }
  if (input === "m") {
    startEdit(store, {
      tab: "provider",
      field: "AGENT_MODEL",
      kind: "text",
      value: process.env.AGENT_MODEL ?? "",
      placeholder: "model id from openrouter.ai/models",
      validate: (v) => (v.trim() ? null : "Model id required"),
    });
    return;
  }
  if (input === "o") {
    void (async () => {
      const result = await switchProviderFlow("openrouter");
      if (result.ok) {
        store.setState({
          provider: { name: "openrouter", detail: `model=${process.env.AGENT_MODEL ?? "?"}` },
        });
        setToast(store, "ok", "Switched to OpenRouter.");
      } else {
        setToast(store, "error", result.error);
      }
    })();
  }
}

export function ProviderTab({ store }: { store: Store }): React.JSX.Element {
  const provider = useStore(store, (s) => s.provider);
  const envMap = readAppEnvMap();
  return (
    <Box flexDirection="column">
      <Label>Active provider</Label>
      <Text>
        {provider.name}
        {provider.detail ? ` — ${provider.detail}` : ""}
      </Text>
      <Box marginTop={1} flexDirection="column">
        <Label>OpenRouter</Label>
        <Text>API key: {maskSecret(envMap.OPENROUTER_API_KEY)}</Text>
        <Text>Model:   {envMap.AGENT_MODEL ?? "<unset>"}</Text>
      </Box>
      <Box marginTop={1}>
        <Hint>k — edit API key. m — edit model id. o — activate OpenRouter.</Hint>
      </Box>
    </Box>
  );
}

export function handleSessionInput(store: Store, input: string, key: InkKey): void {
  const recent = store.getState().recentSessions;
  moveCursor(store, recent.length || 1, key);

  if (input === "n") {
    void (async () => {
      const { mode, permission } = store.getState();
      try {
        const id = await createShellSession({ mode, permission });
        const summary = await summarizeSession(id);
        store.setState({ session: summary ?? null });
        await hydrateTabData(store, "session");
        setToast(store, "ok", `New ${mode} session: ${id.slice(0, 16)}…`);
      } catch (err) {
        setToast(store, "error", err instanceof Error ? err.message : String(err));
      }
    })();
  }
  if (input === "e") {
    const session = store.getState().session;
    if (!session) {
      setToast(store, "error", "No active session.");
      return;
    }
    void (async () => {
      try {
        await endShellSession(session.id);
        store.setState({ session: null });
        await hydrateTabData(store, "session");
        setToast(store, "ok", `Ended session ${session.id.slice(0, 16)}…`);
      } catch (err) {
        setToast(store, "error", err instanceof Error ? err.message : String(err));
      }
    })();
  }
  if (key.return) {
    const cursor = store.getState().settingsCursor;
    const target = recent[cursor];
    if (!target) return;
    void (async () => {
      try {
        const summary = await summarizeSession(target.id);
        store.setState({ session: summary ?? null });
        setToast(store, "ok", `Resumed ${target.id.slice(0, 16)}…`);
      } catch (err) {
        setToast(store, "error", err instanceof Error ? err.message : String(err));
      }
    })();
  }
}

export function SessionTab({ store }: { store: Store }): React.JSX.Element {
  const session = useStore(store, (s) => s.session);
  const mode = useStore(store, (s) => s.mode);
  const recent = useStore(store, (s) => s.recentSessions);
  const cursor = useStore(store, (s) => s.settingsCursor);
  return (
    <Box flexDirection="column">
      <Label>Active session</Label>
      {session ? (
        <Box flexDirection="column">
          <Text>id:      {session.id}</Text>
          <Text>kind:    {session.kind}</Text>
          <Text>mission: {session.missionStatus ?? "none"}</Text>
          <Text>pending: {session.pendingApprovals} approvals</Text>
        </Box>
      ) : (
        <Text color="yellow">No active session.</Text>
      )}
      <Box marginTop={1} flexDirection="column">
        <Label>Recent sessions ({recent.length})</Label>
        {recent.length === 0 ? <Text dimColor>(none)</Text> : null}
        {recent.map((s, idx) => (
          <Text key={s.id} color={idx === cursor ? "cyan" : undefined}>
            {`${idx === cursor ? "›" : " "} ${s.id.slice(0, 22)}… kind=${s.kind} msgs=${s.messageCount}`}
          </Text>
        ))}
      </Box>
      <Box marginTop={1}>
        <Hint>{`Wizard intent: ${mode}. n — new. e — end current. ↑↓ select. Enter — resume.`}</Hint>
      </Box>
    </Box>
  );
}

export function handleMissionInput(store: Store, input: string): void {
  const session = store.getState().session;
  if (!session) {
    setToast(store, "error", "No active session.");
    return;
  }
  if (input === "s") {
    void (async () => {
      const permission = store.getState().permission;
      const result = await startReadyMission(session.id);
      if (result.ok) {
        setToast(store, "ok", `Mission started (${permission}). status=${result.value.missionStatus ?? "running"}`);
      } else {
        setToast(store, "error", `${result.error}${result.hint ? ` (${result.hint})` : ""}`);
      }
    })();
  }
  if (input === "a") {
    void (async () => {
      const result = await abortActiveMission(session.id);
      if (result.ok) {
        setToast(
          store,
          result.value.aborted ? "ok" : "error",
          result.value.aborted
            ? `Mission aborted. status=${result.value.status}, rejected ${result.value.rejectedApprovals} approvals.`
            : "Nothing to abort (no active run).",
        );
      } else {
        setToast(store, "error", result.error);
      }
    })();
  }
}

export function MissionTab({ store }: { store: Store }): React.JSX.Element {
  const session = useStore(store, (s) => s.session);
  const permission = useStore(store, (s) => s.permission);
  return (
    <Box flexDirection="column">
      <Label>Mission</Label>
      <Text>Session status: {session?.missionStatus ?? "none"}</Text>
      <Text>Start command: {session?.missionCommand ? `/mission ${session.missionCommand}` : "none"}</Text>
      <Text>Permission: {permission}</Text>
      <Text dimColor>
        Mission setup happens through chat input or via wizard. Start/continue runs under the
        session's permission policy.
      </Text>
      <Box marginTop={1}>
        <Hint>s — start/continue ready mission. a — stop active run.</Hint>
      </Box>
    </Box>
  );
}

export function handleApprovalsInput(store: Store, input: string, key: InkKey): void {
  const approvals = store.getState().approvals;
  moveCursor(store, approvals.length || 1, key);
  const cursor = store.getState().settingsCursor;
  const target = approvals[cursor];

  if (input === "a" && target) {
    void (async () => {
      store.getState().reporter?.recordEvent({
        kind: "approval",
        approvalId: target.id,
        decision: "approve",
        source: "hotkey",
        toolName: target.tool,
      });
      const result = await approveById(target.id);
      if (!result.ok) {
        store.getState().reporter?.recordEvent({
          kind: "error",
          where: "approve",
          message: result.error,
        });
      }
      setToast(
        store,
        result.ok ? "ok" : "error",
        result.ok ? `Approved ${target.tool} (${target.id.slice(0, 12)}…)` : result.error,
      );
    })();
  }
  if (input === "r" && target) {
    void (async () => {
      store.getState().reporter?.recordEvent({
        kind: "approval",
        approvalId: target.id,
        decision: "reject",
        source: "hotkey",
        toolName: target.tool,
      });
      const result = await rejectById(target.id);
      if (result.ok) {
        setToast(
          store,
          result.value.rejected ? "ok" : "error",
          result.value.rejected ? `Rejected ${target.tool}.` : "Already resolved (no-op).",
        );
      } else {
        setToast(store, "error", result.error);
        store.getState().reporter?.recordEvent({
          kind: "error",
          where: "reject",
          message: result.error,
        });
      }
    })();
  }
  if (input === "A") {
    void (async () => {
      const reporter = store.getState().reporter;
      let okCount = 0;
      for (const a of approvals) {
        reporter?.recordEvent({
          kind: "approval",
          approvalId: a.id,
          decision: "approve",
          source: "hotkey",
          toolName: a.tool,
        });
        const result = await approveById(a.id);
        if (result.ok) {
          okCount += 1;
        } else {
          reporter?.recordEvent({
            kind: "error",
            where: "approve",
            message: result.error,
          });
        }
      }
      setToast(store, "ok", `Approved ${okCount}/${approvals.length}`);
    })();
  }
}

export function ApprovalsTab({ store }: { store: Store }): React.JSX.Element {
  const approvals = useStore(store, (s) => s.approvals);
  const cursor = useStore(store, (s) => s.settingsCursor);
  if (approvals.length === 0) {
    return (
      <Box flexDirection="column">
        <Label>Approvals</Label>
        <Text dimColor>No pending approvals.</Text>
      </Box>
    );
  }
  return (
    <Box flexDirection="column">
      <Label>Pending approvals ({approvals.length})</Label>
      {approvals.map((a, idx) => (
        <Box key={a.id} flexDirection="column" marginTop={1}>
          <Text color={idx === cursor ? "cyan" : "yellow"}>
            {`${idx === cursor ? "›" : " "} ${a.id.slice(0, 18)}…  tool=${a.tool}`}
          </Text>
          {a.reasoning ? <Text dimColor>{`  ${a.reasoning}`}</Text> : null}
        </Box>
      ))}
      <Box marginTop={1}>
        <Hint>↑↓ select. a — approve. r — reject. A — approve all.</Hint>
      </Box>
    </Box>
  );
}

function getCurrentTools(store: Store): { name: string }[] {
  const state = store.getState();
  const session = state.session;
  const missionRunActive = ACTIVE_OR_PAUSED_RUN_STATUSES.has(
    (session?.missionStatus ?? "") as MissionRunStatus,
  );
  const kind: "agent" | "mission" =
    session?.kind === "mission" ? "mission" : "agent";
  return getOpenAITools({
    permission: state.permission,
    role: "parent",
    sessionKind: kind,
    missionRunActive,
    contextUsageBand: "normal",
  }).map((t) => ({ name: t.function.name }));
}

export function handleToolsInput(store: Store, _input: string, key: InkKey): void {
  const tools = getCurrentTools(store);
  moveCursor(store, tools.length || 1, key);
  if (key.return) {
    const cursor = store.getState().settingsCursor;
    const target = tools[cursor];
    if (!target) return;
    startEdit(store, {
      tab: "tools",
      field: "args",
      kind: "json",
      value: "{}",
      placeholder: target.name,
      validate: (v) => {
        const trimmed = v.trim();
        if (!trimmed) return null;
        try {
          JSON.parse(trimmed);
          return null;
        } catch {
          return "Invalid JSON";
        }
      },
    });
  }
}

export function ToolsTab({ store }: { store: Store }): React.JSX.Element {
  const cursor = useStore(store, (s) => s.settingsCursor);
  const tools = getCurrentTools(store);
  const visible = tools.slice(0, 16);
  return (
    <Box flexDirection="column">
      <Label>{`Tools visible (${tools.length} total)`}</Label>
      {visible.map((t, idx) => (
        <Text key={t.name} color={idx === cursor && idx < visible.length ? "cyan" : undefined}>
          {`${idx === cursor ? "›" : " "} ${t.name}`}
        </Text>
      ))}
      {tools.length > visible.length ? <Hint>… +{tools.length - visible.length} more</Hint> : null}
      <Box marginTop={1}>
        <Hint>↑↓ select. Enter — provide JSON args + run via runTool().</Hint>
      </Box>
    </Box>
  );
}
