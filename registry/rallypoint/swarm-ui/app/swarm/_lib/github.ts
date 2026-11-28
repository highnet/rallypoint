/**
 * A server-side, READ-ONLY GitHub REST reader. GitHub owns the work: issues,
 * labels and pull requests. Reads `RALLYPOINT_GITHUB_REPO` ("owner/name")
 * and the optional `RALLYPOINT_GITHUB_TOKEN` (raises rate limits, reads
 * private repositories). The token never reaches the browser. Responses are
 * cached for 120 seconds. `RALLYPOINT_GITHUB_API_URL` (optional) points at a
 * GitHub Enterprise Server API, e.g. https://ghe.example.com/api/v3.
 */

import { githubFailureGuidance, githubNoRepoGuidance, type Guidance } from "./guidance";

export const ENV_REPO = "RALLYPOINT_GITHUB_REPO";
export const ENV_TOKEN = "RALLYPOINT_GITHUB_TOKEN";

const API = (process.env.RALLYPOINT_GITHUB_API_URL?.trim() || "https://api.github.com").replace(/\/+$/, "");
/** The web host for links: github.com, or the Enterprise host of the API URL. */
const WEB = API === "https://api.github.com" ? "https://github.com" : API.replace(/\/api\/v3$/, "");
const REVALIDATE_SECONDS = 120;
/** Pages of 100 issues/PRs read per request (most recently updated first). */
const MAX_PAGES = 3;

/**
 * The label names the board sorts by. These are the defaults
 * `rallypoint init` creates (`.rallypoint/config.json`); change them here
 * if your repository renamed any.
 */
export const LABELS = {
  ready: "status:ready",
  claimed: "status:claimed",
  blocked: "status:blocked",
  deferred: "status:deferred",
  human: "needs:human",
  changesRequested: "status:changes-requested",
  approved: "review:approved",
  targetPrefix: "target:",
} as const;

export type GithubLabel = { name: string; color: string };

export type GithubItem = {
  number: number;
  title: string;
  url: string;
  isPullRequest: boolean;
  state: "open" | "closed";
  /** "completed" | "not_planned" | null, for issues. */
  stateReason: string | null;
  mergedAt: string | null;
  labels: GithubLabel[];
  author: string | null;
  updatedAt: string;
  createdAt: string;
  closedAt: string | null;
  /** For PRs: issue numbers named by "Closes #N" / "Fixes #N" / "Resolves #N". */
  closes: number[];
};

export type GithubReadResult<T> =
  | { ok: true; data: T; truncated: boolean }
  | GithubFailure;

/**
 * A failed read. `message` is the one-line problem; `guidance` is the whole
 * banner (problem, steps, when it applies). Both are composed from status
 * codes and env-var presence only, never from the token's value.
 */
export type GithubFailure = { ok: false; reason: "no-repo" | "error"; message: string; guidance: Guidance };

type Resource = "issues" | "contents";

export function readGithubRepo(): string | null {
  const repo = process.env.RALLYPOINT_GITHUB_REPO?.trim() ?? "";
  return /^[\w.-]+\/[\w.-]+$/.test(repo) ? repo : null;
}

/** A link to an issue or PR. GitHub redirects /issues/N to /pull/N for PRs. */
export function githubRefUrl(ref: number | string | null | undefined): string | null {
  const repo = readGithubRepo();
  if (!repo || ref === null || ref === undefined) return null;
  const number = typeof ref === "number" ? ref : Number(String(ref).replace(/^#/, ""));
  if (!Number.isInteger(number) || number <= 0) return null;
  return `${WEB}/${repo}/issues/${number}`;
}

export function githubRepoUrl(path = ""): string | null {
  const repo = readGithubRepo();
  return repo ? `${WEB}/${repo}${path}` : null;
}

function githubHeaders(accept = "application/vnd.github+json"): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: accept,
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "rallypoint-swarm-ui",
  };
  const token = process.env.RALLYPOINT_GITHUB_TOKEN?.trim();
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function githubFetch(path: string, accept?: string, revalidate = REVALIDATE_SECONDS): Promise<Response> {
  return fetch(`${API}${path}`, {
    headers: githubHeaders(accept),
    next: { revalidate },
  });
}

function token(): string | undefined {
  return process.env.RALLYPOINT_GITHUB_TOKEN;
}

function fromGuidance(reason: GithubFailure["reason"], guidance: Guidance): GithubFailure {
  return { ok: false, reason, message: guidance.problem.replace(/[`*]/g, ""), guidance };
}

function noRepo(): GithubFailure {
  return fromGuidance("no-repo", githubNoRepoGuidance(Boolean(process.env.RALLYPOINT_GITHUB_REPO?.trim())));
}

function failure(res: Response, repo: string, resource: Resource, contentsDenied = false): GithubFailure {
  return fromGuidance(
    "error",
    githubFailureGuidance({
      status: res.status,
      repo,
      token: token(),
      rateLimitRemaining: res.headers.get("x-ratelimit-remaining"),
      resource,
      contentsDenied,
      enterprise: API !== "https://api.github.com",
    }),
  );
}

function unreachable(cause: unknown, repo: string, resource: Resource): GithubFailure {
  return fromGuidance(
    "error",
    githubFailureGuidance({
      status: 0,
      repo,
      token: token(),
      resource,
      networkMessage: cause instanceof Error ? cause.message : undefined,
      enterprise: API !== "https://api.github.com",
    }),
  );
}

type RawIssue = {
  number: number;
  title: string;
  html_url: string;
  state: "open" | "closed";
  state_reason?: string | null;
  labels: ({ name?: string; color?: string } | string)[];
  user?: { login?: string } | null;
  updated_at: string;
  created_at: string;
  closed_at: string | null;
  body?: string | null;
  pull_request?: { merged_at?: string | null } | null;
};

const CLOSING = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s*:?\s+#(\d+)/gi;

function closingRefs(body: string | null | undefined): number[] {
  if (!body) return [];
  return [...body.matchAll(CLOSING)].map((match) => Number(match[1]));
}

function toItem(raw: RawIssue): GithubItem {
  return {
    closes: raw.pull_request ? closingRefs(raw.body) : [],
    number: raw.number,
    title: raw.title,
    url: raw.html_url,
    isPullRequest: Boolean(raw.pull_request),
    state: raw.state,
    stateReason: raw.state_reason ?? null,
    mergedAt: raw.pull_request?.merged_at ?? null,
    labels: raw.labels.map((label) =>
      typeof label === "string"
        ? { name: label, color: "ededed" }
        : { name: label.name ?? "", color: label.color ?? "ededed" },
    ),
    author: raw.user?.login ?? null,
    updatedAt: raw.updated_at,
    createdAt: raw.created_at,
    closedAt: raw.closed_at,
  };
}

/**
 * Issues and pull requests (GitHub's issues endpoint returns both), most
 * recently updated first, up to MAX_PAGES × 100. `truncated` is true when
 * more exist than were read.
 */
export async function listItems(): Promise<GithubReadResult<GithubItem[]>> {
  const repo = readGithubRepo();
  if (!repo) {
    return noRepo();
  }
  const items: GithubItem[] = [];
  try {
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const res = await githubFetch(
        `/repos/${repo}/issues?state=all&sort=updated&direction=desc&per_page=100&page=${page}`,
      );
      if (!res.ok) return failure(res, repo, "issues");
      const batch = (await res.json()) as RawIssue[];
      items.push(...batch.map(toItem));
      if (batch.length < 100) return { ok: true, data: items, truncated: false };
    }
    return { ok: true, data: items, truncated: true };
  } catch (cause) {
    return unreachable(cause, repo, "issues");
  }
}

/** Bound optional path enrichment so it cannot use the whole anonymous API quota. */
export const FLEET_PATH_PULL_LIMIT = 6;

export async function readPullPaths(repo: string, number: number): Promise<{ paths: string[]; truncated: boolean } | null> {
  try {
    const response = await githubFetch(`/repos/${repo}/pulls/${number}/files?per_page=100`, undefined, 1800);
    if (!response.ok) return null;
    const files = (await response.json()) as { filename: string; previous_filename?: string }[];
    return {
      paths: files.flatMap((file) => file.previous_filename ? [file.filename, file.previous_filename] : [file.filename]),
      truncated: response.headers.get("link")?.includes('rel="next"') ?? false,
    };
  } catch {
    return null;
  }
}

/**
 * The repository's default branch (`GET /repos/{repo}`), which is where most
 * Rallypoint projects integrate. Null when GitHub cannot be read.
 */
export async function readDefaultBranch(): Promise<string | null> {
  const repo = readGithubRepo();
  if (!repo) return null;
  try {
    const res = await githubFetch(`/repos/${repo}`);
    if (!res.ok) return null;
    const body = (await res.json()) as { default_branch?: unknown };
    return typeof body.default_branch === "string" && body.default_branch ? body.default_branch : null;
  } catch {
    return null;
  }
}

export type RepoEntry = {
  name: string;
  path: string;
  type: "file" | "dir";
  url: string;
};

/** `GET /repos/{repo}/contents/{dir}`: one directory listing. */
export async function listDirectory(dir: string): Promise<GithubReadResult<RepoEntry[]>> {
  const repo = readGithubRepo();
  if (!repo) {
    return noRepo();
  }
  try {
    const res = await githubFetch(`/repos/${repo}/contents/${encodePath(dir)}`);
    if (res.status === 404) {
      // GitHub says 404 both for a folder that does not exist and for files
      // it will not show (private repository without a token, or a token
      // without Contents permission). Only call the folder empty when the
      // repository's root listing can be read.
      const root = await githubFetch(`/repos/${repo}/contents/`);
      if (root.ok) return { ok: true, data: [], truncated: false };
      if (root.status === 404 && token()?.trim()) {
        const meta = await githubFetch(`/repos/${repo}`);
        if (meta.ok) return failure(root, repo, "contents", true);
      }
      return failure(root, repo, "contents");
    }
    if (!res.ok) return failure(res, repo, "contents");
    const body = (await res.json()) as
      | { name: string; path: string; type: string; html_url: string }[]
      | Record<string, unknown>;
    if (!Array.isArray(body)) return { ok: true, data: [], truncated: false };
    return {
      ok: true,
      truncated: false,
      data: body
        .filter((entry) => entry.type === "file" || entry.type === "dir")
        .map((entry) => ({
          name: entry.name,
          path: entry.path,
          type: entry.type as "file" | "dir",
          url: entry.html_url,
        })),
    };
  } catch (cause) {
    return unreachable(cause, repo, "contents");
  }
}

/** One file's raw text through the contents API. */
export async function readFile(path: string): Promise<GithubReadResult<string>> {
  const repo = readGithubRepo();
  if (!repo) {
    return noRepo();
  }
  try {
    const res = await githubFetch(
      `/repos/${repo}/contents/${encodePath(path)}`,
      "application/vnd.github.raw+json",
    );
    if (!res.ok) return failure(res, repo, "contents");
    return { ok: true, data: await res.text(), truncated: false };
  } catch (cause) {
    return unreachable(cause, repo, "contents");
  }
}

function encodePath(path: string): string {
  return path
    .split("/")
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join("/");
}

/* ───────────────────────── Lanes and delivery ───────────────────────── */

export const LANES = [
  { id: "backlog", label: "Backlog", description: "Open issues ready to claim." },
  { id: "claimed", label: "Claimed", description: "Reserved by one worker right now." },
  { id: "held", label: "Held", description: "Blocked, deferred or waiting on a human." },
  { id: "review", label: "In review", description: "Pull requests waiting for an independent verdict." },
  { id: "changes", label: "Changes asked", description: "Sent back to a fixer." },
  { id: "approved", label: "Approved", description: "Approved at the head SHA, waiting for a merger." },
  { id: "merged", label: "Merged", description: "Landed lately." },
] as const;

export type LaneId = (typeof LANES)[number]["id"];

const hasLabel = (item: GithubItem, name: string) =>
  item.labels.some((label) => label.name === name);

export function laneOf(item: GithubItem): LaneId | null {
  if (item.isPullRequest) {
    if (item.mergedAt) return "merged";
    if (item.state === "closed") return null;
    if (hasLabel(item, LABELS.approved)) return "approved";
    if (hasLabel(item, LABELS.changesRequested)) return "changes";
    return "review";
  }
  if (item.state === "closed") return null;
  if (
    hasLabel(item, LABELS.blocked) ||
    hasLabel(item, LABELS.deferred) ||
    hasLabel(item, LABELS.human)
  ) {
    return "held";
  }
  if (hasLabel(item, LABELS.claimed)) return "claimed";
  return "backlog";
}

export function targetsOf(item: GithubItem): string[] {
  return item.labels
    .filter((label) => label.name.startsWith(LABELS.targetPrefix))
    .map((label) => label.name.slice(LABELS.targetPrefix.length));
}

/**
 * Delivery progress: every issue counted once, in the furthest state it has
 * reached. Pull requests are linked to issues by "Closes #N" in their body.
 */
export type Delivery = {
  /** Issues counted: every issue except those closed as not planned. */
  total: number;
  /** Issues closed as completed. */
  merged: number;
  /** Open issues whose linked open PR is approved. */
  approved: number;
  /** Open issues with a linked open PR and no approval yet. */
  inReview: number;
  /** Open issues claimed by a worker, with no PR yet. */
  inBranch: number;
  /** Open issues nobody has claimed. */
  open: number;
};

/** Delivery progress, optionally for one `target:<id>` label. */
export function deliveryOf(items: GithubItem[], target?: string): Delivery {
  const openPrs = new Map<number, GithubItem>();
  for (const item of items) {
    if (!item.isPullRequest || item.state !== "open") continue;
    for (const issue of item.closes) {
      const known = openPrs.get(issue);
      if (!known || hasLabel(item, LABELS.approved)) openPrs.set(issue, item);
    }
  }
  const delivery: Delivery = { total: 0, merged: 0, approved: 0, inReview: 0, inBranch: 0, open: 0 };
  for (const item of items) {
    if (item.isPullRequest) continue;
    if (target && !hasLabel(item, `${LABELS.targetPrefix}${target}`)) continue;
    if (item.state === "closed") {
      if (item.stateReason === "not_planned") continue;
      delivery.total += 1;
      delivery.merged += 1;
      continue;
    }
    delivery.total += 1;
    const pr = openPrs.get(item.number);
    if (pr && hasLabel(pr, LABELS.approved)) delivery.approved += 1;
    else if (pr) delivery.inReview += 1;
    else if (hasLabel(item, LABELS.claimed)) delivery.inBranch += 1;
    else delivery.open += 1;
  }
  return delivery;
}
