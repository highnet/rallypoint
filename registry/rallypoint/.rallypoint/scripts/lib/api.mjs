// A `gh`-shaped transport that speaks the GitHub REST API directly.
//
// Every Rallypoint script, and the Swarm runtime, reaches GitHub through one
// seam — `gh(...args) => string` — and the reference implementation of it
// shells out to the `gh` binary. That fails in two places: cloud agent sessions
// with no `gh` at all (`spawnSync gh ENOENT`), and Claude Code cloud sessions
// where `gh` is installed but GitHub GraphQL is blocked, so every `gh pr …` and
// `gh issue …` exits with `HTTP 403: GitHub GraphQL is not available from
// Claude Code sessions`. This is a second implementation of the same seam: same
// synchronous signature, same stringly JSON output, same throw-on-failure
// contract, so no script logic changes. It never calls GraphQL.
//
// Three parts of the contract matter more than they look:
//
//  1. **It must throw on a failed request.** `claim.mjs` takes its atomic
//     reservation by POSTing a ref and treating a throw as "another session got
//     there first". A transport that returned an error object instead would hand
//     two sessions the same issue.
//  2. **Output must match `gh --json` exactly**, not the REST shapes underneath:
//     the same field names (`createdAt`, not `created_at`; `author.login`, not
//     `user.login`) and the same spellings (`OPEN`/`CLOSED`/`MERGED`, where
//     REST says `open`/`closed` and a separate `merged_at`). `cleanup.mjs`
//     compares against `CLOSED` — get this wrong and a reservation is never
//     released. Each translation below is there because a caller depends on it.
//  3. **An unrecognised command, flag or field throws by name.** Guessing at
//     something this module has not been taught is how a coordination script
//     silently does something other than what it says. That includes the
//     fields `gh` can only answer through GraphQL (`closingIssuesReferences`,
//     `closedByPullRequestsReferences`): those throw `UnsupportedCommand`, and
//     every caller already treats a throw as "unknown".
//
// The surface is exactly what `.rallypoint/scripts/*`, `swarm.mjs` and the
// role prompts (through `.rallypoint/scripts/gh.mjs`) call:
//
//   repo view      --json [--jq]
//   issue list     --state --label… --assignee --limit --json [--jq]
//   issue view     <n> --json [--jq]
//   issue create   --title --body --label… --assignee…
//   issue edit     <n> --add-assignee… --remove-assignee… --add-label… --remove-label…
//   issue comment  <n> --body
//   issue close    <n> [--reason completed|"not planned"] [--comment]
//   pr list        --state --head --base --label… --limit --json [--jq]
//   pr view        <n|branch|url> --json [--jq]
//   pr edit        <n> --add-label… --remove-label… --add-assignee… --remove-assignee…
//   pr review      <n> --comment|--approve|--request-changes [--body]
//   pr merge       <n> --merge|--squash|--rebase [--subject] [--body] [--match-head-commit]
//                  [--auto | --disable-auto]   (only where an auto-merge REST route exists)
//   label list     --json [--limit] [--jq]
//   label create   <name> [--color] [--description] [--force]
//   api            [--method|-X M] [--paginate] [--slurp] <path> [-f|-F k=v]… [--jq]

/** An API call the transport wants performed. */
/**
 * @typedef {{
 *   method: string,
 *   path: string,
 *   body?: unknown,
 * }} ApiRequest
 */

/**
 * @typedef {{
 *   status: number,
 *   body: unknown,
 *   nextPath?: string | null,
 * }} ApiResponse
 */

/**
 * A request this module was not taught. Thrown rather than approximated: the
 * scripts read stdout as JSON, so a plausible-looking guess would be acted on.
 */
export class UnsupportedCommand extends Error {
  /**
   * @param {string[]} args
   * @param {string} [why] what specifically was not understood
   */
  constructor(args, why) {
    super(
      `The API transport does not implement \`gh ${args.join(" ")}\`` +
        (why ? ` (${why})` : "") +
        ". Add it to .rallypoint/scripts/lib/api.mjs rather than working " +
        "around it — a coordination command that half-runs is worse than one " +
        "that fails.",
    );
    this.name = "UnsupportedCommand";
  }
}

/** A request that GitHub refused. Mirrors a non-zero `gh` exit. */
export class ApiError extends Error {
  /**
   * @param {ApiRequest} request
   * @param {ApiResponse} response
   */
  constructor(request, response) {
    const detail =
      typeof response.body === "object" && response.body !== null
        ? /** @type {{ message?: string }} */ (response.body).message
        : undefined;

    super(
      `${request.method} ${request.path} failed with ${response.status}` +
        (detail ? `: ${detail}` : "") +
        // The failure a cloud agent session actually hits, and the one whose
        // remedy is not in this repository. Saying so here saves the next
        // session rediscovering it.
        (detail?.includes("not enabled for this session")
          ? "\n\nThis session's credential is not authorized for the repository " +
            "API, so no Rallypoint command can reach GitHub from here. The " +
            "remedy is an org admin connecting the GitHub App for the " +
            "organization."
          : ""),
    );
    this.name = "ApiError";
    this.status = response.status;
  }
}

// ---------------------------------------------------------------------------
// argument parsing
// ---------------------------------------------------------------------------

/**
 * Parses `rest` (the arguments after `<group> <command>`) against what a
 * command accepts. Any flag not listed throws: silently ignoring `--title` on
 * `pr edit` would report success for an edit that never happened.
 *
 * Repeated flags are kept in order, because `--label a --label b` means both.
 * `--flag=value` is accepted, as `gh` accepts it.
 *
 * @param {string[]} all the full argv, for the error message
 * @param {string[]} rest
 * @param {{ values?: string[], booleans?: string[], positionals?: number }} spec
 */
const parse = (all, rest, { values = [], booleans = [], positionals = 0 }) => {
  /** @type {Map<string, string[]>} */
  const seen = new Map();
  /** @type {Set<string>} */
  const switches = new Set();
  /** @type {string[]} */
  const bare = [];

  for (let index = 0; index < rest.length; index += 1) {
    const entry = rest[index];

    if (entry.startsWith("-") && entry !== "-") {
      const eq = entry.indexOf("=");
      const name = eq === -1 ? entry : entry.slice(0, eq);

      if (values.includes(name)) {
        const given = eq === -1 ? rest[(index += 1)] : entry.slice(eq + 1);
        if (given === undefined) throw new UnsupportedCommand(all, `${name} needs a value`);
        seen.set(name, [...(seen.get(name) ?? []), given]);
        continue;
      }

      if (booleans.includes(name) && eq === -1) {
        switches.add(name);
        continue;
      }

      throw new UnsupportedCommand(all, `unknown flag ${name}`);
    }

    bare.push(entry);
  }

  if (bare.length > positionals) {
    throw new UnsupportedCommand(all, `unexpected argument ${bare[positionals]}`);
  }

  return {
    /** @param {string} name */
    all: (name) => seen.get(name) ?? [],
    /** @param {string} name */
    one: (name) => seen.get(name)?.at(-1),
    /** @param {string} name */
    has: (name) => switches.has(name),
    bare,
  };
};

/**
 * `gh` accepts comma-separated lists for `--label` and `--assignee` style
 * flags as well as repetition.
 *
 * @param {string[]} entries
 */
const splitList = (entries) =>
  entries
    .flatMap((entry) => entry.split(","))
    .map((entry) => entry.trim())
    .filter(Boolean);

// ---------------------------------------------------------------------------
// --jq
// ---------------------------------------------------------------------------

const JQ_PATH = /^\.(?:[A-Za-z_][A-Za-z0-9_]*(?:\[\d*\])*(?:\.[A-Za-z_][A-Za-z0-9_]*(?:\[\d*\])*)*|(?:\[\d*\])+(?:\.[A-Za-z_][A-Za-z0-9_]*(?:\[\d*\])*)*)?$/;

/**
 * The subset of jq any caller uses: a path of `.field`, `[n]` and `[]` steps
 * (`.login`, `.mergeCommit.oid`, `.[].name`). Anything else throws by name
 * rather than being evaluated wrongly.
 *
 * Output follows `gh --jq`: one line per result, strings raw (no quotes),
 * `null` as an empty line, anything else as compact JSON.
 *
 * @param {unknown} input
 * @param {string} filter
 * @param {string[]} args
 */
export const applyJq = (input, filter, args) => {
  const expression = filter.trim();
  if (!JQ_PATH.test(expression)) {
    throw new UnsupportedCommand(args, `--jq ${filter} is beyond the supported path subset`);
  }

  const steps = [...expression.matchAll(/([A-Za-z_][A-Za-z0-9_]*)|\[(\d*)\]/g)].map(
    (match) => (match[1] !== undefined ? { key: match[1] } : { index: match[2] }),
  );

  /** @type {unknown[]} */
  let results = [input];

  for (const step of steps) {
    results = results.flatMap((value) => {
      if ("key" in step) {
        if (value === null || value === undefined) return [null];
        if (typeof value !== "object" || Array.isArray(value)) {
          throw new Error(
            `jq: cannot index ${Array.isArray(value) ? "array" : typeof value} with "${step.key}"`,
          );
        }
        return [/** @type {Record<string, unknown>} */ (value)[step.key] ?? null];
      }

      if (step.index === "") {
        if (Array.isArray(value)) return value;
        if (value && typeof value === "object") return Object.values(value);
        throw new Error(`jq: cannot iterate over ${value === null ? "null" : typeof value}`);
      }

      if (value === null || value === undefined) return [null];
      if (!Array.isArray(value)) throw new Error(`jq: cannot index ${typeof value} with number`);
      return [value[Number(step.index)] ?? null];
    });
  }

  return results
    .map((value) =>
      value === null || value === undefined
        ? ""
        : typeof value === "string"
          ? value
          : JSON.stringify(value),
    )
    .join("\n");
};

// ---------------------------------------------------------------------------
// `gh api` arguments
// ---------------------------------------------------------------------------

/**
 * `gh api` argv. `-f`/`-F` pairs keep their relative order, which `key[]`
 * arrays depend on.
 *
 * @param {string[]} args
 */
const parseApi = (args) => {
  /** @type {{ pair: string, typed: boolean }[]} */
  const pairs = [];
  /** @type {string[]} */
  const bare = [];
  /** @type {string | undefined} */
  let method;
  /** @type {string | undefined} */
  let jq;
  let paginate = false;
  let slurp = false;

  const rest = args.slice(1);
  for (let index = 0; index < rest.length; index += 1) {
    const entry = rest[index];
    const next = () => {
      const given = rest[(index += 1)];
      if (given === undefined) throw new UnsupportedCommand(args, `${entry} needs a value`);
      return given;
    };

    if (entry === "--method" || entry === "-X") method = next().toUpperCase();
    else if (entry === "-f" || entry === "--raw-field") pairs.push({ pair: next(), typed: false });
    else if (entry === "-F" || entry === "--field") pairs.push({ pair: next(), typed: true });
    else if (entry === "--jq" || entry === "-q") jq = next();
    else if (entry === "--paginate") paginate = true;
    else if (entry === "--slurp") slurp = true;
    else if (entry.startsWith("-")) throw new UnsupportedCommand(args, `unknown flag ${entry}`);
    else bare.push(entry);
  }

  if (bare.length !== 1) throw new UnsupportedCommand(args, "expected exactly one endpoint");

  return { method, jq, paginate, slurp, pairs, endpoint: bare[0] };
};

/**
 * The request body `gh api` builds from `-f key=value` (raw string) and
 * `-F key=value` (typed) pairs. Typed values follow `gh`: `true`/`false`/
 * `null`, integers, and `@file` (the file's contents); anything else stays a
 * string. `key[]=v` appends to an array, which is how `lease.mjs` passes commit
 * parents.
 *
 * @param {{ pair: string, typed: boolean }[]} pairs
 * @param {string[]} args
 * @param {(path: string) => string} readFile
 */
const fieldsFrom = (pairs, args, readFile) => {
  /** @type {Record<string, unknown>} */
  const body = {};

  for (const { pair, typed } of pairs) {
    const at = pair.indexOf("=");
    if (at === -1) throw new UnsupportedCommand(args, `field ${pair} has no value`);

    const rawKey = pair.slice(0, at);
    const text = pair.slice(at + 1);

    /** @type {unknown} */
    let parsed = text;
    if (typed) {
      if (text === "true") parsed = true;
      else if (text === "false") parsed = false;
      else if (text === "null") parsed = null;
      else if (/^-?\d+$/.test(text)) parsed = Number(text);
      else if (text.startsWith("@")) parsed = readFile(text.slice(1));
    }

    if (rawKey.endsWith("[]")) {
      const key = rawKey.slice(0, -2);
      if (key.includes("[")) throw new UnsupportedCommand(args, `nested field ${rawKey}`);
      const existing = body[key];
      body[key] = Array.isArray(existing) ? [...existing, parsed] : [parsed];
      continue;
    }

    if (rawKey.includes("[")) throw new UnsupportedCommand(args, `nested field ${rawKey}`);
    body[rawKey] = parsed;
  }

  return body;
};

// ---------------------------------------------------------------------------
// gh-shaped records
// ---------------------------------------------------------------------------

/** @param {unknown} value */
const upper = (value) =>
  value === null || value === undefined ? "" : String(value).toUpperCase();

/**
 * `gh`'s view of a label. REST's numeric `id` is not what `gh` reports; the
 * node id is.
 *
 * @param {any} label
 */
const labelFields = (label) => ({
  id: label.node_id ?? "",
  name: label.name,
  description: label.description ?? "",
  color: label.color ?? "",
});

/** @param {any} user */
const assigneeFields = (user) => ({
  id: user.node_id ?? "",
  login: user.login,
  name: user.name ?? "",
});

/**
 * `gh --json author`: `{ id, is_bot, login, name }`. The login keeps REST's
 * spelling (`dependabot[bot]`); `isDependabotAuthor` accepts both that and
 * `gh`'s `app/dependabot`, so both transports agree on bot authorship.
 *
 * @param {any} user
 */
const authorFields = (user) =>
  user
    ? {
        id: user.node_id ?? "",
        is_bot: user.type === "Bot",
        login: user.login,
        name: user.name ?? "",
      }
    : null;

/**
 * `gh --json comments`: each comment as `{ id, author: { login }, body,
 * createdAt, … }`. Readers use `body`, `createdAt` and `author.login`; REST
 * spells those `body`, `created_at` and `user.login`.
 *
 * @param {any} comment
 */
const commentFields = (comment) => ({
  id: comment.node_id ?? "",
  author: { login: comment.user?.login ?? "" },
  authorAssociation: upper(comment.author_association),
  body: comment.body ?? "",
  createdAt: comment.created_at,
  includesCreatedEdit: Boolean(
    comment.updated_at && comment.updated_at !== comment.created_at,
  ),
  url: comment.html_url ?? "",
});

/**
 * Picks a `--json` selection. Values may be thunks: a field that costs another
 * request (comments, merge state, checks) is only fetched when asked for. A
 * field that is not available throws by name.
 *
 * @param {Record<string, unknown>} available
 * @param {string | undefined} requested
 * @param {string[]} args
 */
const pick = (available, requested, args) => {
  if (!requested) throw new UnsupportedCommand(args, "--json is required");

  /** @type {Record<string, unknown>} */
  const result = {};

  for (const field of requested.split(",").map((entry) => entry.trim()).filter(Boolean)) {
    if (!(field in available)) {
      throw new UnsupportedCommand(args, `--json field ${field}`);
    }
    const entry = available[field];
    result[field] = typeof entry === "function" ? entry() : entry;
  }

  return result;
};

/**
 * Prints a result the way `gh` does: `--jq` applied when given, otherwise JSON.
 *
 * @param {unknown} data
 * @param {string | undefined} jq
 * @param {string[]} args
 */
const render = (data, jq, args) =>
  jq === undefined ? JSON.stringify(data) : applyJq(data, jq, args);

const NUMBER = /^#?(\d+)$/;
const PULL_URL = /\/pull\/(\d+)(?:[/?#]|$)/;

// ---------------------------------------------------------------------------
// the transport
// ---------------------------------------------------------------------------

/**
 * The transport. `request` performs one call and reports the status, the parsed
 * body, and the `Link: rel="next"` path when there is one; everything about how
 * that happens — sockets, proxies, credentials — stays outside this module so it
 * can be tested without any of them.
 *
 * @param {{
 *   request: (call: ApiRequest) => ApiResponse,
 *   repository: string,
 *   readFile?: (path: string) => string,
 *   autoMergeRoute?: boolean,
 * }} input `autoMergeRoute` turns on `pr merge --auto`/`--disable-auto`
 *   through the Claude Code cloud proxy's `…/pulls/{n}/ccr/auto_merge` route.
 * @returns {(...args: string[]) => string}
 */
export const createTransport = ({ request, repository, readFile, autoMergeRoute = false }) => {
  const [owner, repoName] = repository.split("/");
  const base = `/repos/${repository}`;

  /**
   * @param {ApiRequest} call
   * @returns {any}
   */
  const send = (call) => {
    const response = request(call);

    // Mirrors `gh`: a failed request is a non-zero exit, which `execFileSync`
    // turns into a throw. Callers depend on that — see the reservation POST.
    if (response.status < 200 || response.status >= 300) {
      throw new ApiError(call, response);
    }

    return response.body;
  };

  /**
   * Follows `Link: rel="next"` and returns every page, which is what
   * `gh api --paginate` reads. With `limit`, stops once `count` says enough
   * items are in hand — the `--limit` of `gh … list`, which may exceed the
   * 100 a single REST page holds.
   *
   * @param {ApiRequest} call
   * @param {{ limit?: number, count?: (page: any) => number }} [options]
   * @returns {any[]}
   */
  const sendPaginated = (call, { limit, count } = {}) => {
    /** @type {unknown[]} */
    const pages = [];
    /** @type {string | null | undefined} */
    let path = call.path;
    let total = 0;

    while (path) {
      const response = request({ ...call, path });

      if (response.status < 200 || response.status >= 300) {
        throw new ApiError({ ...call, path }, response);
      }

      pages.push(response.body);
      total += count ? count(response.body) : 0;
      if (limit !== undefined && total >= limit) break;
      path = response.nextPath;
    }

    return pages;
  };

  /** @type {string | undefined} */
  let login;
  const authenticatedLogin = () => {
    login ??= /** @type {{ login: string }} */ (send({ method: "GET", path: "/user" })).login;
    return login;
  };

  /** @param {string[]} entries `@me` or logins */
  const resolveLogins = (entries) =>
    splitList(entries).map((entry) => (entry === "@me" ? authenticatedLogin() : entry));

  /**
   * `--limit` as `gh` reads it: a positive integer, defaulting to 30.
   *
   * @param {string | undefined} given
   * @param {string[]} args
   */
  const limitFrom = (given, args) => {
    const limit = Number(given ?? "30");
    if (!Number.isInteger(limit) || limit < 1) {
      throw new UnsupportedCommand(args, `--limit ${given}`);
    }
    return limit;
  };

  /**
   * Labels and assignees, for both `issue edit` and `pr edit`: on a pull
   * request they are issue labels and assignees.
   *
   * `gh` performs this as one mutation; REST needs up to four calls. A failure
   * partway through throws, which `claim.mjs` compensates for by restoring the
   * issue and releasing its reservation — the same handling it already has for
   * a failed `gh issue edit`.
   *
   * @param {string | number} number
   * @param {ReturnType<typeof parse>} flags
   */
  const editLabelsAndAssignees = (number, flags) => {
    const addAssignees = resolveLogins(flags.all("--add-assignee"));
    const removeAssignees = resolveLogins(flags.all("--remove-assignee"));
    const added = splitList(flags.all("--add-label"));
    const removed = splitList(flags.all("--remove-label"));

    if (addAssignees.length > 0) {
      send({
        method: "POST",
        path: `${base}/issues/${number}/assignees`,
        body: { assignees: addAssignees },
      });
    }

    if (removeAssignees.length > 0) {
      send({
        method: "DELETE",
        path: `${base}/issues/${number}/assignees`,
        body: { assignees: removeAssignees },
      });
    }

    if (added.length > 0) {
      send({ method: "POST", path: `${base}/issues/${number}/labels`, body: { labels: added } });
    }

    for (const label of removed) {
      // A label that is not present is not an error for `gh`, and callers
      // remove a label without first checking it is there.
      try {
        send({
          method: "DELETE",
          path: `${base}/issues/${number}/labels/${encodeURIComponent(label)}`,
        });
      } catch (error) {
        if (!(error instanceof ApiError) || error.status !== 404) throw error;
      }
    }
  };

  /** @param {any} issue */
  const issueRecord = (issue) => ({
    id: issue.node_id ?? "",
    number: issue.number,
    title: issue.title,
    body: issue.body ?? "",
    url: issue.html_url ?? "",
    // `gh` reports `OPEN`/`CLOSED` and `cleanup.mjs` compares against
    // `CLOSED`, so lower case here would stop every reservation from being
    // released.
    state: upper(issue.state),
    stateReason: upper(issue.state_reason),
    closed: issue.state === "closed",
    labels: (issue.labels ?? []).map(labelFields),
    assignees: (issue.assignees ?? []).map(assigneeFields),
    author: authorFields(issue.user),
    createdAt: issue.created_at,
    updatedAt: issue.updated_at,
    closedAt: issue.closed_at ?? null,
    comments: () =>
      sendPaginated({
        method: "GET",
        path: `${base}/issues/${issue.number}/comments?per_page=100`,
      })
        .flat()
        .map(commentFields),
  });

  /**
   * `gh`'s `statusCheckRollup` for a commit: check runs and commit statuses,
   * each tagged with its GraphQL `__typename`, states upper-cased. Read from
   * the checks and statuses REST endpoints — never GraphQL.
   *
   * @param {string} sha
   */
  const statusCheckRollup = (sha) => {
    const runs = sendPaginated({
      method: "GET",
      path: `${base}/commits/${sha}/check-runs?per_page=100`,
    }).flatMap((page) => page?.check_runs ?? []);

    // A check run does not name its workflow; its check suite's workflow run
    // does. Actions may be disabled, which is not a failure of this read.
    /** @type {Map<unknown, string>} */
    const workflowBySuite = new Map();
    if (runs.some((run) => run.app?.slug === "github-actions")) {
      try {
        for (const page of sendPaginated({
          method: "GET",
          path: `${base}/actions/runs?head_sha=${sha}&per_page=100`,
        })) {
          for (const run of page?.workflow_runs ?? []) {
            workflowBySuite.set(run.check_suite_id, run.name);
          }
        }
      } catch (error) {
        if (!(error instanceof ApiError) || error.status !== 404) throw error;
      }
    }

    const combined = send({ method: "GET", path: `${base}/commits/${sha}/status` });

    return [
      ...runs.map((run) => ({
        __typename: "CheckRun",
        completedAt: run.completed_at ?? "0001-01-01T00:00:00Z",
        conclusion: upper(run.conclusion),
        detailsUrl: run.details_url ?? "",
        name: run.name,
        startedAt: run.started_at ?? "0001-01-01T00:00:00Z",
        status: upper(run.status),
        workflowName: workflowBySuite.get(run.check_suite?.id) ?? "",
      })),
      ...(combined?.statuses ?? []).map((/** @type {any} */ status) => ({
        __typename: "StatusContext",
        context: status.context,
        startedAt: status.created_at,
        state: upper(status.state),
        targetUrl: status.target_url ?? "",
      })),
    ];
  };

  /** @param {any} pull a REST pull request, from the list or the single route */
  const pullRecord = (pull) => {
    /** @type {any} */
    let detail = "mergeable_state" in pull ? pull : undefined;
    // The list route leaves out merge state; the single route has it.
    const full = () =>
      (detail ??= send({ method: "GET", path: `${base}/pulls/${pull.number}` }));

    return {
      id: pull.node_id ?? "",
      number: pull.number,
      title: pull.title,
      body: pull.body ?? "",
      url: pull.html_url ?? "",
      // `gh` folds REST's `state` + `merged_at` into one of three words.
      state: pull.merged_at ? "MERGED" : upper(pull.state),
      closed: pull.state === "closed",
      isDraft: Boolean(pull.draft),
      labels: (pull.labels ?? []).map(labelFields),
      assignees: (pull.assignees ?? []).map(assigneeFields),
      author: authorFields(pull.user),
      headRefName: pull.head?.ref ?? "",
      headRefOid: pull.head?.sha ?? "",
      // Read by `isPromotionBranch`: a `promotion/*` head is a promotion only
      // when it targets the promotion branch.
      baseRefName: pull.base?.ref ?? "",
      createdAt: pull.created_at,
      updatedAt: pull.updated_at,
      closedAt: pull.closed_at ?? null,
      mergedAt: pull.merged_at ?? null,
      mergeCommit:
        pull.merged_at && pull.merge_commit_sha ? { oid: pull.merge_commit_sha } : null,
      // REST answers `true`/`false`/`null` (not computed yet).
      mergeable: () => {
        const { mergeable } = full();
        return mergeable === true ? "MERGEABLE" : mergeable === false ? "CONFLICTING" : "UNKNOWN";
      },
      // REST's `mergeable_state` uses `gh`'s words in lower case.
      mergeStateStatus: () => upper(full().mergeable_state ?? "unknown"),
      statusCheckRollup: () => statusCheckRollup(pull.head.sha),
    };
  };

  /**
   * The pull request `gh pr view <arg>` means: a number, a URL, or a head
   * branch. For a branch, the open pull request wins, then the newest.
   *
   * @param {string | undefined} selector
   * @param {string[]} args
   */
  const findPull = (selector, args) => {
    if (selector === undefined) {
      throw new UnsupportedCommand(args, "a pull request number, URL or branch is required");
    }

    const number = NUMBER.exec(selector)?.[1] ?? PULL_URL.exec(selector)?.[1];
    if (number) return send({ method: "GET", path: `${base}/pulls/${number}` });

    const head = selector.includes(":") ? selector : `${owner}:${selector}`;
    const candidates = /** @type {any[]} */ (
      send({
        method: "GET",
        path: `${base}/pulls?${new URLSearchParams({ head, state: "all", per_page: "100" })}`,
      })
    );
    const chosen = candidates.find((pull) => pull.state === "open") ?? candidates[0];

    if (!chosen) {
      // `gh` exits 1 with this message; callers treat the throw as "no PR".
      throw new Error(`no pull requests found for branch "${head.replace(/^[^:]*:/, "")}"`);
    }

    return chosen;
  };

  /**
   * @param {string | undefined} selector
   * @param {string[]} args
   */
  const pullNumber = (selector, args) =>
    (selector && (NUMBER.exec(selector)?.[1] ?? PULL_URL.exec(selector)?.[1])) ||
    String(findPull(selector, args).number);

  /** @param {ReturnType<typeof parse>} flags */
  const jqOf = (flags) => flags.one("--jq") ?? flags.one("-q");

  /** @type {Record<string, (args: string[], rest: string[]) => string>} */
  const commands = {
    "repo view": (args, rest) => {
      const flags = parse(args, rest, { values: ["--json", "--jq", "-q"] });
      const repo = send({ method: "GET", path: base });

      return render(
        pick(
          {
            id: repo.node_id ?? "",
            name: repo.name,
            nameWithOwner: repo.full_name,
            owner: { id: repo.owner?.node_id ?? "", login: repo.owner?.login ?? "" },
            defaultBranchRef: { name: repo.default_branch },
            description: repo.description ?? "",
            url: repo.html_url ?? "",
            isPrivate: Boolean(repo.private),
            visibility: upper(repo.visibility ?? (repo.private ? "private" : "public")),
          },
          flags.one("--json"),
          args,
        ),
        jqOf(flags),
        args,
      );
    },

    "issue list": (args, rest) => {
      const flags = parse(args, rest, {
        values: ["--state", "-s", "--label", "-l", "--assignee", "-a", "--limit", "-L", "--json", "--jq", "-q"],
      });
      const state = flags.one("--state") ?? flags.one("-s") ?? "open";
      if (!["open", "closed", "all"].includes(state)) {
        throw new UnsupportedCommand(args, `--state ${state}`);
      }
      const limit = limitFrom(flags.one("--limit") ?? flags.one("-L"), args);
      const labels = splitList([...flags.all("--label"), ...flags.all("-l")]);
      const assignee = flags.one("--assignee") ?? flags.one("-a");

      const query = new URLSearchParams({ state, per_page: String(Math.min(limit, 100)) });
      if (labels.length > 0) query.set("labels", labels.join(","));
      if (assignee !== undefined) {
        query.set("assignee", assignee === "@me" ? authenticatedLogin() : assignee);
      }

      // The REST issues list includes pull requests; `gh issue list` does not.
      // Without this, `claim.mjs` could reserve a pull request number. The
      // filter also means a page can hold fewer issues than it asked for, so
      // pages are followed until `--limit` real issues are in hand.
      const isIssue = (/** @type {any} */ issue) => !("pull_request" in issue);
      const issues = sendPaginated(
        { method: "GET", path: `${base}/issues?${query}` },
        { limit, count: (page) => (Array.isArray(page) ? page.filter(isIssue).length : 0) },
      )
        .flat()
        .filter(isIssue)
        .slice(0, limit);

      const requested = flags.one("--json");
      return render(
        issues.map((issue) => pick(issueRecord(issue), requested, args)),
        jqOf(flags),
        args,
      );
    },

    "issue view": (args, rest) => {
      const flags = parse(args, rest, { values: ["--json", "--jq", "-q"], positionals: 1 });
      if (flags.bare[0] === undefined) throw new UnsupportedCommand(args, "an issue number is required");
      const issue = send({ method: "GET", path: `${base}/issues/${flags.bare[0]}` });

      return render(pick(issueRecord(issue), flags.one("--json"), args), jqOf(flags), args);
    },

    "issue create": (args, rest) => {
      const flags = parse(args, rest, {
        values: ["--title", "-t", "--body", "-b", "--label", "-l", "--assignee", "-a"],
      });
      const title = flags.one("--title") ?? flags.one("-t");
      if (title === undefined) throw new UnsupportedCommand(args, "--title is required");

      const labels = splitList([...flags.all("--label"), ...flags.all("-l")]);
      const assignees = resolveLogins([...flags.all("--assignee"), ...flags.all("-a")]);
      const created = send({
        method: "POST",
        path: `${base}/issues`,
        body: {
          title,
          body: flags.one("--body") ?? flags.one("-b") ?? "",
          ...(labels.length > 0 ? { labels } : {}),
          ...(assignees.length > 0 ? { assignees } : {}),
        },
      });

      // `gh issue create` prints the new issue's URL, and `swarm plan` keeps it.
      return created.html_url;
    },

    "issue edit": (args, rest) => {
      const flags = parse(args, rest, {
        values: ["--add-assignee", "--remove-assignee", "--add-label", "--remove-label"],
        positionals: 1,
      });
      if (flags.bare[0] === undefined) throw new UnsupportedCommand(args, "an issue number is required");
      editLabelsAndAssignees(flags.bare[0], flags);
      return "";
    },

    "issue comment": (args, rest) => {
      const flags = parse(args, rest, { values: ["--body", "-b"], positionals: 1 });
      const body = flags.one("--body") ?? flags.one("-b");
      if (flags.bare[0] === undefined || body === undefined) {
        throw new UnsupportedCommand(args, "an issue number and --body are required");
      }

      const comment = send({
        method: "POST",
        path: `${base}/issues/${flags.bare[0]}/comments`,
        body: { body },
      });
      // `gh issue comment` prints the comment's URL.
      return comment?.html_url ?? "";
    },

    "issue close": (args, rest) => {
      const flags = parse(args, rest, {
        values: ["--reason", "-r", "--comment", "-c"],
        positionals: 1,
      });
      const issue = flags.bare[0];
      if (issue === undefined) throw new UnsupportedCommand(args, "an issue number is required");

      const reason = flags.one("--reason") ?? flags.one("-r");
      /** @type {Record<string, string>} */
      const reasons = { completed: "completed", "not planned": "not_planned" };
      if (reason !== undefined && !(reason in reasons)) {
        throw new UnsupportedCommand(args, `--reason ${reason}`);
      }

      // `gh` posts the comment first, then closes.
      const comment = flags.one("--comment") ?? flags.one("-c");
      if (comment !== undefined) {
        send({ method: "POST", path: `${base}/issues/${issue}/comments`, body: { body: comment } });
      }

      send({
        method: "PATCH",
        path: `${base}/issues/${issue}`,
        body: { state: "closed", ...(reason ? { state_reason: reasons[reason] } : {}) },
      });
      return "";
    },

    "pr list": (args, rest) => {
      const flags = parse(args, rest, {
        values: [
          "--state", "-s", "--head", "-H", "--base", "-B", "--label", "-l",
          "--limit", "-L", "--json", "--jq", "-q",
        ],
      });
      const state = flags.one("--state") ?? flags.one("-s") ?? "open";
      if (!["open", "closed", "merged", "all"].includes(state)) {
        throw new UnsupportedCommand(args, `--state ${state}`);
      }
      const limit = limitFrom(flags.one("--limit") ?? flags.one("-L"), args);
      const head = flags.one("--head") ?? flags.one("-H");
      const baseBranch = flags.one("--base") ?? flags.one("-B");
      const labels = splitList([...flags.all("--label"), ...flags.all("-l")]);

      const query = new URLSearchParams({
        state: state === "merged" ? "closed" : state,
        per_page: String(Math.min(limit, 100)),
      });
      // `gh pr list --head` names a branch; REST wants `owner:branch`.
      if (head !== undefined) query.set("head", head.includes(":") ? head : `${owner}:${head}`);
      if (baseBranch !== undefined) query.set("base", baseBranch);

      const keep = (/** @type {any} */ pull) =>
        (state !== "merged" || Boolean(pull.merged_at)) &&
        labels.every((label) =>
          (pull.labels ?? []).some((/** @type {any} */ entry) => entry.name === label),
        );

      const pulls = sendPaginated(
        { method: "GET", path: `${base}/pulls?${query}` },
        { limit, count: (page) => (Array.isArray(page) ? page.filter(keep).length : 0) },
      )
        .flat()
        .filter(keep)
        .slice(0, limit);

      const requested = flags.one("--json");
      return render(
        pulls.map((pull) => pick(pullRecord(pull), requested, args)),
        jqOf(flags),
        args,
      );
    },

    "pr view": (args, rest) => {
      const flags = parse(args, rest, { values: ["--json", "--jq", "-q"], positionals: 1 });
      const pull = findPull(flags.bare[0], args);

      return render(pick(pullRecord(pull), flags.one("--json"), args), jqOf(flags), args);
    },

    "pr edit": (args, rest) => {
      const flags = parse(args, rest, {
        values: ["--add-assignee", "--remove-assignee", "--add-label", "--remove-label"],
        positionals: 1,
      });
      editLabelsAndAssignees(pullNumber(flags.bare[0], args), flags);
      return "";
    },

    // POST /pulls/{n}/reviews with the event `gh` would send. GitHub refuses
    // APPROVE and REQUEST_CHANGES from a pull request's own author, and that
    // refusal is the thrown error.
    "pr review": (args, rest) => {
      const flags = parse(args, rest, {
        values: ["--body", "-b"],
        booleans: ["--comment", "-c", "--approve", "-a", "--request-changes", "-r"],
        positionals: 1,
      });
      const events = [
        (flags.has("--comment") || flags.has("-c")) && "COMMENT",
        (flags.has("--approve") || flags.has("-a")) && "APPROVE",
        (flags.has("--request-changes") || flags.has("-r")) && "REQUEST_CHANGES",
      ].filter(Boolean);
      if (events.length !== 1) {
        throw new UnsupportedCommand(args, "exactly one of --comment, --approve, --request-changes");
      }

      const body = flags.one("--body") ?? flags.one("-b");
      if (events[0] !== "APPROVE" && !body) {
        // `gh` refuses the same way, before any request.
        throw new Error(
          `body cannot be blank for ${events[0] === "COMMENT" ? "comment" : "request changes"} review`,
        );
      }

      send({
        method: "POST",
        path: `${base}/pulls/${pullNumber(flags.bare[0], args)}/reviews`,
        body: { event: events[0], ...(body ? { body } : {}) },
      });
      return "";
    },

    // PUT /pulls/{n}/merge. Public GitHub has no REST endpoint for auto-merge
    // — only a GraphQL mutation — so `--auto` and `--disable-auto` are served
    // only where the caller supplies a REST route for them: a Claude Code cloud
    // session's GitHub proxy exposes `PUT`/`DELETE
    // /repos/{owner}/{repo}/pulls/{n}/ccr/auto_merge`, and `gh.mjs` turns that
    // on there. Anywhere else they throw by name rather than merging
    // immediately, which is not what they ask for. `--delete-branch` couples a
    // local delete this transport cannot make with the remote one, and is
    // refused too; the protocol's own `.rallypoint/scripts/delete-merged-branch.mjs`
    // is the supported path.
    "pr merge": (args, rest) => {
      if (rest.includes("--delete-branch") || rest.includes("-d")) {
        throw new UnsupportedCommand(
          args,
          "--delete-branch: merge, then run .rallypoint/scripts/delete-merged-branch.mjs",
        );
      }

      const flags = parse(args, rest, {
        values: ["--subject", "-t", "--body", "-b", "--match-head-commit"],
        booleans: ["--merge", "-m", "--squash", "-s", "--rebase", "-r", "--auto", "--disable-auto"],
        positionals: 1,
      });
      const auto = flags.has("--auto");
      const disableAuto = flags.has("--disable-auto");

      if ((auto || disableAuto) && !autoMergeRoute) {
        throw new UnsupportedCommand(
          args,
          `${auto ? "--auto" : "--disable-auto"}: GitHub offers auto-merge only through GraphQL, ` +
            "which this transport never calls, and no REST auto-merge route is available here",
        );
      }

      if (disableAuto) {
        if (auto) throw new UnsupportedCommand(args, "--auto with --disable-auto");
        send({ method: "DELETE", path: `${base}/pulls/${pullNumber(flags.bare[0], args)}/ccr/auto_merge` });
        return "";
      }

      const methods = [
        (flags.has("--merge") || flags.has("-m")) && "merge",
        (flags.has("--squash") || flags.has("-s")) && "squash",
        (flags.has("--rebase") || flags.has("-r")) && "rebase",
      ].filter(Boolean);
      if (methods.length !== 1) {
        // `gh` says the same when it cannot prompt.
        throw new Error("--merge, --rebase, or --squash required when not running interactively");
      }

      const subject = flags.one("--subject") ?? flags.one("-t");
      const message = flags.one("--body") ?? flags.one("-b");
      const sha = flags.one("--match-head-commit");

      const number = pullNumber(flags.bare[0], args);

      if (auto) {
        send({
          method: "PUT",
          path: `${base}/pulls/${number}/ccr/auto_merge`,
          body: {
            merge_method: methods[0],
            ...(subject !== undefined ? { commit_title: subject } : {}),
            ...(message !== undefined ? { commit_message: message } : {}),
          },
        });
        return "";
      }

      send({
        method: "PUT",
        path: `${base}/pulls/${number}/merge`,
        body: {
          merge_method: methods[0],
          ...(subject !== undefined ? { commit_title: subject } : {}),
          ...(message !== undefined ? { commit_message: message } : {}),
          ...(sha !== undefined ? { sha } : {}),
        },
      });
      return "";
    },

    "label list": (args, rest) => {
      const flags = parse(args, rest, { values: ["--json", "--limit", "-L", "--jq", "-q"] });
      const limit = limitFrom(flags.one("--limit") ?? flags.one("-L"), args);
      const labels = sendPaginated(
        { method: "GET", path: `${base}/labels?per_page=${Math.min(limit, 100)}` },
        { limit, count: (page) => (Array.isArray(page) ? page.length : 0) },
      )
        .flat()
        .slice(0, limit);

      const requested = flags.one("--json");
      return render(
        labels.map((label) =>
          pick({ ...labelFields(label), isDefault: Boolean(label.default) }, requested, args),
        ),
        jqOf(flags),
        args,
      );
    },

    "label create": (args, rest) => {
      const flags = parse(args, rest, {
        values: ["--color", "-c", "--description", "-d"],
        booleans: ["--force", "-f"],
        positionals: 1,
      });
      const name = flags.bare[0];
      if (name === undefined) throw new UnsupportedCommand(args, "a label name is required");

      const color = (flags.one("--color") ?? flags.one("-c"))?.replace(/^#/, "");
      const description = flags.one("--description") ?? flags.one("-d");
      const body = {
        name,
        ...(color !== undefined ? { color } : {}),
        ...(description !== undefined ? { description } : {}),
      };

      try {
        send({ method: "POST", path: `${base}/labels`, body });
      } catch (error) {
        // `--force` updates a label that already exists, as `gh` does.
        const force = flags.has("--force") || flags.has("-f");
        if (!force || !(error instanceof ApiError) || error.status !== 422) throw error;
        send({ method: "PATCH", path: `${base}/labels/${encodeURIComponent(name)}`, body });
      }
      return "";
    },
  };

  /** @param {string[]} args */
  const api = (args) => {
    const parsed = parseApi(args);
    const endpoint = parsed.endpoint.replaceAll("{owner}", owner).replaceAll("{repo}", repoName);
    const fields = fieldsFrom(parsed.pairs, args, (path) => {
      if (!readFile) throw new UnsupportedCommand(args, "@file fields");
      return readFile(path);
    });
    const hasFields = Object.keys(fields).length > 0;
    // `gh api` switches to POST when fields are given without a method.
    const method = parsed.method ?? (hasFields ? "POST" : "GET");

    let path = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;

    // A `matching-refs` prefix ending in `/` (`heads/rallypoint-sessions/`)
    // is one a Claude Code session's proxy refuses ("Request path could not be
    // canonicalized", HTTP 400). Ask for the prefix without it, which matches a
    // superset, and keep only the refs the slashed prefix would have matched.
    /** @type {string | undefined} */
    let refPrefix;
    const slashed = /^(\/repos\/[^/]+\/[^/]+\/git\/matching-refs\/(.+?))\/((?:\?.*)?)$/.exec(path);
    if (slashed) {
      path = `${slashed[1]}${slashed[3]}`;
      refPrefix = `refs/${slashed[2]}/`;
    }
    /** @param {unknown} page */
    const onlyPrefixed = (page) =>
      refPrefix !== undefined && Array.isArray(page)
        ? page.filter((/** @type {any} */ ref) => String(ref?.ref ?? "").startsWith(/** @type {string} */ (refPrefix)))
        : page;
    /** @type {ApiRequest} */
    let call = { method, path };

    if (hasFields && method === "GET") {
      // For a GET, `gh` sends the fields as the query string.
      const query = new URLSearchParams();
      for (const [key, entry] of Object.entries(fields)) {
        for (const item of Array.isArray(entry) ? entry : [entry]) {
          query.append(Array.isArray(entry) ? `${key}[]` : key, String(item));
        }
      }
      path += (path.includes("?") ? "&" : "?") + query;
      call = { method, path };
    } else if (hasFields) {
      call = { method, path, body: fields };
    }

    if (parsed.paginate) {
      const pages = sendPaginated(call).map(onlyPrefixed);
      /** @type {unknown} */
      let data;
      // `--slurp` keeps the pages as an array of arrays; without it `gh`
      // concatenates array pages.
      if (parsed.slurp) data = pages;
      else if (pages.every(Array.isArray)) data = pages.flat();
      else if (pages.length === 1) data = pages[0];
      else throw new UnsupportedCommand(args, "--paginate over object pages without --slurp");
      return render(data, parsed.jq, args);
    }

    if (parsed.slurp) throw new UnsupportedCommand(args, "--slurp needs --paginate");

    const response = onlyPrefixed(send(call));

    // A 204 has no body. `gh` prints nothing, and the DELETE callers ignore
    // stdout entirely.
    if (response === undefined || response === null || response === "") return "";
    if (parsed.jq !== undefined) return applyJq(response, parsed.jq, args);
    return typeof response === "string" ? response : JSON.stringify(response);
  };

  return (...args) => {
    const [group, command] = args;

    if (group === "api") return api(args);

    const handler = commands[`${group} ${command}`];
    if (!handler) throw new UnsupportedCommand(args);

    return handler(args, args.slice(2));
  };
};

export default createTransport;
