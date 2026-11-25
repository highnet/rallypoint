// Role selection for a swarm session. Pure: no GitHub, no network, no clock.
//
// A new session takes the FIRST role in `roleOrder` that has something
// waiting. Finishing work beats starting it, so the default order empties the
// right-hand side of the board first:
//
//   merger → fixer → reviewer → improver → worker → planner → janitor
//
// `queues` counts what waits for each role. `computeQueues` derives it from
// the open pull requests and issues (as `gh --json` returns them), the
// coordination report, and the memory's metrics.

export const DEFAULT_ROLE_ORDER = [
  "merger",
  "fixer",
  "reviewer",
  "improver",
  "worker",
  "planner",
  "janitor",
];

export const ROLE_WHEN = {
  merger: "a pull request has an independent approve",
  fixer: "a review asked for changes",
  reviewer: "a pull request waits for a verdict",
  improver: "enough retros have landed since the last protocol change",
  worker: "a claimable issue is open",
  planner: "nothing claimable is open",
  janitor: "claims, leases or labels disagree",
};

const HOLD_LABELS = (labels) => [
  labels.claimed ?? "status:claimed",
  labels.blocked ?? "status:blocked",
  labels.deferred ?? "status:deferred",
  labels.human ?? "needs:human",
];

const JANITOR_KINDS = new Set([
  "unclaimable",
  "unprotected",
  "janitorCandidate",
  "assigneeDrift",
  "closedWithStatusLabel",
  "blockedWithClearedDependencies",
]);

const names = (item) => (item.labels ?? []).map((label) => (typeof label === "string" ? label : label.name));

const PRIORITY = (item) => {
  const match = names(item).map((name) => /^prio:p(\d)$/.exec(name)).find(Boolean);
  return match ? Number(match[1]) : 9;
};

const CLOSES = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?|refs?)\s+#(\d+)/gi;

/** Issue numbers a pull request body points at. */
export const referencedIssues = (body = "") =>
  [...String(body).matchAll(CLOSES)].map((match) => Number(match[1]));

/**
 * Whether an issue or pull request belongs to `target`. With no target every
 * item matches. A pull request matches through its own `target:` label or
 * through an issue it closes.
 */
export const inTarget = (item, target, issuesByNumber = new Map()) => {
  if (!target) return true;
  const label = `target:${target}`;
  if (names(item).includes(label)) return true;
  return referencedIssues(item.body).some((n) => names(issuesByNumber.get(n) ?? {}).includes(label));
};

/**
 * @param {{
 *   pulls: Array<{number:number,title?:string,labels?:any[],isDraft?:boolean,body?:string}>,
 *   issues: Array<{number:number,title?:string,labels?:any[],assignees?:any[]}>,
 *   labels?: Record<string,string>,
 *   target?: string|null,
 *   retrosSinceChange?: number|null,
 *   improverRetroThreshold?: number,
 *   improvementOpen?: boolean,
 *   disagreements?: Array<{kind:string}>|null,
 * }} input
 */
export const computeQueues = ({
  pulls,
  issues,
  labels = {},
  target = null,
  retrosSinceChange = 0,
  improverRetroThreshold = 3,
  improvementOpen = false,
  disagreements = [],
}) => {
  const approved = labels.approved ?? "review:approved";
  const changes = labels.changesRequested ?? "status:changes-requested";
  const holds = HOLD_LABELS(labels);
  const issuesByNumber = new Map(issues.map((issue) => [issue.number, issue]));

  const openPulls = pulls.filter((pr) => !pr.isDraft && inTarget(pr, target, issuesByNumber));
  const mergeable = openPulls.filter((pr) => names(pr).includes(approved));
  const fixable = openPulls.filter((pr) => names(pr).includes(changes));
  const reviewable = openPulls.filter((pr) => !names(pr).includes(approved) && !names(pr).includes(changes));

  const scoped = issues.filter((issue) => inTarget(issue, target));
  const claimable = scoped
    .filter((issue) => !names(issue).some((name) => holds.includes(name)))
    .filter((issue) => (issue.assignees ?? []).length === 0)
    .sort((a, b) => PRIORITY(a) - PRIORITY(b) || a.number - b.number);

  const improverDue = !improvementOpen && (retrosSinceChange ?? 0) >= improverRetroThreshold;
  const janitorItems = (disagreements ?? []).filter((item) => JANITOR_KINDS.has(item.kind));

  const byOldest = (a, b) => a.number - b.number;
  return {
    merger: { count: mergeable.length, next: mergeable.sort(byOldest)[0] ?? null, kind: "pr" },
    fixer: { count: fixable.length, next: fixable.sort(byOldest)[0] ?? null, kind: "pr" },
    reviewer: { count: reviewable.length, next: reviewable.sort(byOldest)[0] ?? null, kind: "pr" },
    improver: { count: improverDue ? 1 : 0, next: null, kind: null },
    worker: { count: claimable.length, next: claimable[0] ?? null, kind: "issue" },
    planner: { count: scoped.length === 0 ? 1 : 0, next: null, kind: null },
    janitor: { count: janitorItems.length, next: null, kind: null },
  };
};

/**
 * Picks the first role in `order` (optionally restricted to `only`) whose
 * queue is non-empty. Returns null when nothing waits.
 */
export const pickRole = ({ queues, order = DEFAULT_ROLE_ORDER, only = null }) => {
  const allowed = only && only.length ? order.filter((role) => only.includes(role)) : order;
  for (const role of allowed) {
    const queue = queues[role];
    if (queue && queue.count > 0) return { role, ...queue };
  }
  return null;
};
