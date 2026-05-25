/**
 * Phase-6 acceptance projection + renewedFromMissionId coverage for
 * `missions-db.toDraftDto`. Split out of `missions-db.test.ts` so
 * the parent suite stays under the 350-LOC budget (codex puzzle 04
 * phase 6 review #2).
 *
 * Codex review #4 hard requirement: acceptance projection is strict
 * 4-of-4. Any partial state (which the DB CHECK constraint
 * `chk_missions_acceptance_atomicity` normally rejects, but a manual
 * SQL edit could slip past) collapses to `acceptance: null` plus a
 * warn log — never a partial accepted block reaching the renderer.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type QueryFn = (
  text: string,
  params?: readonly unknown[],
) => Promise<{ rows: ReadonlyArray<Record<string, unknown>> }>;

const mocks = vi.hoisted(() => ({
  query: vi.fn() as QueryFn,
  connect: vi.fn(),
  end: vi.fn(),
  buildPoolConfig: vi.fn(),
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("pg", () => {
  function MockClient() {
    return {
      connect: mocks.connect,
      end: mocks.end,
      query: mocks.query,
    };
  }
  return { Client: MockClient };
});

vi.mock("../db-config.js", () => ({
  buildPoolConfig: mocks.buildPoolConfig,
}));

vi.mock("../../logger/index.js", () => ({ log: mocks.log }));

const { getDraftForSession } = await import("../missions-db.js");

const SESSION = "00000000-0000-4000-8000-00000000cccc";
const ISO = "2026-05-21T10:00:00.000Z";

interface RowOverrides {
  readonly id?: string;
  readonly status?: string;
  readonly accepted_contract_hash?: string | null;
  readonly accepted_contract_at?: string | null;
  readonly accepted_contract_by?: string | null;
  readonly contract_hash_version?: number | null;
  readonly renewed_from_mission_id?: string | null;
}

function makeRow(overrides: RowOverrides = {}): Record<string, unknown> {
  return {
    id: overrides.id ?? "mission-acc",
    root_session_id: SESSION,
    status: overrides.status ?? "draft",
    title: null,
    goal: null,
    constraints_json: {},
    success_criteria_json: [],
    stop_conditions_json: [],
    risk_profile: null,
    allowed_protocols: [],
    allowed_chains: [],
    allowed_wallets: [],
    created_at: ISO,
    updated_at: ISO,
    approved_at: null,
    accepted_contract_hash: overrides.accepted_contract_hash ?? null,
    accepted_contract_at: overrides.accepted_contract_at ?? null,
    accepted_contract_by: overrides.accepted_contract_by ?? null,
    contract_hash_version: overrides.contract_hash_version ?? null,
    renewed_from_mission_id: overrides.renewed_from_mission_id ?? null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.buildPoolConfig.mockResolvedValue({
    host: "127.0.0.1",
    port: 5777,
    database: "vex",
    user: "vex",
    password: "secret",
  });
  mocks.connect.mockResolvedValue(undefined);
  mocks.end.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("missions-db acceptance projection", () => {
  it("projects the acceptance four-tuple when ALL columns are non-null", async () => {
    mocks.query.mockResolvedValueOnce({
      rows: [
        makeRow({
          accepted_contract_hash: "a".repeat(64),
          accepted_contract_at: "2026-05-21T10:30:00.000Z",
          accepted_contract_by: "host",
          contract_hash_version: 1,
        }),
      ],
    });
    const result = await getDraftForSession(SESSION);
    expect(result.ok).toBe(true);
    if (!result.ok || result.data === null) return;
    expect(result.data.acceptance).toEqual({
      contractHash: "a".repeat(64),
      acceptedAt: "2026-05-21T10:30:00.000Z",
      acceptedBy: "host",
      contractHashVersion: 1,
    });
  });

  it("returns acceptance=null when ALL acceptance columns are null", async () => {
    mocks.query.mockResolvedValueOnce({
      rows: [makeRow({ id: "mission-unacc" })],
    });
    const result = await getDraftForSession(SESSION);
    expect(result.ok).toBe(true);
    if (!result.ok || result.data === null) return;
    expect(result.data.acceptance).toBeNull();
  });

  it("collapses 3-of-4 partial acceptance state to null + warn log (defensive)", async () => {
    // 3-of-4: hash + at + by set, version null. DB CHECK normally
    // rejects this — defensive path in case a manual SQL edit slips
    // it past. The mapper must NOT surface a partial accepted block.
    mocks.query.mockResolvedValueOnce({
      rows: [
        makeRow({
          id: "mission-partial",
          accepted_contract_hash: "a".repeat(64),
          accepted_contract_at: "2026-05-21T10:30:00.000Z",
          accepted_contract_by: "host",
          contract_hash_version: null,
        }),
      ],
    });
    const result = await getDraftForSession(SESSION);
    expect(result.ok).toBe(true);
    if (!result.ok || result.data === null) return;
    expect(result.data.acceptance).toBeNull();
    expect(mocks.log.warn).toHaveBeenCalledWith(
      expect.stringContaining("partial acceptance row for mission mission-partial"),
    );
  });

  it("projects renewedFromMissionId when set", async () => {
    mocks.query.mockResolvedValueOnce({
      rows: [
        makeRow({
          id: "mission-renewed",
          renewed_from_mission_id: "mission-source",
        }),
      ],
    });
    const result = await getDraftForSession(SESSION);
    expect(result.ok).toBe(true);
    if (!result.ok || result.data === null) return;
    expect(result.data.renewedFromMissionId).toBe("mission-source");
  });

  it("returns status='ready' rows so the contract card survives acceptance", async () => {
    // Before phase 7 the filter was `status = 'draft'`, which dropped
    // the card the moment the engine flipped the row to `ready`. The
    // mapper must now expose ready rows so the Accept button can stay
    // mounted right through host acceptance.
    mocks.query.mockResolvedValueOnce({
      rows: [
        makeRow({
          id: "mission-ready",
          status: "ready",
          accepted_contract_hash: "a".repeat(64),
          accepted_contract_at: "2026-05-22T08:00:00.000Z",
          accepted_contract_by: "host",
          contract_hash_version: 1,
        }),
      ],
    });
    const result = await getDraftForSession(SESSION);
    expect(result.ok).toBe(true);
    if (!result.ok || result.data === null) {
      expect.fail("Expected ready row to be returned");
      return;
    }
    expect(result.data.status).toBe("ready");
    expect(result.data.acceptance).not.toBeNull();
  });

  it("returns row with status='ready' even when acceptance is null (dirty contract case)", async () => {
    // status=ready + acceptance=null happens when the draft was edited
    // after a previous acceptance was wiped. Card needs to render so
    // the user can re-accept.
    mocks.query.mockResolvedValueOnce({
      rows: [
        makeRow({
          id: "mission-ready-unacc",
          status: "ready",
        }),
      ],
    });
    const result = await getDraftForSession(SESSION);
    expect(result.ok).toBe(true);
    if (!result.ok || result.data === null) return;
    expect(result.data.status).toBe("ready");
    expect(result.data.acceptance).toBeNull();
  });
});
