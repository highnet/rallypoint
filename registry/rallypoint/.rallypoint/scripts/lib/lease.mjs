// Session leases, with every call to `gh` injected.
//
// `claim.mjs` makes one role's in-flight work visible the moment it starts: the
// reservation ref exists before any branch or pull request does, so a second
// session can see that a worker is already on an issue. No other role has that.
// A reviewer, fixer, merger, janitor, or planner becomes visible only when its
// work *lands* — a recorded verdict, a merge, a released claim — and in the
// interval between "the orchestrator recommended this session" and "that session
// had an effect", the board looks identical to nobody being on it. So a second
// orchestrator surveying an unchanged board recommends the same session again,
// in good faith, off correct data.
//
// A lease closes that interval. It is a claim on a *target*, written when a
// session is dispatched, that expires. It is orchestrator-to-orchestrator
// communication: the dispatched session never has to know it exists, never
// reads one, and never writes one.
//
//   rallypoint-sessions/pr-<N>-<role>  reviewer, fixer, merger — per pull request
//   rallypoint-sessions/<role>         janitor, planner — over everything, one at a time
//
// The ref name is deterministic, which is the whole guarantee: `POST /git/refs`
// refuses a second creation of the same ref, so exactly one caller wins a race,
// the same atomicity `claim.mjs` relies on. Refs are shared across operators,
// machines, and worktrees, which is what this needs — orchestrators here run on
// more than one machine and this repository is worked through `git worktree`, so
// the record can be neither process-local nor a file in a checkout.
//
// ## Why the ref points at a lease commit rather than at the head SHA
//
// A lease needs two facts: which revision it was dispatched against, and when.
// The first alone is not enough — a session dispatched but never booted, against
// a branch that never moves again, would hold its target forever, which is what
// the TTL exists to bound.
//
// GitHub records no creation time for a ref, so the time has to live in the
// object the ref points at. Both facts therefore go into a lease commit written
// at dispatch:
//
//   - its **first parent** is the head SHA the session was dispatched against,
//     which is the head-SHA binding `review.mjs` already lives by;
//   - its **committer date** is the dispatch time, which is the TTL's clock;
//   - its **message** carries the role, the agent id, and the target, so a lease
//     is self-describing rather than only meaningful next to the ref name.
//
// Pointing the ref at the head SHA directly would have made the head comparison
// free, but there would then be no dispatch time anywhere at all, and deriving
// one from the head commit's own date is unsound in the dangerous direction: a
// branch that has not moved for a day would read as an expired lease and be
// dispatched a second time, which is precisely the bug this module exists to
// stop. Creating the commit is the cost of a TTL that cannot lie.
//
// Naming is unaffected by any of this: the ref name is still deterministic, so
// the create is still atomic. Only what the winner's ref points at changed.
//
// ## The rule underneath everything here
//
// A lookup that failed resolves to **unknown**, never to "free". The same rule
// `report.mjs` and `release-claim.mjs` already state, and the one whose
// violation is how stale warnings get written: an error, a non-array body, or a response that
// filled its page is not evidence of absence. Presence is established by
// *listing* the ref, never inferred from a create's or a delete's failure.

import { SAFE_AGENT_ID } from "../provenance.mjs";
import { matchingRefs, openPullRequests } from "./release-claim.mjs";

// Exit codes are a public interface in this loop, as they are for `review.mjs`,
// `release-claim.mjs`, and `report.mjs`. Keep them in sync with the table in
// docs/AGENT_LOOP.md.
export const EXIT = {
  ok: 0,
  usage: 1,
  held: 2, // a live lease already covers the target: somebody else has it
  inconclusive: 3, // a lookup could not be established; nothing was written
  writeFailed: 4, // the ref itself could not be created, updated, or deleted
  noTarget: 5, // the pull request a lease was asked for is not open
};

const HOUR_MS = 3_600_000;

// Roles whose work attaches to one pull request, and roles whose pass is over
// everything and so has nothing to attach to. The split decides both the ref
// name and whether `--pr` is required or refused.
export const PULL_REQUEST_ROLES = Object.freeze(["reviewer", "fixer", "merger"]);
export const TARGETLESS_ROLES = Object.freeze(["janitor", "planner"]);
export const ROLES = Object.freeze([
  ...PULL_REQUEST_ROLES,
  ...TARGETLESS_ROLES,
]);

/**
 * The first informative line of a `gh` failure. `execFileSync` puts the useful
 * part on `stderr` and leaves `message` as the command line.
 *
 * @param {unknown} error
 */
const describeError = (error) => {
  const detail = /** @type {{ stderr?: unknown, message?: unknown }} */ (
    error ?? {}
  );
  const text = String(detail.stderr ?? detail.message ?? error ?? "").trim();
  return (
    text
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line !== "")
      ?.slice(0, 200) ?? "no detail reported"
  );
};

/**
 * @template T
 * @typedef {{ ok: true, items: T[] } | { ok: false, reason: string }} Lookup
 */

/**
 * The ref name (without `refs/heads/`) a lease for this target occupies.
 *
 * @param {{ prefix: string, role: string, pr?: string | null }} input
 */
export const leaseRefName = ({ prefix, role, pr }) =>
  pr == null || pr === "" ? `${prefix}${role}` : `${prefix}pr-${pr}-${role}`;

/**
 * The target a lease ref names, or `null` when the ref does not fit either
 * shape. A ref outside the two shapes is never guessed at: `readLeases` reports
 * it as an unreadable lease, which is not "free".
 *
 * @param {string | null | undefined} refName With or without `refs/heads/`.
 * @param {string} prefix
 * @returns {{ role: string, pr: string | null } | null}
 */
export const parseLeaseRefName = (refName, prefix) => {
  const bare = (refName ?? "").replace(/^refs\/heads\//, "");

  if (!bare.startsWith(prefix)) return null;

  const rest = bare.slice(prefix.length);
  const targeted = rest.match(/^pr-(\d+)-([a-z][a-z-]*)$/);

  if (targeted) {
    return PULL_REQUEST_ROLES.includes(targeted[2])
      ? { role: targeted[2], pr: targeted[1] }
      : null;
  }

  return TARGETLESS_ROLES.includes(rest) ? { role: rest, pr: null } : null;
};

/**
 * The lease commit's message. Written as trailers so the record survives being
 * read by a human in `git log` and by `parseLeaseMessage` below, and so a lease
 * is self-describing rather than only meaningful next to its ref name.
 *
 * @param {{ role: string, pr: string | null, agentId: string, head: string }} input
 */
export const leaseMessage = ({ role, pr, agentId, head }) =>
  [
    `Rallypoint session lease: ${role}${pr == null ? "" : ` on #${pr}`}`,
    "",
    "Written when the session was dispatched, not when it started, so it also",
    "covers the interval before that session boots. Release it with",
    "`lease.mjs --release`, or leave it for the janitor sweep once its TTL",
    "expires. The dispatched session neither reads nor writes this.",
    "",
    `Rallypoint-Lease-Role: ${role}`,
    `Rallypoint-Lease-Agent: ${agentId}`,
    `Rallypoint-Lease-Target: ${pr == null ? "role" : `pr-${pr}`}`,
    `Rallypoint-Lease-Head: ${head}`,
  ].join("\n");

/** @param {string} name */
const trailer = (name) =>
  new RegExp(`^Rallypoint-Lease-${name}:[^\\S\\n]*(\\S+)[^\\S\\n]*$`, "m");

/**
 * @param {string | null | undefined} message
 * @returns {{ role: string, agent: string, pr: string | null, head: string } | null}
 */
export const parseLeaseMessage = (message) => {
  const text = message ?? "";
  const role = text.match(trailer("Role"))?.at(1);
  const agent = text.match(trailer("Agent"))?.at(1);
  const target = text.match(trailer("Target"))?.at(1);
  const head = text.match(trailer("Head"))?.at(1);

  if (!role || !agent || !target || !head) return null;
  if (!ROLES.includes(role)) return null;

  if (target === "role") {
    return TARGETLESS_ROLES.includes(role)
      ? { role, agent, pr: null, head }
      : null;
  }

  const pr = target.match(/^pr-(\d+)$/)?.at(1);

  return pr && PULL_REQUEST_ROLES.includes(role)
    ? { role, agent, pr, head }
    : null;
};

/**
 * @typedef {{
 *   refName: string,
 *   refPath: string,
 *   sha: string | null,
 *   role: string,
 *   pr: string | null,
 *   agent: string,
 *   head: string,
 *   dispatchedAt: string,
 * }} ReadableLease
 */

/**
 * @typedef {{ refName: string, refPath: string, sha: string | null, reason: string }} UnreadableLease
 */

/**
 * @typedef {({ readable: true } & ReadableLease) | ({ readable: false } & UnreadableLease)} ResolvedLease
 */

/**
 * Resolves one lease ref to the commit behind it. A lease this cannot read is
 * returned as `readable: false` rather than dropped: a ref that exists but
 * cannot be interpreted still means something is on that target, and dropping
 * it would silently turn an unreadable lease into a free one.
 *
 * @param {(...args: string[]) => string} gh
 * @param {string} repository
 * @param {{ ref?: string, object?: { sha?: string } }} ref
 * @param {string} prefix
 * @returns {ResolvedLease}
 */
export const resolveLease = (gh, repository, ref, prefix) => {
  const refName = String(ref.ref ?? "").replace(/^refs\/heads\//, "");
  const refPath = `refs/heads/${refName}`;
  const sha = ref.object?.sha ?? null;
  /** @param {string} reason */
  const unreadable = (reason) => ({
    readable: /** @type {false} */ (false),
    refName,
    refPath,
    sha,
    reason,
  });

  const target = parseLeaseRefName(refName, prefix);

  if (!target) {
    return unreadable(
      `\`${refName}\` is under the session namespace but names no role or target this understands`,
    );
  }

  if (!sha) {
    return unreadable(`\`${refName}\` was listed without a SHA`);
  }

  let commit;

  try {
    commit = JSON.parse(gh("api", `repos/${repository}/git/commits/${sha}`));
  } catch (error) {
    return unreadable(
      `the lease commit behind \`${refName}\` could not be read (${describeError(error)})`,
    );
  }

  const record = parseLeaseMessage(commit?.message);

  if (!record) {
    return unreadable(
      `the lease commit behind \`${refName}\` carries no readable Rallypoint lease record`,
    );
  }

  // The ref name and the commit's own record are two independent statements of
  // the same fact. Disagreement means one of them was written by something
  // other than this command, and guessing which to believe is exactly the kind
  // of inference this module refuses to make.
  if (record.role !== target.role || record.pr !== target.pr) {
    return unreadable(
      `\`${refName}\` and its lease commit disagree about the target (ref says ${target.role}/${target.pr ?? "role"}, commit says ${record.role}/${record.pr ?? "role"})`,
    );
  }

  // The dispatched head is recorded twice over — as the trailer and as the
  // commit's first parent — for the same reason `review.mjs` binds a verdict
  // both in its block and through GitHub's own submitted-commit record.
  const parent = commit?.parents?.at(0)?.sha;

  if (parent && parent !== record.head) {
    return unreadable(
      `the lease commit behind \`${refName}\` names head \`${record.head}\` but is parented on \`${parent}\``,
    );
  }

  const dispatchedAt = commit?.committer?.date ?? commit?.author?.date;

  if (typeof dispatchedAt !== "string") {
    return unreadable(
      `the lease commit behind \`${refName}\` reported no timestamp, so its TTL cannot be established`,
    );
  }

  return {
    readable: true,
    refName,
    refPath,
    sha,
    role: record.role,
    pr: record.pr,
    agent: record.agent,
    head: record.head,
    dispatchedAt,
  };
};

/**
 * Every lease under the session namespace.
 *
 * One `matching-refs` call establishes the namespace, then one commit read per
 * ref found resolves its dispatch time and head — the price of a TTL that is
 * recorded rather than inferred (see the header). That per-lease cost is bounded
 * by the number of sessions actually in flight, which is a handful; the listing
 * itself is the only call that scales with anything else.
 *
 * @param {(...args: string[]) => string} gh
 * @param {string} repository
 * @param {string} prefix
 * @returns {Lookup<ResolvedLease>}
 */
export const readLeases = (gh, repository, prefix) => {
  const refs = matchingRefs(gh, repository, prefix);

  if (!refs.ok) return refs;

  return {
    ok: true,
    items: refs.items.map((ref) => resolveLease(gh, repository, ref, prefix)),
  };
};

/**
 * @typedef {(
 *   | { kind: "live", detail: string }
 *   | { kind: "staleByHead", detail: string }
 *   | { kind: "staleByTtl", detail: string }
 *   | { kind: "targetGone", detail: string }
 *   | { kind: "unknown", reason: string }
 * )} LeaseState
 */

/**
 * What a lease means right now. Only `live` is coverage; every other state
 * except `unknown` means the target is free, and `unknown` means neither.
 *
 * TTL is checked before the head, because a lease past its TTL is stale
 * whatever the branch did — that is the point of having a TTL at all: a session
 * dispatched but never booted, against a branch that never moves again, would
 * otherwise hold its target forever.
 *
 * @param {{
 *   lease: ResolvedLease,
 *   head: { known: true, sha: string | null } | { known: false, reason: string },
 *   now: number,
 *   staleClaimHours: number,
 * }} input
 * @returns {LeaseState}
 */
export const leaseState = ({ lease, head, now, staleClaimHours }) => {
  if (!lease.readable) return { kind: "unknown", reason: lease.reason };

  const dispatchedAt = Date.parse(lease.dispatchedAt);

  if (Number.isNaN(dispatchedAt)) {
    return {
      kind: "unknown",
      reason: `the lease commit behind \`${lease.refName}\` has an unreadable timestamp (${lease.dispatchedAt})`,
    };
  }

  const ageHours = (now - dispatchedAt) / HOUR_MS;

  if (ageHours > staleClaimHours) {
    return {
      kind: "staleByTtl",
      detail: `dispatched by \`${lease.agent}\` at ${lease.dispatchedAt} (${ageHours.toFixed(1)}h ago), past the ${staleClaimHours}h TTL`,
    };
  }

  if (lease.pr == null) {
    return {
      kind: "live",
      detail: `held by \`${lease.agent}\` since ${lease.dispatchedAt} (${ageHours.toFixed(1)}h ago)`,
    };
  }

  if (!head.known) {
    return {
      kind: "unknown",
      reason: `the current head of #${lease.pr} could not be established (${head.reason}), so whether \`${lease.refName}\` still matches it is unknown`,
    };
  }

  if (head.sha === null) {
    return {
      kind: "targetGone",
      detail: `#${lease.pr} is not open, so the target \`${lease.refName}\` covers no longer exists`,
    };
  }

  if (head.sha !== lease.head) {
    return {
      kind: "staleByHead",
      detail: `dispatched against \`${lease.head.slice(0, 7)}\` but #${lease.pr} is now at \`${head.sha.slice(0, 7)}\`; the branch moved`,
    };
  }

  return {
    kind: "live",
    detail: `held by \`${lease.agent}\` at \`${lease.head.slice(0, 7)}\` since ${lease.dispatchedAt} (${ageHours.toFixed(1)}h ago)`,
  };
};

/**
 * @typedef {ResolvedLease & { state: LeaseState }} SummarizedLease
 */

/**
 * Every lease paired with what it currently means, resolved against the open
 * pull request listing the caller already has. Nothing here makes a network
 * call: `report.mjs` reuses its own open-pull-request read, and a listing it
 * could not establish turns every pull-request lease into `unknown` rather than
 * into a free target.
 *
 * @param {{
 *   leases: Lookup<ResolvedLease>,
 *   prs: Lookup<{ number: number, headRefOid: string }>,
 *   now: number,
 *   staleClaimHours: number,
 * }} input
 * @returns {{ known: true, items: SummarizedLease[] } | { known: false, reason: string }}
 */
export const summarizeLeases = ({ leases, prs, now, staleClaimHours }) => {
  if (!leases.ok) return { known: false, reason: leases.reason };

  const headByPr = new Map(
    prs.ok ? prs.items.map((pull) => [String(pull.number), pull.headRefOid]) : [],
  );

  return {
    known: true,
    items: leases.items.map((item) => ({
      ...item,
      state: leaseState({
        lease: item,
        head: prs.ok
          ? {
              known: true,
              sha: item.readable && item.pr !== null
                ? (headByPr.get(item.pr) ?? null)
                : null,
            }
          : { known: false, reason: prs.reason },
        now,
        staleClaimHours,
      }),
    })),
  };
};

/**
 * Whether a live lease covers one pull request, for every role that can hold
 * one. This is what the orchestrator's added recommendation condition reads:
 * `covered` means skip, `free` means recommend, and `unknown` means say so in
 * the round's reasoning rather than recommending through it.
 *
 * @param {{
 *   summary: { known: true, items: SummarizedLease[] } | { known: false, reason: string },
 *   pr: string,
 *   role: string,
 * }} input
 * @returns {{ kind: "covered", detail: string } | { kind: "free" } | { kind: "unknown", reason: string }}
 */
export const coverage = ({ summary, pr, role }) => {
  if (!summary.known) return { kind: "unknown", reason: summary.reason };

  for (const lease of summary.items) {
    const matches = lease.readable
      ? lease.role === role && lease.pr === pr
      : lease.refName.endsWith(`pr-${pr}-${role}`) ||
        lease.refName.endsWith(`/${role}`);

    if (!matches) continue;
    if (lease.state.kind === "unknown") {
      return { kind: "unknown", reason: lease.state.reason };
    }
    if (lease.state.kind === "live") {
      return { kind: "covered", detail: lease.state.detail };
    }
  }

  return { kind: "free" };
};

/**
 * The current head of a pull request, distinguishing "not open" from "could not
 * be asked".
 *
 * @param {(...args: string[]) => string} gh
 * @param {string} pr
 * @returns {{ ok: true, state: string, head: string } | { ok: false, open: boolean, reason: string }}
 */
export const pullRequestHead = (gh, pr) => {
  let view;

  try {
    view = JSON.parse(gh("pr", "view", pr, "--json", "number,state,headRefOid"));
  } catch (error) {
    return {
      ok: false,
      open: true,
      reason: `#${pr} could not be read (${describeError(error)})`,
    };
  }

  if (view?.state !== "OPEN") {
    return {
      ok: false,
      open: false,
      reason: `#${pr} is ${String(view?.state ?? "unreadable").toLowerCase()}, so there is nothing to lease`,
    };
  }

  if (typeof view.headRefOid !== "string" || view.headRefOid === "") {
    return {
      ok: false,
      open: true,
      reason: `#${pr} reported no head SHA`,
    };
  }

  return { ok: true, state: view.state, head: view.headRefOid };
};

/**
 * Writes the lease commit and points the ref at it.
 *
 * `create` is the atomic path: `POST /git/refs` refuses a second creation of
 * the same ref, so exactly one caller wins. `takeover` force-updates a ref whose
 * lease this caller has already established is stale, and is deliberately
 * last-writer-wins — two orchestrators taking over the same stale lease at the
 * same instant is the bounded, self-correcting worst case this design accepts,
 * and refusing it would leave a stale lease blocking its target until a janitor
 * pass came round.
 *
 * @param {{
 *   gh: (...args: string[]) => string,
 *   repository: string,
 *   refName: string,
 *   role: string,
 *   pr: string | null,
 *   agentId: string,
 *   head: string,
 *   mode: "create" | "takeover",
 * }} input
 * @returns {{ ok: true, sha: string } | { ok: false, reason: string }}
 */
export const writeLease = ({
  gh,
  repository,
  refName,
  role,
  pr,
  agentId,
  head,
  mode,
}) => {
  let tree;

  try {
    tree = JSON.parse(gh("api", `repos/${repository}/git/commits/${head}`))?.tree
      ?.sha;
  } catch (error) {
    return {
      ok: false,
      reason: `the dispatched head \`${head}\` could not be read (${describeError(error)})`,
    };
  }

  if (typeof tree !== "string" || tree === "") {
    return {
      ok: false,
      reason: `the dispatched head \`${head}\` reported no tree`,
    };
  }

  let sha;

  try {
    sha = JSON.parse(
      gh(
        "api",
        "--method",
        "POST",
        `repos/${repository}/git/commits`,
        "-f",
        `message=${leaseMessage({ role, pr, agentId, head })}`,
        "-f",
        `tree=${tree}`,
        "-f",
        `parents[]=${head}`,
      ),
    )?.sha;
  } catch (error) {
    return {
      ok: false,
      reason: `the lease commit could not be written (${describeError(error)})`,
    };
  }

  if (typeof sha !== "string" || sha === "") {
    return { ok: false, reason: "the lease commit was written without a SHA" };
  }

  try {
    if (mode === "create") {
      gh(
        "api",
        "--method",
        "POST",
        `repos/${repository}/git/refs`,
        "-f",
        `ref=refs/heads/${refName}`,
        "-f",
        `sha=${sha}`,
      );
    } else {
      gh(
        "api",
        "--method",
        "PATCH",
        `repos/${repository}/git/refs/heads/${refName}`,
        "-f",
        `sha=${sha}`,
        "-F",
        "force=true",
      );
    }
  } catch (error) {
    return {
      ok: false,
      reason: `\`refs/heads/${refName}\` could not be ${mode === "create" ? "created" : "updated"} (${describeError(error)})`,
    };
  }

  return { ok: true, sha };
};

const USAGE = [
  "Usage:",
  "  lease.mjs --role <reviewer|fixer|merger> --pr <N> --agent-id <id> [--dry-run]",
  "  lease.mjs --role <janitor|planner> --agent-id <id> [--dry-run]",
  "  lease.mjs --release --role <role> [--pr <N>] --agent-id <id> [--dry-run]",
  "  lease.mjs --sweep [--dry-run]",
].join("\n");

/** @param {string[]} argv */
export const parseArgs = (argv) => {
  /** @param {string} flag */
  const values = (flag) =>
    argv.flatMap((value, index) =>
      value === flag && argv[index + 1] ? [argv[index + 1]] : [],
    );

  return {
    role: values("--role").at(0),
    pr: values("--pr").at(0),
    agentId: values("--agent-id").at(0),
    release: argv.includes("--release"),
    sweep: argv.includes("--sweep"),
    dryRun: argv.includes("--dry-run"),
  };
};

/**
 * @param {{
 *   role?: string,
 *   pr?: string,
 *   agentId?: string,
 *   release: boolean,
 *   sweep: boolean,
 * }} args
 * @returns {string | null} The usage problem, or `null` when the arguments are usable.
 */
export const usageProblem = (args) => {
  if (args.sweep) {
    return args.role || args.pr || args.agentId || args.release
      ? "--sweep takes no other argument than --dry-run."
      : null;
  }

  if (!args.role || !ROLES.includes(args.role)) {
    return `--role must be one of ${ROLES.join(", ")}.`;
  }

  if (!args.agentId) return "Missing required --agent-id <unique-session-id>.";

  // The id lands in a lease commit the loop reads back, so hold it to the same
  // shape `claim.mjs` and `review.mjs` require.
  if (!SAFE_AGENT_ID.test(args.agentId)) {
    return `Agent id "${args.agentId}" must match ${SAFE_AGENT_ID}: letters, digits, dot, underscore, and hyphen only.`;
  }

  if (PULL_REQUEST_ROLES.includes(args.role)) {
    if (!args.pr || !/^\d+$/.test(args.pr)) {
      return `--pr <N> is required for the ${args.role} role.`;
    }
  } else if (args.pr) {
    return `--pr is not accepted for the ${args.role} role: its pass is over everything, so its lease is role-level.`;
  }

  return null;
};

/**
 * @param {{
 *   argv: string[],
 *   config: {
 *     sessionRefPrefix: string,
 *     staleClaimHours: number,
 *     integrationBranch?: string,
 *   },
 *   gh: (...args: string[]) => string,
 *   stdout?: (line: string) => void,
 *   stderr?: (line: string) => void,
 *   now?: () => number,
 * }} input
 * @returns {number} Process exit code.
 */
export const lease = ({
  argv,
  config,
  gh,
  stdout = console.log,
  stderr = console.error,
  now = () => Date.now(),
}) => {
  const args = parseArgs(argv);
  const problem = usageProblem(args);

  if (problem) {
    stderr(problem);
    stderr(USAGE);
    return EXIT.usage;
  }

  const repository = JSON.parse(gh("repo", "view", "--json", "nameWithOwner"))
    .nameWithOwner;

  if (args.sweep) {
    return sweep({
      repository,
      config,
      gh,
      dryRun: args.dryRun,
      stdout,
      stderr,
      now: now(),
    });
  }

  const role = /** @type {string} */ (args.role);
  const agentId = /** @type {string} */ (args.agentId);
  const pr = args.pr ?? null;
  const refName = leaseRefName({ prefix: config.sessionRefPrefix, role, pr });
  const refPath = `refs/heads/${refName}`;

  // Presence is established by listing, always, before anything is written or
  // deleted — never inferred from a create's or a delete's own failure. A
  // branch-scoped credential answers 403 whether or not the ref is there, and
  // reading one as proof either way is how stale warnings get written.
  const leases = readLeases(gh, repository, config.sessionRefPrefix);

  if (!leases.ok) {
    stderr(
      `The lease namespace could not be listed (${leases.reason}), so whether \`${refPath}\` is held could not be established. Nothing was written.`,
    );
    return EXIT.inconclusive;
  }

  const existing = leases.items.find((item) => item.refName === refName) ?? null;

  if (args.release) {
    return releaseLease({
      repository,
      refPath,
      existing,
      agentId,
      gh,
      dryRun: args.dryRun,
      stdout,
      stderr,
    });
  }

  const head = pr === null ? null : pullRequestHead(gh, pr);

  if (head && !head.ok) {
    stderr(`Refusing to lease ${refPath}: ${head.reason}.`);
    return head.open ? EXIT.inconclusive : EXIT.noTarget;
  }

  if (existing) {
    const state = leaseState({
      lease: existing,
      head: head
        ? { known: true, sha: head.head }
        : { known: true, sha: null },
      now: now(),
      staleClaimHours: config.staleClaimHours,
    });

    if (state.kind === "unknown") {
      stderr(
        `Refusing to lease ${refPath}: a lease ref exists there but could not be read (${state.reason}). A lookup that could not be established is not a free target, so nothing was written.`,
      );
      return EXIT.inconclusive;
    }

    if (state.kind === "live") {
      stderr(
        `\`${refPath}\` is already held: ${state.detail}. Somebody else is on this target; there is nothing to dispatch.`,
      );
      return EXIT.held;
    }

    stdout(
      `\`${refPath}\` exists but is stale (${state.detail}); taking it over.`,
    );
  }

  const dispatchedHead = /** @type {string} */ (
    head ? head.head : integrationHead(gh, repository, config)
  );

  if (!dispatchedHead) {
    stderr(
      `Refusing to lease ${refPath}: the head to bind this lease to could not be established. Nothing was written.`,
    );
    return EXIT.inconclusive;
  }

  if (args.dryRun) {
    stdout(
      `Would ${existing ? "take over" : "create"} ${refPath}, bound to \`${dispatchedHead.slice(0, 7)}\` for \`${agentId}\`.`,
    );
    stdout("\n(dry run: no lease commit and no ref were written)");
    return EXIT.ok;
  }

  const written = writeLease({
    gh,
    repository,
    refName,
    role,
    pr,
    agentId,
    head: dispatchedHead,
    mode: existing ? "takeover" : "create",
  });

  if (!written.ok) {
    // A failed create is the one case worth re-establishing rather than
    // reporting: the likeliest cause is another orchestrator winning the same
    // race between the listing above and this call. Which of the two happened
    // is established by listing again, never by reading the failure itself.
    if (!existing) {
      const after = readLeases(gh, repository, config.sessionRefPrefix);
      const now2 = after.ok
        ? (after.items.find((item) => item.refName === refName) ?? null)
        : null;

      if (now2) {
        stderr(
          `\`${refPath}\` is already held: another session created it while this one was writing. There is nothing to dispatch.`,
        );
        return EXIT.held;
      }
    }

    stderr(`Refusing to lease ${refPath}: ${written.reason}.`);
    return EXIT.writeFailed;
  }

  stdout(`LEASE_REF=${refPath}`);
  stdout(`LEASE_SHA=${written.sha}`);
  stdout(`LEASE_HEAD=${dispatchedHead}`);
  stdout(`LEASE_AGENT=${agentId}`);
  return EXIT.ok;
};

/**
 * The integration branch head, which a role-level lease binds to. There is no
 * per-target revision for a janitor or planner pass — it is over everything —
 * so the TTL is what bounds it, and the head only records what the board looked
 * like when the session was dispatched.
 *
 * @param {(...args: string[]) => string} gh
 * @param {string} repository
 * @param {{ integrationBranch?: string }} config
 * @returns {string | null}
 */
export const integrationHead = (gh, repository, config) => {
  try {
    const branch =
      config.integrationBranch ||
      JSON.parse(gh("repo", "view", "--json", "defaultBranchRef"))
        .defaultBranchRef.name;
    const sha = JSON.parse(
      gh("api", `repos/${repository}/git/ref/heads/${branch}`),
    )?.object?.sha;

    return typeof sha === "string" && sha !== "" ? sha : null;
  } catch {
    return null;
  }
};

/**
 * @param {{
 *   repository: string,
 *   refPath: string,
 *   existing: ResolvedLease | null,
 *   agentId: string,
 *   gh: (...args: string[]) => string,
 *   dryRun: boolean,
 *   stdout: (line: string) => void,
 *   stderr: (line: string) => void,
 * }} input
 * @returns {number} Process exit code.
 */
export const releaseLease = ({
  repository,
  refPath,
  existing,
  agentId,
  gh,
  dryRun,
  stdout,
  stderr,
}) => {
  if (!existing) {
    stdout(`No lease at ${refPath}; already clear.`);
    return EXIT.ok;
  }

  // Releasing somebody else's lease re-opens their target to a second dispatch
  // while their session is still running, which is the collision the lease
  // exists to prevent. Ids are self-declared, so this is bookkeeping
  // rather than authentication — but the honest mistake is the one worth
  // catching, and a genuinely abandoned lease is the janitor sweep's job.
  if (existing.readable && existing.agent !== agentId) {
    stderr(
      `Refusing to release ${refPath}: it is held by \`${existing.agent}\`, not \`${agentId}\`. An abandoned lease is released by its TTL through \`lease.mjs --sweep\`, not by another session deleting it.`,
    );
    return EXIT.held;
  }

  if (dryRun) {
    stdout(`Would delete ${refPath}.`);
    stdout("\n(dry run: nothing was deleted)");
    return EXIT.ok;
  }

  try {
    gh("api", "--method", "DELETE", `repos/${repository}/git/${refPath}`);
  } catch (error) {
    stderr(`\`${refPath}\` could not be deleted (${describeError(error)}).`);
    return EXIT.writeFailed;
  }

  stdout(`RELEASED_LEASE=${refPath}`);
  return EXIT.ok;
};

/**
 * The janitor's pass over the lease namespace: a lease whose target no longer
 * exists, or whose TTL has expired, is removed. Nothing else is touched — a
 * lease that is merely stale by head is left alone, because the next acquire
 * takes it over in place and deleting it first would only widen the window this
 * whole mechanism exists to close.
 *
 * A lease this pass could not read is reported and never deleted. It is the same
 * rule as everywhere else here: unreadable is not absent, and it is certainly
 * not abandoned.
 *
 * @param {{
 *   repository: string,
 *   config: { sessionRefPrefix: string, staleClaimHours: number },
 *   gh: (...args: string[]) => string,
 *   dryRun: boolean,
 *   stdout: (line: string) => void,
 *   stderr: (line: string) => void,
 *   now: number,
 * }} input
 * @returns {number} Process exit code.
 */
export const sweep = ({
  repository,
  config,
  gh,
  dryRun,
  stdout,
  stderr,
  now,
}) => {
  const summary = summarizeLeases({
    leases: readLeases(gh, repository, config.sessionRefPrefix),
    prs: openPullRequests(gh),
    now,
    staleClaimHours: config.staleClaimHours,
  });

  if (!summary.known) {
    stderr(
      `The lease namespace could not be listed (${summary.reason}). Nothing was swept.`,
    );
    return EXIT.inconclusive;
  }

  if (summary.items.length === 0) {
    stdout("No session leases exist; nothing to sweep.");
    return EXIT.ok;
  }

  let unreadable = 0;
  let failed = 0;
  let swept = 0;

  for (const item of summary.items) {
    if (item.state.kind === "unknown") {
      unreadable += 1;
      stderr(
        `Leaving ${item.refPath} alone: ${item.state.reason}. An unreadable lease is not an abandoned one.`,
      );
      continue;
    }

    if (item.state.kind === "live" || item.state.kind === "staleByHead") {
      stdout(
        `${item.refPath}: ${item.state.kind === "live" ? "live" : "stale by head, taken over in place by the next acquire"} — ${item.state.detail}.`,
      );
      continue;
    }

    if (dryRun) {
      stdout(`Would delete ${item.refPath} (${item.state.detail}).`);
      swept += 1;
      continue;
    }

    try {
      gh("api", "--method", "DELETE", `repos/${repository}/git/${item.refPath}`);
    } catch (error) {
      failed += 1;
      stderr(
        `\`${item.refPath}\` could not be deleted (${describeError(error)}).`,
      );
      continue;
    }

    swept += 1;
    stdout(`SWEPT_LEASE=${item.refPath} (${item.state.detail})`);
  }

  stdout(
    `Swept ${swept} lease(s)${dryRun ? " (dry run: nothing was deleted)" : ""}; ${unreadable} unreadable, ${failed} delete(s) failed.`,
  );

  if (failed > 0) return EXIT.writeFailed;
  if (unreadable > 0) return EXIT.inconclusive;
  return EXIT.ok;
};

export default lease;
