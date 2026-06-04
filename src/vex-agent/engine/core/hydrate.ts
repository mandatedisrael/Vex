/**
 * Session hydration — reconstruct engine state from DB.
 *
 * Loads session, messages, mission (if any), active run, summary.
 * loadedDocuments starts empty and is populated at tool-dispatch time
 * (e.g. knowledge_get injects fetched entry content under a `knowledge:{id}` key).
 */

import { z } from "zod";
import type { EngineContext, Permission, SessionKind, WalletPolicy } from "../types.js";
import type { WalletResolution } from "@tools/wallet/multi-auth.js";
import * as sessionsRepo from "@vex-agent/db/repos/sessions.js";
import * as messagesRepo from "@vex-agent/db/repos/messages.js";
import * as missionsRepo from "@vex-agent/db/repos/missions.js";
import * as missionRunsRepo from "@vex-agent/db/repos/mission-runs.js";
import * as sessionLinksRepo from "@vex-agent/db/repos/session-links.js";
import { loadPersona } from "../../../lib/persona.js";
import { PERSONA_FILE } from "@config/paths.js";

export interface HydratedSession {
  context: EngineContext;
  messages: messagesRepo.Message[];
  summary: string | null;
  /** Session's token count — used for checkpoint evaluation. */
  tokenCount: number;
}

/**
 * Hydrate an engine session from DB state.
 * Returns null if session doesn't exist.
 *
 * `loadedDocuments` is left empty — it is populated at tool-dispatch time
 * (e.g. knowledge_get injects fetched entry content).
 *
 * `sessionKind` and `sessionPermission` are immutable per session.
 * `sessionKind` defaults to `session.mode` from DB; if an active mission
 * is attached we surface `"mission"` regardless. `sessionPermission`
 * mirrors `session.permission` and is the single source for approval
 * gates throughout the turn — no per-call DB queries downstream.
 */
const FrozenAllowedWalletsSchema = z
  .object({ allowedWallets: z.array(z.string()).nullable().optional() })
  .passthrough();

/**
 * Resolve the mission wallet policy from the ACTIVE run's frozen contract
 * snapshot (not the live mission row, which can drift back to draft/edit).
 * A mission with no active run, or a missing/malformed/empty snapshot, is
 * `invalid` → wallet resolution fails closed (contract drift).
 */
export function resolveWalletPolicy(
  mission: missionsRepo.Mission | null,
  activeRun: missionRunsRepo.MissionRun | null,
): WalletPolicy {
  if (activeRun) {
    const frozen = (activeRun.contractSnapshotJson as { frozenMission?: unknown } | null)
      ?.frozenMission;
    const parsed = FrozenAllowedWalletsSchema.safeParse(frozen ?? null);
    if (!parsed.success) return { kind: "invalid", reason: "missing_or_malformed_snapshot" };
    const allowed = parsed.data.allowedWallets ?? [];
    if (allowed.length === 0) return { kind: "invalid", reason: "empty_allowed_wallets" };
    return { kind: "mission_allowed", allowedWallets: allowed };
  }
  // Mission in setup (no active run yet) has no accepted snapshot → fail closed.
  if (mission) return { kind: "invalid", reason: "mission_without_active_run" };
  return { kind: "none" };
}

/**
 * Build a session-scoped WalletResolution from a hydrated context's selection.
 * Engine sessions ALWAYS use source:"session" — a null family selection makes
 * wallet tools for that family fail closed (no fall-through to primary).
 */
export function buildSessionWalletResolution(ctx: {
  selectedEvmWallet: { id: string; address: string } | null;
  selectedSolanaWallet: { id: string; address: string } | null;
}): WalletResolution {
  return { source: "session", evm: ctx.selectedEvmWallet, solana: ctx.selectedSolanaWallet };
}

export async function hydrateEngineSession(sessionId: string): Promise<HydratedSession | null> {
  const session = await sessionsRepo.getSession(sessionId);
  if (!session) return null;

  // Load messages
  const messages = await messagesRepo.getLiveMessages(sessionId);

  // Determine if this is a subagent
  const parentLink = await sessionLinksRepo.getParentSession(sessionId);
  const isSubagent = parentLink !== null;

  // Load active mission (excludes completed/failed/cancelled)
  const mission = await missionsRepo.getActiveMission(sessionId);
  let activeRun: missionRunsRepo.MissionRun | null = null;
  let missionRunId: string | null = null;

  if (mission) {
    activeRun = await missionRunsRepo.getActiveRun(mission.id);
    if (activeRun) {
      missionRunId = activeRun.id;
    }
  }

  // Mode discrimination: a session with an attached active mission acts as
  // "mission" regardless of the row's `mode` column. Sessions without a
  // mission fall through to whatever `mode` the row was created with — only
  // `"agent"` is observed today since mission setup creates the mission row
  // synchronously (see Commit C mission creation pipeline).
  const sessionKind: SessionKind = mission ? "mission" : session.mode;
  const sessionPermission: Permission = session.permission;

  // Local-first user persona (name + optional tone block). Best-effort read —
  // a missing/malformed persona.md degrades to the default ("Vex", no block).
  const persona = loadPersona(PERSONA_FILE);

  return {
    context: {
      sessionId,
      sessionKind,
      sessionPermission,
      missionId: mission?.id ?? null,
      missionRunId,
      sessionStartedAt: session.startedAt,
      missionRunStartedAt: activeRun?.startedAt ?? null,
      missionDeadline: extractMissionDeadline(mission?.constraintsJson ?? null),
      isSubagent,
      selectedEvmWallet: session.selectedEvmWallet,
      selectedSolanaWallet: session.selectedSolanaWallet,
      walletPolicy: resolveWalletPolicy(mission, activeRun),
      loadedDocuments: new Map(), // Populated by caller
      personaName: persona.name,
      personaBlock: persona.block,
      personaConfigured: persona.configured,
    },
    messages,
    summary: session.summary ?? null,
    tokenCount: session.tokenCount,
  };
}

function extractMissionDeadline(constraints: Record<string, unknown> | null): string | null {
  const raw = constraints?.deadline;
  return typeof raw === "string" && raw.trim().length > 0 ? raw : null;
}
