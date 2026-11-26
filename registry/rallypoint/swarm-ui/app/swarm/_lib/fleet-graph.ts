/**
 * The adapter from Rallypoint's own state onto the fleet graph's input
 * (`../_graph`, a copy of Swarm Arena's `@rallypoint/swarm-graph`). It is the
 * only file that knows how this scaffold's rows map onto the graph:
 *
 *   sectors     <- the configured targets (swarm.config.ts), with their
 *                  colours, plus any target id found in the data
 *   agents      <- one per agent name in `swarm_sessions`: its latest
 *                  session's role, target, issue, PR and progress note.
 *                  `working` only while that session says so and was seen
 *                  in the last two hours (the `swarm_fleet` rule)
 *   workItems   <- GitHub issues and pull requests, staged by their
 *                  `status:*` / `review:*` labels (`laneOf`), joined by
 *                  "Closes #N", on the `agent/<issue>-<slug>` branch
 *                  `claim.mjs` prescribes. Without GitHub, the issues the
 *                  sessions name
 *   events      <- memory (sessions starting and ending, progress notes,
 *                  referee results, shipped versions, buried ideas,
 *                  protocol changes) and GitHub (issues opened and claimed,
 *                  pull requests opened, reviewed and merged), each at its
 *                  own timestamp, so a replay can play the whole history
 *
 * Pure and deterministic: no reads, no clock. `queries.ts` reads the rows and
 * calls `toSwarmInput`. Every source may be empty; the graph then shows what
 * there is (at least the integration branch and the targets).
 */

import { rallypointBranch } from "../_graph/model";
import type {
  SwarmAgent,
  SwarmCount,
  SwarmEvent,
  SwarmInput,
  SwarmOutcome,
  SwarmSector,
  SwarmStage,
  SwarmWorkItem,
} from "../_graph/model";
import type { SwarmTarget } from "./config-types";
import { laneOf, targetsOf, type GithubItem } from "./github";
import type {
  BuriedRow,
  ProgressRow,
  ProtocolChangeRow,
  ResultRow,
  SessionRow,
  VersionRow,
} from "./types";

/** A session counts as working only if it was seen this recently (the `swarm_fleet` view's window). */
export const LIVE_WINDOW_MS = 2 * 3_600_000;
/** The recent part of a sector's count. */
const RECENT_MS = 24 * 3_600_000;
/** Where work with no target goes when more than one target is configured. */
export const OTHER_SECTOR = "_other";

export type FleetGraphSource = {
  /** The clock (ms) the rows were read at. */
  now: number;
  integrationBranch: string;
  /** Rallypoint's `branchPrefix` (`.rallypoint/config.json`). Default `agent/`. */
  branchPrefix?: string;
  /** Configured targets first, then any found in data (`resolveTargets`). */
  targets: SwarmTarget[];
  sessions: SessionRow[];
  progress: ProgressRow[];
  results: ResultRow[];
  versions: VersionRow[];
  buried: BuriedRow[];
  protocolChanges: ProtocolChangeRow[];
  /** Issues and pull requests, or null when GitHub could not be read. */
  github: GithubItem[] | null;
  /** The word for a shipped version, for sector counts without GitHub. Default `shipped`. */
  shippedUnit?: string;
};

const ms = (iso: string | null | undefined) => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? t : null;
};

const clip = (text: string, max = 140) => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

/** The agent a session belongs to: its name, or the session itself when it has none. */
export function agentIdOf(session: Pick<SessionRow, "agent" | "id">): string {
  return session.agent?.trim() || session.id;
}

function lastSeenOf(session: SessionRow): string {
  return session.last_seen_at ?? session.ended_at ?? session.started_at;
}

/** A pull request's stage from its labels; an issue's from its labels and closing state. */
export function stageOf(item: GithubItem): SwarmStage {
  const lane = laneOf(item);
  if (lane) return lane;
  if (item.isPullRequest) return "closed";
  return item.stateReason === "not_planned" ? "closed" : "merged";
}

export function toSwarmInput(source: FleetGraphSource): SwarmInput {
  const { now, github } = source;
  const prefix = source.branchPrefix ?? "agent/";

  /* ── Sectors: the targets, and a fallback for untargeted work ── */
  const targetIds = new Set(source.targets.map((target) => target.id));
  const fallback = source.targets.length === 1 ? source.targets[0]!.id : OTHER_SECTOR;
  let usesOther = false;
  const known = (id: string | null | undefined) => (id && targetIds.has(id) ? id : null);
  const orFallback = (id: string | null) => {
    if (id) return id;
    if (fallback === OTHER_SECTOR) usesOther = true;
    return fallback;
  };

  /* ── Sessions, by agent and by what they hold ── */
  const sessionById = new Map(source.sessions.map((session) => [session.id, session]));
  const targetOfIssue = new Map<number, string>();
  const targetOfPr = new Map<number, string>();
  for (const session of [...source.sessions].sort((a, b) => a.started_at.localeCompare(b.started_at))) {
    const target = known(session.target);
    if (!target) continue;
    if (session.issue !== null) targetOfIssue.set(session.issue, target);
    if (session.pr !== null) targetOfPr.set(session.pr, target);
  }

  /* ── Work items ── */
  const workItems: SwarmWorkItem[] = [];
  const workByIssue = new Map<number, string>();
  const workByPr = new Map<number, string>();
  const itemsByNumber = new Map<number, GithubItem>();

  if (github) {
    for (const item of github) itemsByNumber.set(item.number, item);
    const issues = github.filter((item) => !item.isPullRequest);
    const issueNumbers = new Set(issues.map((item) => item.number));
    const prs = github.filter((item) => item.isPullRequest);
    // The pull request that delivers an issue: an open or merged one, newest first.
    const prFor = (issue: number) =>
      prs
        .filter((pr) => pr.closes.includes(issue) && (pr.state === "open" || pr.mergedAt))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    const sectorOf = (item: GithubItem, pr?: GithubItem) =>
      orFallback(
        known(targetsOf(item)[0]) ??
          (pr ? known(targetsOf(pr)[0]) : null) ??
          (item.isPullRequest ? targetOfPr.get(item.number) : targetOfIssue.get(item.number)) ??
          (pr ? targetOfPr.get(pr.number) : undefined) ??
          null,
      );
    const delivered = new Set<number>();
    for (const issue of issues) {
      const pr = prFor(issue.number);
      if (pr) delivered.add(pr.number);
      const id = `issue-${issue.number}`;
      workByIssue.set(issue.number, id);
      if (pr) workByPr.set(pr.number, id);
      workItems.push({
        id,
        sector: sectorOf(issue, pr),
        title: issue.title,
        stage: pr ? stageOf(pr) : stageOf(issue),
        issue: issue.number,
        pr: pr?.number ?? null,
        branch: rallypointBranch(issue.number, issue.title, prefix),
        at: pr?.mergedAt ?? issue.closedAt ?? issue.updatedAt,
      });
    }
    // Pull requests that close no issue in the read (or none at all) are work of their own.
    for (const pr of prs) {
      if (delivered.has(pr.number) || workByPr.has(pr.number)) continue;
      if (pr.closes.some((issue) => issueNumbers.has(issue))) {
        // A superseded or abandoned PR of an issue already drawn: its events go to that issue.
        workByPr.set(pr.number, workByIssue.get(pr.closes.find((n) => issueNumbers.has(n))!)!);
        continue;
      }
      const id = `pr-${pr.number}`;
      workByPr.set(pr.number, id);
      workItems.push({
        id,
        sector: sectorOf(pr),
        title: pr.title,
        stage: stageOf(pr),
        issue: pr.closes[0] ?? null,
        pr: pr.number,
        branch: null,
        at: pr.mergedAt ?? pr.closedAt ?? pr.updatedAt,
      });
    }
  }

  // Without GitHub (or for issues it did not return): the issues sessions hold right now, and
  // those a shipped version names by pull request.
  const shippedPrs = new Set(source.versions.map((row) => row.pr).filter((pr): pr is number => pr !== null));
  const liveSession = (session: SessionRow) =>
    session.status === "working" && now - (ms(lastSeenOf(session)) ?? -Infinity) <= LIVE_WINDOW_MS;
  for (const session of source.sessions) {
    if (session.issue === null || workByIssue.has(session.issue)) continue;
    const shipped = session.pr !== null && shippedPrs.has(session.pr);
    if (!shipped && !liveSession(session)) continue;
    const id = `issue-${session.issue}`;
    workByIssue.set(session.issue, id);
    if (session.pr !== null) workByPr.set(session.pr, id);
    const title = `Issue #${session.issue}`;
    workItems.push({
      id,
      sector: orFallback(known(session.target) ?? targetOfIssue.get(session.issue) ?? null),
      title,
      stage: shipped ? "merged" : session.pr !== null ? "review" : "claimed",
      issue: session.issue,
      pr: session.pr,
      branch: rallypointBranch(session.issue, title, prefix),
      at: lastSeenOf(session),
    });
  }

  const workOf = (issue: number | null | undefined, pr: number | null | undefined) =>
    (pr !== null && pr !== undefined ? workByPr.get(pr) : undefined) ??
    (issue !== null && issue !== undefined ? workByIssue.get(issue) : undefined) ??
    null;
  const sectorOfWork = new Map(workItems.map((item) => [item.id, item.sector]));

  /* ── Agents: one per name, from its latest session ── */
  const latestByAgent = new Map<string, SessionRow>();
  for (const session of source.sessions) {
    const id = agentIdOf(session);
    const current = latestByAgent.get(id);
    if (!current || lastSeenOf(session).localeCompare(lastSeenOf(current)) > 0) latestByAgent.set(id, session);
  }
  const latestNote = new Map<string, ProgressRow>();
  for (const note of source.progress) {
    const current = latestNote.get(note.session_id);
    if (!current || note.created_at.localeCompare(current.created_at) > 0) latestNote.set(note.session_id, note);
  }
  const agents: SwarmAgent[] = [...latestByAgent.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, session]) => {
      const note = latestNote.get(session.id);
      return {
        id,
        label: session.agent?.trim() || `session ${session.id.slice(0, 8)}`,
        role: session.role?.trim() || "agent",
        status: liveSession(session) ? "working" : session.status === "working" ? "idle" : "stopped",
        sector: known(session.target),
        workItem: workOf(session.issue, session.pr),
        pr: session.pr,
        activity: note ? clip(note.note) : session.summary ? clip(session.summary) : null,
        lastSeen: lastSeenOf(session),
      };
    });

  /* ── Events ── */
  const events: SwarmEvent[] = [];
  const fromSession = (sessionId: string | null | undefined) => {
    const session = sessionId ? sessionById.get(sessionId) : undefined;
    if (!session) return { agent: null, sector: null, workItem: null };
    const workItem = workOf(session.issue, session.pr);
    return {
      agent: agentIdOf(session),
      sector: known(session.target) ?? (workItem ? sectorOfWork.get(workItem) ?? null : null),
      workItem,
    };
  };

  for (const session of source.sessions) {
    const who = fromSession(session.id);
    const name = session.agent?.trim() || "An agent";
    const role = session.role?.trim();
    events.push({
      ...who,
      id: `session:${session.id}:start`,
      at: session.started_at,
      kind: "session",
      sub: "session-started",
      title: `${name} started a ${role ? `${role} ` : ""}session`,
    });
    if (session.ended_at) {
      events.push({
        ...who,
        id: `session:${session.id}:end`,
        at: session.ended_at,
        kind: "session",
        sub: session.status === "abandoned" ? "session-abandoned" : "session-ended",
        title: `${name} ${session.status === "abandoned" ? "abandoned" : "ended"} the session`,
      });
    }
  }

  for (const note of source.progress) {
    events.push({
      ...fromSession(note.session_id),
      id: `progress:${note.id}`,
      at: note.created_at,
      kind: "progress",
      sub: "progress",
      title: clip(note.note),
    });
  }

  for (const row of source.results) {
    const who = fromSession(row.session_id);
    const workItem = workOf(row.issue, row.pr) ?? who.workItem;
    const outcome: SwarmOutcome | null = row.passed === true ? "win" : row.passed === false ? "loss" : null;
    const ref = row.pr !== null ? ` on #${row.pr}` : row.issue !== null ? ` for #${row.issue}` : "";
    events.push({
      ...who,
      id: `result:${row.id}`,
      at: row.created_at,
      kind: "result",
      sub: "referee",
      sector: known(row.target) ?? who.sector,
      workItem,
      outcome,
      delta: row.delta,
      title: `Referee ${row.passed === true ? "passed" : row.passed === false ? "failed" : "ran"}${ref}`,
    });
  }

  for (const row of source.versions) {
    events.push({
      agent: null,
      id: `version:${row.id}`,
      at: row.created_at,
      kind: "milestone",
      sub: "version",
      sector: known(row.target),
      workItem: workOf(null, row.pr),
      title: `${row.target ? `${row.target} ` : ""}${row.version} shipped`,
    });
  }

  for (const row of source.buried) {
    events.push({
      agent: null,
      id: `buried:${row.id}`,
      at: row.created_at,
      kind: "reject",
      sub: "buried",
      sector: known(row.target),
      workItem: workOf(row.issue, row.pr),
      title: `Buried: ${clip(row.idea, 120)}`,
    });
  }

  for (const row of source.protocolChanges) {
    events.push({
      agent: null,
      id: `protocol:${row.id}`,
      at: row.created_at,
      kind: "protocol",
      sub: "protocol-change",
      sector: null,
      workItem: null,
      title: `Protocol ${row.version}: ${clip(row.summary, 120)}`,
    });
  }

  if (github) {
    for (const item of github) {
      const workItem = workOf(item.isPullRequest ? null : item.number, item.isPullRequest ? item.number : null);
      const base = { agent: null, workItem, sector: workItem ? sectorOfWork.get(workItem) ?? null : null };
      if (item.isPullRequest) {
        events.push({
          ...base,
          id: `gh:pr:${item.number}:opened`,
          at: item.createdAt,
          kind: "pr",
          sub: "pr-opened",
          title: `Pull request #${item.number} opened: ${item.title}`,
        });
        const lane = laneOf(item);
        if (lane === "approved" || lane === "changes") {
          events.push({
            ...base,
            id: `gh:pr:${item.number}:${lane}`,
            at: item.updatedAt,
            kind: lane === "approved" ? "review" : "reject",
            sub: lane === "approved" ? "pr-approved" : "pr-changes",
            title: lane === "approved" ? `Pull request #${item.number} approved` : `Changes asked on pull request #${item.number}`,
          });
        }
        if (item.mergedAt) {
          events.push({
            ...base,
            id: `gh:pr:${item.number}:merged`,
            at: item.mergedAt,
            kind: "merge",
            sub: "pr-merged",
            title: `Pull request #${item.number} merged: ${item.title}`,
          });
        }
      } else {
        if (item.state === "closed" && item.stateReason === "not_planned") continue;
        events.push({
          ...base,
          id: `gh:issue:${item.number}:opened`,
          at: item.createdAt,
          kind: "plan",
          sub: "issue-opened",
          title: `Issue #${item.number} opened: ${item.title}`,
        });
        if (laneOf(item) === "claimed") {
          events.push({
            ...base,
            id: `gh:issue:${item.number}:claimed`,
            at: item.updatedAt,
            kind: "claim",
            sub: "issue-claimed",
            title: `Issue #${item.number} claimed: ${item.title}`,
          });
        }
      }
    }
  }

  // An event with no usable timestamp cannot be placed on the timeline.
  const timed = events.filter((event) => ms(event.at) !== null);

  /* ── Sector counts: merged pull requests (GitHub), else shipped versions (memory) ── */
  const counts = new Map<string, SwarmCount>();
  const since = now - RECENT_MS;
  const add = (sector: string, unit: string, at: string | null) => {
    const count = counts.get(sector) ?? { value: 0, unit, recent: 0, recentUnit: "today" };
    count.value += 1;
    if ((ms(at) ?? -Infinity) >= since) count.recent = (count.recent ?? 0) + 1;
    counts.set(sector, count);
  };
  if (github) {
    for (const item of github) {
      if (!item.isPullRequest || !item.mergedAt) continue;
      const workItem = workByPr.get(item.number);
      const sector = workItem ? sectorOfWork.get(workItem) : undefined;
      if (sector) add(sector, "merged", item.mergedAt);
    }
  } else {
    for (const row of source.versions) {
      const sector = known(row.target);
      if (sector) add(sector, source.shippedUnit ?? "shipped", row.created_at);
    }
  }

  const sectors: SwarmSector[] = source.targets.map((target) => ({
    id: target.id,
    label: target.name,
    color: target.color,
    count: counts.get(target.id) ?? (github || source.versions.length > 0 ? zero(github ? "merged" : source.shippedUnit ?? "shipped") : null),
  }));
  if (usesOther) {
    sectors.push({
      id: OTHER_SECTOR,
      // The only sector when no target is configured or recorded: the whole codebase.
      label: source.targets.length === 0 ? "Codebase" : "Other",
      color: "var(--rp-ink-soft)",
      count: counts.get(OTHER_SECTOR) ?? (github ? zero("merged") : null),
    });
  }

  return {
    integrationBranch: source.integrationBranch,
    asOf: new Date(now).toISOString(),
    sectors,
    agents,
    workItems,
    events: timed,
  };
}

function zero(unit: string): SwarmCount {
  return { value: 0, unit, recent: 0, recentUnit: "today" };
}
