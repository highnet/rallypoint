import { connection } from "next/server";
import { cache } from "react";

import { swarmConfig } from "../swarm.config";
import type { SwarmInput } from "../_graph/model";
import type { MeasureMode, SwarmTarget } from "./config-types";
import { fleetLabelSector, toSwarmInput } from "./fleet-graph";
import { word } from "./format";
import {
  deliveryOf,
  githubRepoUrl,
  laneOf,
  LANES,
  listDirectory,
  listItems,
  readFile,
  readPullPaths,
  FLEET_PATH_PULL_LIMIT,
  readDefaultBranch,
  readGithubRepo,
  targetsOf,
  type Delivery,
  type GithubFailure,
  type GithubItem,
  type LaneId,
  type RepoEntry,
} from "./github";
import {
  countRows,
  isAuthError,
  isMissingSchema,
  readSessionToken,
  readSupabaseEnv,
  selectRows,
  type ReadError,
  type ReadResult,
} from "./supabase";
import { buildThreads, filterThreads, type ThreadFilter } from "./threads";
import type {
  BuriedRow,
  ConceptRow,
  ConceptTrialRow,
  FleetRow,
  GoalSetting,
  MessageRow,
  MetricsRow,
  ProgressRow,
  ProtocolChangeRow,
  ResultRow,
  RetroRow,
  SessionRow,
  SettingRow,
  SwarmSettings,
  VersionRow,
} from "./types";

/**
 * Every read the swarm pages make goes through this file. Pages render;
 * they never fetch. Redesign any page freely without touching data code.
 * Nothing here writes.
 */

/* ───────────────────────── Connection state ───────────────────────── */

export type SwarmContext =
  | { state: "unconfigured"; missing: string[] }
  | { state: "unreachable"; message: string }
  | { state: "no-schema"; message: string }
  | { state: "locked"; signedIn: boolean; expired: boolean }
  | { state: "ok"; settings: SwarmSettings; signedIn: boolean };

function foldSettings(rows: SettingRow[]): SwarmSettings {
  const settings: SwarmSettings = {};
  for (const row of rows) {
    if (row.key === "visibility" && (row.value === "public" || row.value === "private")) {
      settings.visibility = row.value;
    } else if (row.key === "protocol_version" && typeof row.value === "string") {
      settings.protocol_version = row.value;
    } else if (row.key === "goal" && row.value && typeof row.value === "object") {
      settings.goal = row.value as GoalSetting;
    }
  }
  return settings;
}

/**
 * Whether memory can be read, once per request. Private swarms hide even
 * `swarm_settings` from the anon key, so an empty settings read without a
 * session means "private, or `swarm init` has not run yet".
 *
 * Every page starts here, so this is where a page becomes request-time.
 * `connection()` waits for a real request before the environment is read:
 * without it, a build with no Supabase variables would prerender "Not
 * connected yet" for good. It works with Cache Components on or off, and is
 * why no page exports `dynamic`. Each page renders inside `loading.tsx`'s
 * Suspense boundary, so the layout's static shell can still be prerendered.
 */
export const getSwarmContext = cache(async (): Promise<SwarmContext> => {
  await connection();
  const { env, missing } = readSupabaseEnv();
  if (!env) return { state: "unconfigured", missing };

  const token = await readSessionToken();
  let read = await selectRows("swarm_settings", { select: "key,value" });
  let expired = false;
  if (!read.ok && token && isAuthError(read.error)) {
    // The session token was refused (expired). Fall back to the anon key.
    expired = true;
    read = await selectRows("swarm_settings", { select: "key,value", anon: true });
  }
  const signedIn = Boolean(token) && !expired;

  if (!read.ok) {
    if (isMissingSchema(read.error)) return { state: "no-schema", message: read.error.message };
    if (isAuthError(read.error)) return { state: "locked", signedIn, expired };
    return { state: "unreachable", message: read.error.message };
  }
  // Signed in but nothing readable: not on the `swarm_readers` allowlist, or
  // `swarm init` has not stored settings yet. Say so instead of empty pages.
  if (read.data.length === 0) return { state: "locked", signedIn, expired };
  const settings = foldSettings(read.data);
  if (settings.visibility === "private" && !signedIn) {
    return { state: "locked", signedIn, expired };
  }
  return { state: "ok", settings, signedIn };
});

export async function isSignedIn(): Promise<boolean> {
  return Boolean(await readSessionToken());
}

/* ───────────────────────── Helpers ───────────────────────── */

type Errors = ReadError[];

function take<T>(result: ReadResult<T>, fallback: T, errors: Errors): T {
  if (result.ok) return result.data;
  errors.push(result.error);
  return fallback;
}

function first<T>(result: ReadResult<T[]>, errors: Errors): T | null {
  return take(result, [] as T[], errors)[0] ?? null;
}

/** The measure mode: the config wins, then the live goal, then "score". */
export function measureMode(settings?: SwarmSettings): MeasureMode {
  return swarmConfig.measure.mode ?? settings?.goal?.measure?.mode ?? "score";
}

/** Config targets first, then any target id found in data but not in config. */
export function resolveTargets(seen: (string | null | undefined)[]): SwarmTarget[] {
  const known = new Map(swarmConfig.targets.map((target) => [target.id, target]));
  const extra: SwarmTarget[] = [];
  for (const id of seen) {
    if (!id || known.has(id) || extra.some((target) => target.id === id)) continue;
    extra.push({ id, name: id, color: "var(--rp-ink-soft)", description: "" });
  }
  return [...swarmConfig.targets, ...extra];
}

export function findTarget(id: string): SwarmTarget | null {
  return swarmConfig.targets.find((target) => target.id === id) ?? null;
}

export type GithubState =
  | { ok: true; items: GithubItem[]; truncated: boolean }
  | GithubFailure;

const getGithubItems = cache(async (): Promise<GithubState> => {
  const read = await listItems();
  if (!read.ok) return read;
  return { ok: true, items: read.data, truncated: read.truncated };
});

/* ───────────────────────── Progress (/swarm) ───────────────────────── */

export type TargetDelivery = { target: SwarmTarget; delivery: Delivery };

export type ProgressData = {
  mode: MeasureMode;
  goal: { title: string; statement: string };
  measureCommand: string | null;
  checkNames: string[];
  metrics: MetricsRow | null;
  sessionCount: number | null;
  versions: VersionRow[];
  results: ResultRow[];
  targets: SwarmTarget[];
  github: GithubState | null;
  delivery: Delivery | null;
  deliveryByTarget: TargetDelivery[];
  /** Working sessions seen in the last two hours, newest first. */
  fleet: FleetRow[];
  /** The newest buried idea, for the "latest" line. */
  lastBuried: BuriedRow | null;
  /** When memory was read (ms since the epoch); charts run up to it. */
  readAt: number;
  errors: Errors;
};

export async function getProgress(settings: SwarmSettings): Promise<ProgressData> {
  const errors: Errors = [];
  const mode = measureMode(settings);
  const [metrics, sessions, versions, results, fleet, buried] = await Promise.all([
    selectRows("swarm_metrics", { limit: 1 }),
    countRows("swarm_sessions"),
    selectRows("swarm_versions", { order: "created_at.asc", limit: 1000 }),
    selectRows("swarm_results", { order: "created_at.desc", limit: 8 }),
    selectRows("swarm_fleet", { order: "last_seen_at.desc", limit: 6 }),
    selectRows("swarm_buried", { order: "created_at.desc", limit: 1 }),
  ]);
  const versionRows = take(versions, [], errors);
  const resultRows = take(results, [], errors);

  let github: GithubState | null = null;
  let delivery: Delivery | null = null;
  const deliveryByTarget: TargetDelivery[] = [];
  const targets = resolveTargets([
    ...versionRows.map((row) => row.target),
    ...resultRows.map((row) => row.target),
  ]);
  if (mode !== "score") {
    github = await getGithubItems();
    if (github.ok) {
      delivery = deliveryOf(github.items);
      for (const target of targets) {
        const scoped = deliveryOf(github.items, target.id);
        if (scoped.total > 0) deliveryByTarget.push({ target, delivery: scoped });
      }
    }
  }

  const goal = settings.goal ?? {};
  return {
    mode,
    goal: {
      title: swarmConfig.goal.title || goal.title || "",
      statement: swarmConfig.goal.statement || goal.statement || "",
    },
    measureCommand: goal.measure?.command || null,
    checkNames: (goal.measure?.checks ?? []).map((check) => check.name),
    metrics: first(metrics, errors),
    sessionCount: take(sessions, null as number | null, errors),
    versions: versionRows,
    results: resultRows,
    targets,
    github,
    delivery,
    deliveryByTarget,
    fleet: take(fleet, [], errors),
    lastBuried: first(buried, errors),
    readAt: Date.now(),
    errors,
  };
}

/** How many agents are working now, for the header's live indicator. */
export async function getWorkingCount(): Promise<number | null> {
  const read = await selectRows("swarm_metrics", { select: "sessions_working", limit: 1 });
  if (!read.ok) return null;
  return read.data[0]?.sessions_working ?? 0;
}

/* ───────────────────────── News ───────────────────────── */

export type NewsItem =
  | { kind: "version"; at: string; row: VersionRow }
  | { kind: "buried"; at: string; row: BuriedRow }
  | { kind: "protocol"; at: string; row: ProtocolChangeRow }
  | { kind: "merged"; at: string; item: GithubItem };

export async function getNews(): Promise<{ items: NewsItem[]; github: GithubState; errors: Errors }> {
  const errors: Errors = [];
  const [versions, buried, changes, github] = await Promise.all([
    selectRows("swarm_versions", { order: "created_at.desc", limit: 20 }),
    selectRows("swarm_buried", { order: "created_at.desc", limit: 20 }),
    selectRows("swarm_protocol_changes", { order: "created_at.desc", limit: 20 }),
    getGithubItems(),
  ]);
  const items: NewsItem[] = [
    ...take(versions, [], errors).map((row): NewsItem => ({ kind: "version", at: row.created_at, row })),
    ...take(buried, [], errors).map((row): NewsItem => ({ kind: "buried", at: row.created_at, row })),
    ...take(changes, [], errors).map((row): NewsItem => ({ kind: "protocol", at: row.created_at, row })),
  ];
  if (github.ok) {
    for (const item of github.items) {
      if (item.isPullRequest && item.mergedAt) items.push({ kind: "merged", at: item.mergedAt, item });
    }
  }
  items.sort((a, b) => b.at.localeCompare(a.at));
  return { items: items.slice(0, 40), github, errors };
}

/* ───────────────────────── Targets ───────────────────────── */

export type TargetSummary = {
  target: SwarmTarget;
  latest: VersionRow | null;
  versions: number;
  results: number;
  passed: number;
  buried: number;
  delivery: Delivery | null;
};

export async function getTargets(): Promise<{ targets: TargetSummary[]; errors: Errors }> {
  const errors: Errors = [];
  const [versions, results, buried, github] = await Promise.all([
    selectRows("swarm_versions", { select: "id,target,version,score,created_at", order: "created_at.desc", limit: 1000 }),
    selectRows("swarm_results", { select: "id,target,passed", limit: 1000 }),
    selectRows("swarm_buried", { select: "id,target", limit: 1000 }),
    getGithubItems(),
  ]);
  const versionRows = take(versions, [], errors);
  const resultRows = take(results, [], errors);
  const buriedRows = take(buried, [], errors);
  const targets = resolveTargets([
    ...versionRows.map((row) => row.target),
    ...resultRows.map((row) => row.target),
    ...buriedRows.map((row) => row.target),
  ]);
  return {
    errors,
    targets: targets.map((target) => {
      const mine = versionRows.filter((row) => row.target === target.id);
      const runs = resultRows.filter((row) => row.target === target.id);
      return {
        target,
        latest: (mine[0] as VersionRow | undefined) ?? null,
        versions: mine.length,
        results: runs.length,
        passed: runs.filter((row) => row.passed).length,
        buried: buriedRows.filter((row) => row.target === target.id).length,
        delivery: github.ok ? deliveryOf(github.items, target.id) : null,
      };
    }),
  };
}

export type TargetDetail = {
  target: SwarmTarget;
  versions: VersionRow[];
  results: ResultRow[];
  buried: BuriedRow[];
  openIssues: GithubItem[];
  delivery: Delivery | null;
  github: GithubState;
  /** When memory was read (ms since the epoch); charts run up to it. */
  readAt: number;
  errors: Errors;
};

/** One target, or null when the id is neither configured nor in memory. */
export async function getTarget(id: string): Promise<TargetDetail | null> {
  const errors: Errors = [];
  const filters = { target: `eq.${id}` };
  const [versions, results, buried, github] = await Promise.all([
    selectRows("swarm_versions", { filters, order: "created_at.desc", limit: 100 }),
    selectRows("swarm_results", { filters, order: "created_at.desc", limit: 50 }),
    selectRows("swarm_buried", { filters, order: "created_at.desc", limit: 50 }),
    getGithubItems(),
  ]);
  const versionRows = take(versions, [], errors);
  const resultRows = take(results, [], errors);
  const buriedRows = take(buried, [], errors);
  const configured = findTarget(id);
  const seen = versionRows.length + resultRows.length + buriedRows.length > 0;
  if (!configured && !seen) return null;
  const target = configured ?? resolveTargets([id]).find((entry) => entry.id === id)!;
  return {
    target,
    versions: versionRows,
    results: resultRows,
    buried: buriedRows,
    openIssues: github.ok
      ? github.items.filter((item) => !item.isPullRequest && item.state === "open" && targetsOf(item).includes(id))
      : [],
    delivery: github.ok ? deliveryOf(github.items, id) : null,
    github,
    readAt: Date.now(),
    errors,
  };
}

/* ───────────────────────── Results (referee runs) ───────────────────────── */

export async function getResults(filter: { target?: string; verdict?: "passed" | "failed" }) {
  const errors: Errors = [];
  const filters: Record<string, string> = {};
  if (filter.target) filters.target = `eq.${filter.target}`;
  if (filter.verdict) filters.passed = `is.${filter.verdict === "passed"}`;
  const [results, all] = await Promise.all([
    selectRows("swarm_results", { filters, order: "created_at.desc", limit: 100 }),
    selectRows("swarm_results", { select: "target", limit: 1000 }),
  ]);
  const rows = take(results, [], errors);
  const targets = resolveTargets(take(all, [], errors).map((row) => row.target));
  return { results: rows, targets, errors };
}

export async function getResult(id: string) {
  if (!/^\d+$/.test(id)) return null;
  const errors: Errors = [];
  const result = first(await selectRows("swarm_results", { filters: { id: `eq.${id}` }, limit: 1 }), errors);
  if (!result) return errors.length > 0 ? { result: null, session: null, errors } : null;
  const session = result.session_id
    ? first(await selectRows("swarm_sessions", { filters: { id: `eq.${result.session_id}` }, limit: 1 }), errors)
    : null;
  return { result, session, errors };
}

/* ───────────────────────── Versions, buried, fleet ───────────────────────── */

export async function getVersions() {
  const errors: Errors = [];
  const versions = take(await selectRows("swarm_versions", { order: "created_at.desc", limit: 200 }), [], errors);
  return { versions, targets: resolveTargets(versions.map((row) => row.target)), errors };
}

export async function getBuried() {
  const errors: Errors = [];
  const buried = take(await selectRows("swarm_buried", { order: "created_at.desc", limit: 200 }), [], errors);
  return { buried, errors };
}

export async function getFleet(): Promise<{ fleet: FleetRow[]; errors: Errors }> {
  const errors: Errors = [];
  const fleet = take(await selectRows("swarm_fleet", { order: "last_seen_at.desc", limit: 100 }), [], errors);
  return { fleet, errors };
}

/* ───────────────────────── Fleet graph ───────────────────────── */

export type FleetGraphData = {
  input: SwarmInput;
  /** Why the graph shows memory only, when GitHub could not be read. */
  githubNote: string | null;
  delivery: Delivery | null;
  errors: Errors;
};

/**
 * Everything the fleet graph draws, as its `SwarmInput` (see
 * `_lib/fleet-graph.ts` for the mapping). Reads the history the replay plays
 * back: recent sessions, progress notes, referee results, shipped versions,
 * buried ideas and protocol changes, plus GitHub's issues and pull requests.
 * Any read may fail; the graph then draws what the others returned.
 */
export async function getFleetGraph(): Promise<FleetGraphData> {
  const errors: Errors = [];
  const [sessions, progress, results, versions, buried, changes, github, defaultBranch] = await Promise.all([
    selectRows("swarm_sessions", { order: "started_at.desc", limit: 500 }),
    selectRows("swarm_progress", { order: "created_at.desc", limit: 1000 }),
    selectRows("swarm_results", { order: "created_at.desc", limit: 500 }),
    selectRows("swarm_versions", { order: "created_at.desc", limit: 500 }),
    selectRows("swarm_buried", { order: "created_at.desc", limit: 300 }),
    selectRows("swarm_protocol_changes", { order: "created_at.desc", limit: 200 }),
    getGithubItems(),
    swarmConfig.integrationBranch ? Promise.resolve(null) : readDefaultBranch(),
  ]);
  const sessionRows = take(sessions, [], errors);
  const resultRows = take(results, [], errors);
  const versionRows = take(versions, [], errors);
  const buriedRows = take(buried, [], errors);
  const targets = resolveTargets([
    ...sessionRows.map((row) => row.target),
    ...resultRows.map((row) => row.target),
    ...versionRows.map((row) => row.target),
    ...buriedRows.map((row) => row.target),
  ]);
  const fleetSectors = swarmConfig.fleetSectors ?? [];
  const changedPaths = new Map<number, string[]>();
  let missingPaths = false;
  const repo = readGithubRepo();
  if (github.ok && repo && fleetSectors.some((sector) => sector.match.paths?.length)) {
    const targetIds = new Set([...targets, ...fleetSectors].map((sector) => sector.id));
    const labeled = new Set(github.items.filter((item) => fleetLabelSector(item, targetIds, fleetSectors)).map((item) => item.number));
    const unlabeledIssues = new Set(github.items.filter((item) => !item.isPullRequest && !labeled.has(item.number)).map((item) => item.number));
    const prs = github.items.filter((item) =>
      item.isPullRequest && (item.state === "open" || item.mergedAt) &&
      !labeled.has(item.number) && (!item.closes.some((number) => labeled.has(number)) || item.closes.some((number) => unlabeledIssues.has(number))),
    );
    const batch = prs.slice(0, FLEET_PATH_PULL_LIMIT);
    const files = await Promise.all(batch.map((pr) => readPullPaths(repo, pr.number)));
    files.forEach((result, index) => {
      if (result) changedPaths.set(batch[index]!.number, result.paths);
    });
    missingPaths = changedPaths.size !== prs.length || files.some((result) => result?.truncated);
  }
  const input = toSwarmInput({
    now: Date.now(),
    integrationBranch: swarmConfig.integrationBranch || defaultBranch || "main",
    branchPrefix: swarmConfig.branchPrefix,
    targets,
    fleetSectors,
    changedPaths,
    sessions: sessionRows,
    progress: take(progress, [], errors),
    results: resultRows,
    versions: versionRows,
    buried: buriedRows,
    protocolChanges: take(changes, [], errors),
    github: github.ok ? github.items : null,
    shippedUnit: word("shipped"),
  });
  const githubNote = github.ok
    ? [
        github.truncated ? "Progress covers the GitHub items returned by the recent-item limit." : null,
        missingPaths ? "Changed paths were unavailable for some pull requests." : null,
      ].filter(Boolean).join(" ") || null
    : `GitHub is unavailable. ${github.message}`;
  return { input, githubNote, delivery: github.ok ? deliveryOf(github.items) : null, errors };
}

/* ───────────────────────── Sessions ───────────────────────── */

export type SessionWithMemory = SessionRow & { retros: RetroRow[]; progress: ProgressRow[] };

export async function getSessions(status?: SessionRow["status"]) {
  const errors: Errors = [];
  const sessions = take(
    await selectRows("swarm_sessions", {
      order: "started_at.desc",
      limit: 50,
      filters: status ? { status: `eq.${status}` } : {},
    }),
    [],
    errors,
  );
  let retros: RetroRow[] = [];
  let progress: ProgressRow[] = [];
  if (sessions.length > 0) {
    const ids = `in.(${sessions.map((session) => session.id).join(",")})`;
    const [retroRead, progressRead] = await Promise.all([
      selectRows("swarm_retros", { filters: { session_id: ids }, order: "created_at.asc", limit: 500 }),
      selectRows("swarm_progress", { filters: { session_id: ids }, order: "created_at.asc", limit: 1000 }),
    ]);
    retros = take(retroRead, [], errors);
    progress = take(progressRead, [], errors);
  }
  const withMemory: SessionWithMemory[] = sessions.map((session) => ({
    ...session,
    retros: retros.filter((retro) => retro.session_id === session.id),
    progress: progress.filter((note) => note.session_id === session.id),
  }));
  return { sessions: withMemory, errors };
}

/* ───────────────────────── Rallypoint (GitHub lanes) ───────────────────────── */

export type Lane = { id: LaneId; label: string; description: string; items: GithubItem[] };

export async function getLanes(): Promise<{ lanes: Lane[]; github: GithubState; repo: string | null }> {
  const github = await getGithubItems();
  const lanes: Lane[] = LANES.map((lane) => ({ ...lane, items: [] }));
  if (github.ok) {
    for (const item of github.items) {
      const id = laneOf(item);
      if (id) lanes.find((lane) => lane.id === id)!.items.push(item);
    }
    const merged = lanes.find((lane) => lane.id === "merged")!;
    merged.items.sort((a, b) => (b.mergedAt ?? "").localeCompare(a.mergedAt ?? ""));
    merged.items = merged.items.slice(0, 20);
  }
  return { lanes, github, repo: readGithubRepo() };
}

/* ───────────────────────── Board (memory timeline) ───────────────────────── */

export const BOARD_KINDS = ["result", "version", "buried", "protocol", "message"] as const;
export type BoardKind = (typeof BOARD_KINDS)[number];

export type BoardEntry =
  | { kind: "result"; at: string; target: string | null; row: ResultRow }
  | { kind: "version"; at: string; target: string | null; row: VersionRow }
  | { kind: "buried"; at: string; target: string | null; row: BuriedRow }
  | { kind: "protocol"; at: string; target: null; row: ProtocolChangeRow }
  | { kind: "message"; at: string; target: null; row: MessageRow };

export async function getBoard(filter: { kind?: BoardKind; target?: string }) {
  const errors: Errors = [];
  const want = (kind: BoardKind) => !filter.kind || filter.kind === kind;
  const targetFilter: Record<string, string> = filter.target ? { target: `eq.${filter.target}` } : {};
  const none = <T,>(): Promise<ReadResult<T[]>> => Promise.resolve({ ok: true, data: [] });
  const [results, versions, buried, changes, messages] = await Promise.all([
    want("result") ? selectRows("swarm_results", { filters: targetFilter, order: "created_at.desc", limit: 100 }) : none<ResultRow>(),
    want("version") ? selectRows("swarm_versions", { filters: targetFilter, order: "created_at.desc", limit: 100 }) : none<VersionRow>(),
    want("buried") ? selectRows("swarm_buried", { filters: targetFilter, order: "created_at.desc", limit: 100 }) : none<BuriedRow>(),
    want("protocol") && !filter.target
      ? selectRows("swarm_protocol_changes", { order: "created_at.desc", limit: 100 })
      : none<ProtocolChangeRow>(),
    want("message") && !filter.target ? selectRows("swarm_messages", { order: "created_at.desc", limit: 100 }) : none<MessageRow>(),
  ]);
  const entries: BoardEntry[] = [
    ...take<ResultRow[]>(results, [], errors).map((row): BoardEntry => ({ kind: "result", at: row.created_at, target: row.target, row })),
    ...take<VersionRow[]>(versions, [], errors).map((row): BoardEntry => ({ kind: "version", at: row.created_at, target: row.target, row })),
    ...take<BuriedRow[]>(buried, [], errors).map((row): BoardEntry => ({ kind: "buried", at: row.created_at, target: row.target, row })),
    ...take<ProtocolChangeRow[]>(changes, [], errors).map((row): BoardEntry => ({ kind: "protocol", at: row.created_at, target: null, row })),
    ...take<MessageRow[]>(messages, [], errors).map((row): BoardEntry => ({ kind: "message", at: row.created_at, target: null, row })),
  ];
  entries.sort((a, b) => b.at.localeCompare(a.at));
  return { entries: entries.slice(0, 150), targets: resolveTargets([]), errors };
}

/* ───────────────────────── Messages ───────────────────────── */

export type { Thread } from "./threads";

/** How many messages the board reads: the newest, so a long history never hides today's threads. */
const MESSAGE_PAGE = 1000;

/** Session id → role, for the sessions that posted these messages. */
async function rolesOf(messages: MessageRow[], errors: Errors): Promise<Record<string, string>> {
  const ids = [...new Set(messages.map((message) => message.session_id).filter((id): id is string => Boolean(id)))];
  const chunks: string[][] = [];
  for (let index = 0; index < ids.length; index += 100) chunks.push(ids.slice(index, index + 100));
  const reads = await Promise.all(
    chunks.map((chunk) => selectRows("swarm_sessions", { filters: { id: `in.(${chunk.join(",")})` }, limit: chunk.length })),
  );
  const roles: Record<string, string> = {};
  for (const read of reads) for (const session of take(read, [], errors)) if (session.role) roles[session.id] = session.role;
  return roles;
}

export async function getThreads(filter: ThreadFilter = {}) {
  const errors: Errors = [];
  const messages = take(
    await selectRows("swarm_messages", { order: "created_at.desc", limit: MESSAGE_PAGE }),
    [],
    errors,
  );
  const all = buildThreads(messages);
  const roles = await rolesOf(messages, errors);
  return {
    threads: filterThreads(all, filter),
    all,
    roles,
    truncated: messages.length === MESSAGE_PAGE,
    errors,
  };
}

/**
 * One thread by any of its message ids: walks `thread_id` up to the root,
 * then reads replies level by level, so a thread older than the board's page
 * still opens whole. `null` means no such message.
 */
export async function getThread(id: string) {
  if (!/^\d+$/.test(id)) return null;
  const errors: Errors = [];
  const found = new Map<number, MessageRow>();
  let current = first(await selectRows("swarm_messages", { filters: { id: `eq.${id}` }, limit: 1 }), errors);
  if (!current) return errors.length > 0 ? { thread: null, roles: {}, requested: Number(id), errors } : null;
  found.set(current.id, current);
  for (let hop = 0; hop < 20 && current.thread_id !== null && !found.has(current.thread_id); hop += 1) {
    const parent: MessageRow | null = first(
      await selectRows("swarm_messages", { filters: { id: `eq.${current.thread_id}` }, limit: 1 }),
      errors,
    );
    if (!parent) break;
    found.set(parent.id, parent);
    current = parent;
  }
  const rootId = current.id;
  let frontier = [rootId];
  for (let depth = 0; depth < 20 && frontier.length > 0; depth += 1) {
    const children = take(
      await selectRows("swarm_messages", {
        filters: { thread_id: `in.(${frontier.join(",")})` },
        order: "created_at.asc",
        limit: MESSAGE_PAGE,
      }),
      [],
      errors,
    );
    frontier = [];
    for (const child of children) {
      if (found.has(child.id)) continue;
      found.set(child.id, child);
      frontier.push(child.id);
    }
  }
  // Later messages on the root's ref decide whether a hand-off was picked up.
  if (current.ref) {
    const related = take(
      await selectRows("swarm_messages", { filters: { ref: `eq.${current.ref}` }, order: "created_at.desc", limit: 200 }),
      [],
      errors,
    );
    for (const message of related) if (!found.has(message.id)) found.set(message.id, message);
  }
  const messages = [...found.values()];
  const thread = buildThreads(messages).find((entry) => entry.root.id === rootId) ?? null;
  return { thread, roles: await rolesOf(messages, errors), requested: Number(id), errors };
}

/* ───────────────────────── Protocol, concepts ───────────────────────── */

export async function getProtocol(settings: SwarmSettings) {
  const errors: Errors = [];
  const [metrics, changes] = await Promise.all([
    selectRows("swarm_metrics", { limit: 1 }),
    selectRows("swarm_protocol_changes", { order: "created_at.desc", limit: 100 }),
  ]);
  const metricsRow = first(metrics, errors);
  return {
    metrics: metricsRow,
    protocolVersion: metricsRow?.protocol_version ?? settings.protocol_version ?? null,
    changes: take(changes, [], errors),
    repoUrl: githubRepoUrl(),
    errors,
  };
}

export async function getConcepts(): Promise<{
  concepts: ConceptRow[];
  trials: ConceptTrialRow[];
  targets: SwarmTarget[];
  errors: Errors;
}> {
  const errors: Errors = [];
  const [concepts, trials] = await Promise.all([
    selectRows("swarm_concepts", { order: "name.asc", limit: 500 }),
    selectRows("swarm_concept_trials", { order: "created_at.asc", limit: 2000 }),
  ]);
  const trialRows = take(trials, [], errors);
  return {
    concepts: take(concepts, [], errors),
    trials: trialRows,
    targets: resolveTargets(trialRows.map((trial) => trial.target)),
    errors,
  };
}

/* ───────────────────────── How it works ───────────────────────── */

export async function getHowItWorks(settings: SwarmSettings) {
  const errors: Errors = [];
  const metrics = first(await selectRows("swarm_metrics", { limit: 1 }), errors);
  const goal = settings.goal ?? {};
  return {
    mode: measureMode(settings),
    goal: {
      title: swarmConfig.goal.title || goal.title || "",
      statement: swarmConfig.goal.statement || goal.statement || "",
    },
    measure: goal.measure ?? null,
    protocolVersion: metrics?.protocol_version ?? settings.protocol_version ?? null,
    errors,
  };
}

/* ───────────────────────── Skills (GitHub contents) ───────────────────────── */

/** The tunable folders the Skills page lists (CONTRACT.md `tunablePaths`). */
export const SKILL_FOLDERS = [
  { path: ".rallypoint/roles", label: "Role prompts" },
  { path: ".rallypoint/swarm/skills", label: "Skills" },
  { path: ".rallypoint/swarm/playbooks", label: "Playbooks" },
] as const;

export type SkillFolder = {
  path: string;
  label: string;
  entries: RepoEntry[];
  /** Set when the folder could not be read; an empty folder has none. */
  error: GithubFailure | null;
};

export async function getSkills(selected?: string) {
  const repo = readGithubRepo();
  const folders: SkillFolder[] = await Promise.all(
    SKILL_FOLDERS.map(async (folder) => {
      const read = await listDirectory(folder.path);
      return {
        ...folder,
        entries: read.ok ? read.data.filter((entry) => entry.type === "file") : [],
        error: read.ok ? null : read,
      };
    }),
  );
  let file: { path: string; text: string | null; error: GithubFailure | null } | null = null;
  // Only files the listing returned can be opened, so the query string cannot
  // read anything else in the repository.
  const allowed = folders.flatMap((folder) => folder.entries.map((entry) => entry.path));
  if (selected && allowed.includes(selected)) {
    const read = await readFile(selected);
    file = { path: selected, text: read.ok ? read.data : null, error: read.ok ? null : read };
  }
  return { repo, folders, file };
}
