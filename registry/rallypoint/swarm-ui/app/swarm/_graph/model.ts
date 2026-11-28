/**
 * The swarm graph model. Pure and framework-free: it turns what a Rallypoint swarm already
 * records (agents and their roles, issues and the pull requests that deliver them, the events
 * agents log) into a graph that follows the protocol:
 *
 *   issue ──claim──▶ agent/<issue>-<slug> branch (forked from the integration branch, worked in
 *   a worktree) ──▶ pull request ──independent review──▶ merge into the integration branch,
 *   landing in the sector of the codebase the branch touched.
 *
 * Nothing reaches the integration branch except a merge. Nothing here knows about a particular
 * project: a host maps its own data onto these types and decides what a sector is (a directory,
 * a package, a label). The renderer in `render.ts` draws whatever this returns.
 */

/** The Rallypoint roles (`.rallypoint/roles/`). Hosts may add their own. */
export type SwarmRole =
  | 'worker'
  | 'reviewer'
  | 'merger'
  | 'fixer'
  | 'improver'
  | 'planner'
  | 'janitor'
  | 'tester'
  | 'orchestrator'
  | 'referee'
  | (string & {});

export type SwarmAgentStatus = 'working' | 'idle' | 'stopped';

/** A part of the codebase (paths in the integration branch) that work lands in. */
export type SwarmSector = {
  id: string;
  label: string;
  /** Any CSS colour; the renderer falls back to a neutral when absent. */
  color?: string;
  /** Repository paths the sector covers, for display only. */
  paths?: string[];
  score?: number | null;
  version?: string | null;
  /**
   * The number drawn inside the sector: a stable count the host reads from its own records (merged
   * pull requests, landed versions), not the effort of whatever events reached the model. Absent,
   * the renderer shows no number.
   */
  count?: SwarmCount | null;
};

/** A labelled all-time count with its recent part, e.g. 48 merged · 3 today. */
export type SwarmCount = {
  value: number;
  /** What the number counts, e.g. `merged`, `versions`. */
  unit: string;
  recent?: number | null;
  /** The recent window, e.g. `today`. */
  recentUnit?: string | null;
};

export type SwarmAgent = {
  id: string;
  label?: string;
  role: SwarmRole;
  /** `working` only while the session is live; a host marks stale seats idle. */
  status: SwarmAgentStatus;
  /** The sector the agent is in this session, if any. */
  sector: string | null;
  /** The work item (issue) the agent holds, if any. */
  workItem?: string | null;
  /** The pull request the agent is on (a reviewer's or merger's subject), if any. */
  pr?: number | null;
  /** One line: what the agent is doing this minute. */
  activity?: string | null;
  lastSeen: string;
};

/**
 * Where a work item is in the Rallypoint lifecycle; the same stages the protocol's labels give.
 * `backlog`/`held` are issues, `claimed` is a branch, `review`/`changes`/`approved` an open pull
 * request, `merged` landed on the integration branch, `closed` abandoned.
 */
export type SwarmStage =
  'backlog' | 'held' | 'claimed' | 'review' | 'changes' | 'approved' | 'merged' | 'closed';

/** How a stage is drawn: an issue, a branch in a worktree, a pull request, or landed code. */
export type SwarmPhase = 'issue' | 'branch' | 'pr' | 'landed';

export const phaseOf = (stage: SwarmStage): SwarmPhase | null => {
  switch (stage) {
    case 'backlog':
    case 'held':
      return 'issue';
    case 'claimed':
      return 'branch';
    case 'review':
    case 'changes':
    case 'approved':
      return 'pr';
    case 'merged':
      return 'landed';
    case 'closed':
      return null;
  }
};

/** One unit of work: a Rallypoint issue, its branch and, later, its pull request. */
export type SwarmWorkItem = {
  id: string;
  sector: string;
  title: string;
  stage: SwarmStage;
  issue?: number | null;
  pr?: number | null;
  groupedPullRequests?: number[];
  /** The branch it is worked on, e.g. `agent/29-mcts-uct-with-random-eye-respecting`. */
  branch?: string | null;
  /** When it reached its current stage; orders the merged history. */
  at?: string | null;
};

/**
 * What an event means on the graph. Only `merge` moves work into the integration branch.
 * `result` is a measurement finishing (a game, a match), `rating` a score changing, `session` an
 * agent's session starting, changing step or ending, `post` something said on a discussion
 * board, `pr` a pull request opening or moving.
 */
export type SwarmEventKind =
  | 'plan'
  | 'claim'
  | 'progress'
  | 'review'
  | 'merge'
  | 'reject'
  | 'milestone'
  | 'protocol'
  | 'result'
  | 'rating'
  | 'session'
  | 'post'
  | 'pr';

/** How a measured result went for the sector's side. */
export type SwarmOutcome = 'win' | 'loss' | 'draw';

export type SwarmEvent = {
  id: string;
  at: string;
  kind: SwarmEventKind;
  agent: string | null;
  sector: string | null;
  workItem: string | null;
  title: string;
  /** A host's finer label for the event (what a filter or preset keys on). */
  sub?: string | null;
  /**
   * Events that belong to one burst (the games of one match, say) share a group, so a host can
   * show them as one updating line. `title` names the burst.
   */
  group?: { id: string; title: string } | null;
  outcome?: SwarmOutcome | null;
  /** A signed change the event carries (a rating delta). */
  delta?: number | null;
};

export type SwarmInput = {
  /** Rallypoint's `integrationBranch`: the trunk every branch forks from and merges into. */
  integrationBranch: string;
  sectors: SwarmSector[];
  agents: SwarmAgent[];
  workItems: SwarmWorkItem[];
  events: SwarmEvent[];
  /** The clock the snapshot was read at. */
  asOf: string;
};

export type SwarmGraphOptions = {
  /** Idle agents seen within this window stay on the graph (dimmed). Default 6 h. */
  recentAgentMs?: number;
  /** Keep past effort available for replay without drawing idle agent nodes. */
  hideIdleAgents?: boolean;
  groupPullRequests?: boolean;
  showBacklog?: boolean;
  keepUnplacedEvents?: boolean;
  /** Merged work items kept per sector, newest first. Default 3. */
  mergedPerSector?: number;
  /** Keep idle agents that hold no work and logged no events (default false: they are noise). */
  showIdleWithoutEffort?: boolean;
  /** Effort weight per event kind. */
  weights?: Partial<Record<SwarmEventKind, number>>;
  /**
   * Drop dead nodes: ended agents, merged items and abandoned branches past their lifetime (see
   * `LIFETIMES`). Absent, nothing is pruned beyond `recentAgentMs` and `mergedPerSector`.
   */
  lifetimes?: SwarmLifetimes | null;
  /** The clock pruning is measured against (a live view ticks it). Default `input.asOf`. */
  now?: string | null;
  /**
   * The host's one liveness rule (#200): whether a seat that says `working` still is at `nowMs`
   * (a recent heartbeat). It is asked again at every `now`, so a seat that goes quiet while a live
   * view is open turns idle and the `lifetimes` take it off. Absent, a `working` status is trusted.
   * Either way, a seat whose work item has merged or closed is not working.
   */
  isLive?: ((agent: SwarmAgent, nowMs: number) => boolean) | null;
};

/**
 * How long a dead node stays on the graph. Sectors and the hub never leave. A node spends its
 * last `fadingMs` in a `fading` state (drawn dimmer) before it goes.
 */
export type SwarmLifetimes = {
  /** An ended or stale agent, from its last activity. */
  agentMs: number;
  /** A merged or closed work item, from when it closed. */
  closedMs: number;
  /** An open branch nobody has touched, from its last activity. */
  branchMs: number;
  fadingMs: number;
};

const MINUTE = 60_000;

/** Every pruning threshold in one table: the live views, and the longer-memoried `Everything`. */
export const LIFETIMES = {
  live: {
    agentMs: 10 * MINUTE,
    closedMs: 60 * MINUTE,
    branchMs: 60 * MINUTE,
    fadingMs: 3 * MINUTE,
  },
  everything: {
    agentMs: 6 * 60 * MINUTE,
    closedMs: 6 * 60 * MINUTE,
    branchMs: 6 * 60 * MINUTE,
    fadingMs: 10 * MINUTE,
  },
} as const satisfies Record<string, SwarmLifetimes>;

export type SwarmLife = 'alive' | 'fading' | 'gone';

/** Where a dead node is in its wind-down, `deadMs` after it died (stopped, closed, went quiet). */
export const lifeOf = (deadMs: number, lifetimeMs: number, fadingMs: number): SwarmLife => {
  if (!(deadMs <= lifetimeMs)) return 'gone';
  return deadMs > lifetimeMs - fadingMs ? 'fading' : 'alive';
};

export type SwarmNodeKind = 'hub' | 'sector' | 'work' | 'agent';

export type SwarmNode = {
  id: string;
  kind: SwarmNodeKind;
  label: string;
  color: string | null;
  /** Effort that landed on this node (sector, hub) or that this node spent (agent). */
  effort: number;
  /** Live agent, or a sector / work item a live agent is in. */
  active: boolean;
  /** Dead and about to leave the graph: drawn dimmer (see `SwarmLifetimes.fadingMs`). */
  fading?: boolean;
  /** For work nodes: how it is drawn. A node keeps its id as it moves through phases. */
  phase?: SwarmPhase;
  /** The original record, for tooltips and links. */
  sector?: SwarmSector;
  agent?: SwarmAgent;
  workItem?: SwarmWorkItem;
  /** For agent and work nodes: the sector they belong to. */
  sectorId?: string | null;
  /** For sectors: every work item aimed at it, by phase (closed ones left out). */
  tally?: SwarmTally;
  pastAgents?: number;
};

/** Work items counted by phase: waiting issues, open branches and pull requests, merged. */
export type SwarmTally = {
  issue: number;
  branch: number;
  pr: number;
  landed: number;
  total: number;
};

const emptyTally = (): SwarmTally => ({ issue: 0, branch: 0, pr: 0, landed: 0, total: 0 });

export type SwarmLinkKind =
  /** sector — hub: the sector is a set of paths in the integration branch. */
  | 'trunk'
  /** issue → sector it asks to change. */
  | 'target'
  /** hub → branch / pull request: forked from the integration branch's tip. */
  | 'fork'
  /** branch / pull request → the sector whose paths it changes. */
  | 'scope'
  /** landed work → its sector. */
  | 'landed'
  /** agent → what it is on now (its branch, the pull request it reviews, or the hub). */
  | 'assignment'
  /** agent → a sector it has spent effort on, weighted by that effort. */
  | 'contribution';

export type SwarmLink = {
  id: string;
  kind: SwarmLinkKind;
  source: string;
  target: string;
  weight: number;
  active: boolean;
};

/** One event as a movement on the graph: along `path`, node by node. */
export type SwarmFlow = {
  id: string;
  at: string;
  kind: SwarmEventKind;
  title: string;
  sub: string | null;
  group: { id: string; title: string } | null;
  outcome: SwarmOutcome | null;
  delta: number | null;
  agent: string | null;
  sector: string | null;
  /** At least two node ids. A merge runs branch → integration branch → sector. */
  path: string[];
  weight: number;
};

export type SwarmGraph = {
  hubId: string;
  nodes: SwarmNode[];
  links: SwarmLink[];
  /** Events in time order, each resolved to the nodes its effort moves between. */
  flows: SwarmFlow[];
  totals: {
    effort: number;
    live: number;
    agents: number;
    sectors: number;
    branches: number;
    pullRequests: number;
    /** Every work item by stage, merged history included, for a progress bar. */
    stages: Record<SwarmStage, number>;
  };
};

export const DEFAULT_WEIGHTS: Record<SwarmEventKind, number> = {
  plan: 0.5,
  claim: 1,
  progress: 1,
  review: 1,
  merge: 3,
  reject: 1,
  milestone: 2,
  protocol: 1,
  // Frequent and small: a gate plays dozens of games, a session heartbeats.
  result: 0.1,
  rating: 1,
  session: 0.2,
  post: 0.3,
  pr: 0.5,
};

/** Rallypoint's branch slug (`.rallypoint/scripts/lib/claim.mjs`), so names match the real ones. */
export const branchSlug = (title: string) =>
  title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 42);

/** The branch `claim.mjs` prescribes for an issue: `<branchPrefix><issue>-<slug>`. */
export const rallypointBranch = (issue: number, title: string, branchPrefix = 'agent/') =>
  `${branchPrefix}${issue}-${branchSlug(title)}`;

const HOUR = 3_600_000;

export const hubNodeId = (branch: string) => `hub:${branch}`;
export const sectorNodeId = (id: string) => `sector:${id}`;
export const workNodeId = (id: string) => `work:${id}`;
export const agentNodeId = (id: string) => `agent:${id}`;

/** Roles that work inside a branch's worktree. */
const BRANCH_ROLES = new Set(['worker', 'fixer', 'improver', 'janitor', 'tester']);
/** Roles that act on an open pull request. */
const GATE_ROLES = new Set(['reviewer', 'merger']);

/** Build the graph a renderer draws. Deterministic: the same input gives the same graph. */
export const buildSwarmGraph = (input: SwarmInput, options: SwarmGraphOptions = {}): SwarmGraph => {
  const recentMs = options.recentAgentMs ?? 6 * HOUR;
  const mergedPerSector = options.mergedPerSector ?? 3;
  const weights = { ...DEFAULT_WEIGHTS, ...options.weights };
  const now = Date.parse(options.now ?? input.asOf);
  const life = options.lifetimes ?? null;
  const fading = new Set<string>();
  const hubId = hubNodeId(input.integrationBranch);

  const sectors = new Map(input.sectors.map((s) => [s.id, s]));
  const items = new Map(input.workItems.map((w) => [w.id, w]));
  // Working means said and still true now: live by the host's rule, on work that is still open.
  // Everyone else is idle from here on, and the lifetime rules below apply to them.
  const finished = (a: SwarmAgent) => {
    const stage = a.workItem ? items.get(a.workItem)?.stage : undefined;
    return stage === 'merged' || stage === 'closed';
  };
  const stillWorking = (a: SwarmAgent) =>
    a.status === 'working' && (options.isLive?.(a, now) ?? true) && !finished(a);
  const inputAgents = input.agents.map((a): SwarmAgent =>
    a.status === 'working' && !stillWorking(a) ? { ...a, status: 'idle' } : a,
  );
  const agents = new Map(inputAgents.map((a) => [a.id, a]));
  const events = [...input.events].sort(
    (a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id),
  );

  const sectorOfEvent = (e: SwarmEvent) => {
    const s = e.sector ?? (e.workItem ? items.get(e.workItem)?.sector : null) ?? null;
    return s && sectors.has(s) ? s : null;
  };

  // Effort per sector, per agent, and per (agent, sector). Only merges count for the trunk.
  const sectorEffort = new Map<string, number>();
  const agentEffort = new Map<string, number>();
  const pairEffort = new Map<string, Map<string, number>>();
  let hubEffort = 0;
  let total = 0;
  const lastEventAt = new Map<string, string>();
  for (const e of events) {
    const w = weights[e.kind];
    total += w;
    const s = sectorOfEvent(e);
    if (s) sectorEffort.set(s, (sectorEffort.get(s) ?? 0) + w);
    if (e.kind === 'merge') hubEffort += w;
    if (e.agent) {
      agentEffort.set(e.agent, (agentEffort.get(e.agent) ?? 0) + w);
      lastEventAt.set(e.agent, e.at);
      if (s) {
        const m = pairEffort.get(e.agent) ?? new Map<string, number>();
        m.set(s, (m.get(s) ?? 0) + w);
        pairEffort.set(e.agent, m);
      }
    }
  }

  // Agents on the graph: live ones, idle ones seen recently that did something, and event-only
  // actors (a referee that never registers a seat) that acted recently.
  // With lifetimes, an agent that is not working leaves `agentMs` after its last activity.
  const shown = new Map<string, SwarmAgent>();
  const keepIdle = (id: string, seen: number) => {
    if (now - seen > recentMs) return false;
    if (!life) return true;
    const state = lifeOf(now - seen, life.agentMs, life.fadingMs);
    if (state === 'fading') fading.add(agentNodeId(id));
    return state !== 'gone';
  };
  for (const a of inputAgents) {
    const seen = Math.max(Date.parse(a.lastSeen), Date.parse(lastEventAt.get(a.id) ?? '') || 0);
    const idleNoise = !a.workItem && !agentEffort.has(a.id) && !options.showIdleWithoutEffort;
    if (a.status === 'working' || (!options.hideIdleAgents && !idleNoise && keepIdle(a.id, seen))) shown.set(a.id, a);
  }
  for (const [id, at] of lastEventAt) {
    if (options.hideIdleAgents || agents.has(id) || !keepIdle(id, Date.parse(at))) continue;
    shown.set(id, { id, role: id, status: 'idle', sector: null, lastSeen: at });
  }

  // Progress: every work item counted once, by sector and by stage.
  const tallies = new Map(input.sectors.map((s) => [s.id, emptyTally()]));
  const stages: Record<SwarmStage, number> = {
    backlog: 0,
    held: 0,
    claimed: 0,
    review: 0,
    changes: 0,
    approved: 0,
    merged: 0,
    closed: 0,
  };
  for (const w of input.workItems) {
    if (!sectors.has(w.sector)) continue;
    stages[w.stage]++;
    const phase = phaseOf(w.stage);
    const t = tallies.get(w.sector);
    if (!phase || !t) continue;
    t[phase]++;
    t.total++;
  }

  // Work items: every open issue, branch and pull request, plus the newest merged per sector.
  // With lifetimes, merged work leaves `closedMs` after it merged and a branch nobody is in leaves
  // `branchMs` after its last activity (its stage change, an event on it, a seat holding it).
  const itemActivity = new Map<string, number>();
  const touch = (id: string | null | undefined, at: string) => {
    const t = Date.parse(at);
    if (id && t > (itemActivity.get(id) ?? -Infinity)) itemActivity.set(id, t);
  };
  for (const e of events) touch(e.workItem, e.at);
  const heldLive = new Set<string>();
  for (const a of inputAgents) {
    if (a.workItem) touch(a.workItem, a.lastSeen);
    if (a.workItem && a.status === 'working') heldLive.add(a.workItem);
  }
  const survives = (w: SwarmWorkItem, phase: SwarmPhase) => {
    if (!life || (phase !== 'landed' && phase !== 'branch')) return true;
    if (phase === 'branch' && heldLive.has(w.id)) return true;
    const at = Math.max(Date.parse(w.at ?? '') || -Infinity, itemActivity.get(w.id) ?? -Infinity);
    const state = lifeOf(
      now - (phase === 'landed' ? Date.parse(w.at ?? '') : at),
      phase === 'landed' ? life.closedMs : life.branchMs,
      life.fadingMs,
    );
    if (state === 'fading') fading.add(workNodeId(w.id));
    return state !== 'gone';
  };
  const kept: SwarmWorkItem[] = [];
  const mergedBySector = new Map<string, SwarmWorkItem[]>();
  for (const w of input.workItems) {
    const phase = phaseOf(w.stage);
    if (!phase || !sectors.has(w.sector) || !survives(w, phase)) continue;
    if (phase === 'issue' && options.showBacklog === false && !heldLive.has(w.id)) continue;
    if (phase !== 'landed') kept.push(w);
    else mergedBySector.set(w.sector, [...(mergedBySector.get(w.sector) ?? []), w]);
  }
  for (const list of mergedBySector.values())
    kept.push(
      ...list
        .sort((a, b) => (b.at ?? '').localeCompare(a.at ?? '') || a.id.localeCompare(b.id))
        .slice(0, mergedPerSector),
    );
  const aliases = new Map<string, SwarmWorkItem>();
  if (options.groupPullRequests) {
    const groups = new Map<string, SwarmWorkItem[]>();
    for (const item of kept) {
      if (phaseOf(item.stage) !== 'pr' || !item.pr) continue;
      const key = JSON.stringify([item.sector, item.stage]);
      const group = groups.get(key) ?? [];
      group.push(item);
      groups.set(key, group);
    }
    for (const [key, group] of groups) {
      if (group.length < 2) continue;
      const representative = group[0]!;
      const numbers = [...new Set(group.map((item) => item.pr!))];
      const grouped = {
        ...representative,
        id: `pulls:${key}`,
        groupedPullRequests: numbers.length > 1 ? numbers : undefined,
      };
      for (const item of group) aliases.set(item.id, grouped);
    }
  }
  const visibleWork = [...new Map(kept.map((item) => {
    const visible = aliases.get(item.id) ?? item;
    return [visible.id, visible] as const;
  })).values()];
  const keptById = new Map(kept.map((w) => [w.id, aliases.get(w.id) ?? w]));
  const byPr = new Map(kept.filter((w) => w.pr).map((w) => [w.pr!, aliases.get(w.id) ?? w]));

  const agentSector = (a: SwarmAgent) => {
    const s = a.sector ?? (a.workItem ? items.get(a.workItem)?.sector : null) ?? null;
    return s && sectors.has(s) ? s : null;
  };

  /** Where an agent is right now, by role: its branch, the pull request it gates, or the hub. */
  const placeOf = (a: SwarmAgent): string => {
    const own = a.workItem ? keptById.get(a.workItem) : undefined;
    const onPr = a.pr ? byPr.get(a.pr) : undefined;
    const open = (w?: SwarmWorkItem) =>
      w && (phaseOf(w.stage) === 'branch' || phaseOf(w.stage) === 'pr');
    if (GATE_ROLES.has(a.role)) {
      const subject = onPr ?? own;
      if (subject && phaseOf(subject.stage) === 'pr') return workNodeId(subject.id);
      return hubId;
    }
    if (BRANCH_ROLES.has(a.role)) {
      if (open(own)) return workNodeId(own!.id);
      if (open(onPr)) return workNodeId(onPr!.id);
      const s = agentSector(a);
      return s ? sectorNodeId(s) : hubId;
    }
    if (a.role === 'planner') return hubId;
    if (open(own)) return workNodeId(own!.id);
    const s = agentSector(a);
    return s ? sectorNodeId(s) : hubId;
  };

  const places = new Map([...shown.values()].map((a) => [a.id, placeOf(a)]));
  const liveTargets = new Set<string>();
  const liveSectors = new Set<string>();
  for (const a of shown.values()) {
    if (a.status !== 'working') continue;
    const target = places.get(a.id)!;
    liveTargets.add(target);
    const s = agentSector(a);
    if (s) liveSectors.add(s);
  }

  const nodes: SwarmNode[] = [
    {
      id: hubId,
      kind: 'hub',
      label: input.integrationBranch,
      color: null,
      effort: hubEffort,
      active: false,
    },
  ];
  const links: SwarmLink[] = [];
  const pastBySector = new Map<string, number>();
  if (options.hideIdleAgents) {
    for (const [agent, contributions] of pairEffort) {
      if (shown.has(agent)) continue;
      for (const sector of contributions.keys()) pastBySector.set(sector, (pastBySector.get(sector) ?? 0) + 1);
    }
  }

  for (const s of input.sectors) {
    const id = sectorNodeId(s.id);
    nodes.push({
      id,
      kind: 'sector',
      label: s.label,
      color: s.color ?? null,
      effort: sectorEffort.get(s.id) ?? 0,
      active: liveSectors.has(s.id),
      sector: s,
      sectorId: s.id,
      tally: tallies.get(s.id),
      pastAgents: pastBySector.get(s.id),
    });
    links.push({
      id: `trunk:${s.id}`,
      kind: 'trunk',
      source: id,
      target: hubId,
      weight: sectorEffort.get(s.id) ?? 0,
      active: false,
    });
  }

  let branches = 0;
  let unnumberedPullRequests = 0;
  const pullRequestNumbers = new Set<number>();
  for (const w of visibleWork) {
    const id = workNodeId(w.id);
    const phase = phaseOf(w.stage)!;
    const active = liveTargets.has(id);
    const sid = sectorNodeId(w.sector);
    if (phase === 'branch') branches++;
    if (phase === 'pr') {
      if (w.pr) {
        for (const number of w.groupedPullRequests ?? [w.pr]) pullRequestNumbers.add(number);
      } else unnumberedPullRequests++;
    }
    nodes.push({
      id,
      kind: 'work',
      phase,
      label:
        phase === 'issue' || phase === 'landed'
          ? w.title
          : w.groupedPullRequests
            ? `${w.groupedPullRequests.length} PRs`
          : phase === 'pr' && w.pr
            ? `#${w.pr}`
            : (w.branch ?? w.title),
      color: sectors.get(w.sector)?.color ?? null,
      effort: 0,
      active,
      ...(fading.has(id) ? { fading: true } : {}),
      workItem: w,
      sectorId: w.sector,
    });
    if (phase === 'issue')
      links.push({
        id: `target:${w.id}`,
        kind: 'target',
        source: id,
        target: sid,
        weight: 1,
        active: false,
      });
    else if (phase === 'landed')
      links.push({
        id: `landed:${w.id}`,
        kind: 'landed',
        source: id,
        target: sid,
        weight: 1,
        active: false,
      });
    else {
      links.push({
        id: `fork:${w.id}`,
        kind: 'fork',
        source: hubId,
        target: id,
        weight: 1,
        active,
      });
      links.push({
        id: `scope:${w.id}`,
        kind: 'scope',
        source: id,
        target: sid,
        weight: 1,
        active: false,
      });
    }
  }

  for (const a of [...shown.values()].sort((x, y) => x.id.localeCompare(y.id))) {
    const id = agentNodeId(a.id);
    const s = agentSector(a);
    const live = a.status === 'working';
    const target = places.get(a.id)!;
    nodes.push({
      id,
      kind: 'agent',
      label: a.label ?? a.id,
      color: s ? (sectors.get(s)?.color ?? null) : null,
      effort: agentEffort.get(a.id) ?? 0,
      active: live,
      ...(fading.has(id) ? { fading: true } : {}),
      agent: a,
      sectorId: s,
    });
    links.push({
      id: `assign:${a.id}`,
      kind: 'assignment',
      source: id,
      target,
      weight: 1,
      active: live,
    });
    for (const [sec, w] of pairEffort.get(a.id) ?? []) {
      if (target === sectorNodeId(sec)) continue;
      links.push({
        id: `contrib:${a.id}:${sec}`,
        kind: 'contribution',
        source: id,
        target: sectorNodeId(sec),
        weight: w,
        active: false,
      });
    }
  }

  const nodeIds = new Set(nodes.map((n) => n.id));
  const flows: SwarmFlow[] = [];
  for (const e of events) {
    const s = sectorOfEvent(e);
    const sectorNode = s ? sectorNodeId(s) : null;
    const item = e.workItem ? keptById.get(e.workItem) : null;
    const itemNode = item ? workNodeId(item.id) : null;
    const agentNode = e.agent && nodeIds.has(agentNodeId(e.agent)) ? agentNodeId(e.agent) : null;
    const actor = agentNode ?? hubId;
    let path: (string | null)[];
    switch (e.kind) {
      case 'merge':
        // The only way into the integration branch: the branch merges, the code lands in its sector.
        path = [itemNode ?? agentNode, hubId, sectorNode];
        break;
      case 'claim':
        // The claim prescribes a branch at the integration branch's tip.
        path = [hubId, itemNode ?? sectorNode];
        break;
      case 'plan':
        path = [actor, itemNode ?? sectorNode ?? hubId];
        break;
      case 'result':
      case 'rating':
        // Measured on the branch when there is one, otherwise on what the sector ships.
        path = itemNode ? [actor, itemNode] : [agentNode ?? hubId, sectorNode];
        break;
      case 'milestone':
        // Gate matches measure a branch; rungs are cleared by what is on the integration branch.
        path = itemNode ? [actor, itemNode] : [hubId, sectorNode];
        break;
      default:
        path = [actor, itemNode ?? sectorNode ?? hubId];
    }
    const clean = path.filter((p): p is string => Boolean(p));
    const deduped = clean.filter((p, i) => i === 0 || p !== clean[i - 1]!);
    if (deduped.length < 2 && !options.keepUnplacedEvents) continue;
    flows.push({
      id: e.id,
      at: e.at,
      kind: e.kind,
      title: e.title,
      sub: e.sub ?? null,
      group: e.group ?? null,
      outcome: e.outcome ?? null,
      delta: e.delta ?? null,
      agent: e.agent,
      sector: s,
      path: deduped,
      weight: weights[e.kind],
    });
  }

  return {
    hubId,
    nodes,
    links,
    flows,
    totals: {
      effort: total,
      live: [...shown.values()].filter((a) => a.status === 'working').length,
      agents: shown.size,
      sectors: input.sectors.length,
      branches,
      pullRequests: pullRequestNumbers.size + unnumberedPullRequests,
      stages,
    },
  };
};
