// A `gh`-shaped transport that speaks the GitHub REST API directly.
//
// Every Rallypoint script reaches GitHub through one seam — `gh(...args) =>
// string` — and until now the only implementation of it shelled out to the `gh`
// binary. Cloud agent sessions have no `gh`, so those scripts failed outright
// with `spawnSync gh ENOENT`. This is a second implementation of the same
// seam: same synchronous signature, same stringly JSON output, same throw-on-
// failure contract, so no script logic changes.
//
// Three parts of the contract matter more than they look:
//
//  1. **It must throw on a failed request.** `claim.mjs` takes its atomic
//     reservation by POSTing a ref and treating a throw as "another session got
//     there first". A transport that returned an error object instead would hand
//     two sessions the same issue.
//  2. **Output must match `gh --json` exactly**, not the REST shapes underneath.
//     `gh` reports issue state as `CLOSED` where REST says `closed`, and
//     `cleanup.mjs` compares against the former — get this wrong and a
//     reservation is never released. Each translation below is there because a
//     caller depends on that spelling.
//  3. **An unrecognised command throws by name.** Guessing at a command this
//     module has not been taught is how a coordination script silently does
//     something other than what it says.
//
// The surface is what the loop scripts and the Swarm runtime actually call.
// `close-referenced-issues.mjs` runs in Actions where `gh` exists, but the
// commands it uses are covered too, since nothing about them is Actions-only.
//
// This transport serves two situations, and `lib/gh.mjs` chooses between them:
// a session with no `gh` binary at all, and a cloud session (Claude Code on the
// web, `CLAUDE_CODE_REMOTE=true`) where `gh` exists but GitHub's GraphQL API —
// which every high-level `gh pr|issue|repo|label` subcommand uses — answers
// 403. Only REST reaches GitHub there.

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
  /** @param {string[]} args */
  constructor(args) {
    super(
      `The API transport does not implement \`gh ${args.join(" ")}\`. Add it to ` +
        ".rallypoint/scripts/lib/api.mjs rather than working around it — a " +
        "coordination command that half-runs is worse than one that fails.",
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

/**
 * Flags of the form `--flag value`, in order. Repeated flags are kept, because
 * `issue list --label a --label b` means both.
 *
 * @param {string[]} args
 * @param {string} flag
 */
const values = (args, flag) =>
  args.flatMap((entry, index) =>
    entry === flag && args[index + 1] !== undefined ? [args[index + 1]] : [],
  );

/**
 * @param {string[]} args
 * @param {string} flag
 */
const value = (args, flag) => values(args, flag).at(0);

/**
 * `gh --json a,b,c` returns only the requested fields. Building the full record
 * and then picking keeps each translation in one place and makes an unmapped
 * field an explicit failure rather than a silent `undefined`.
 *
 * @param {Record<string, unknown>} available
 * @param {string | undefined} requested
 * @param {string[]} args
 */
const pick = (available, requested, args) => {
  if (!requested) throw new UnsupportedCommand(args);

  /** @type {Record<string, unknown>} */
  const result = {};

  for (const field of requested.split(",")) {
    if (!(field in available)) throw new UnsupportedCommand(args);
    result[field] = available[field];
  }

  return result;
};

/**
 * A `-F` value, typed the way `gh api` types it: `true`, `false`, `null` and
 * integers become JSON values, anything else stays a string.
 *
 * @param {string} raw
 * @returns {unknown}
 */
const typed = (raw) => {
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (raw === "null") return null;
  if (/^-?\d+$/.test(raw)) return Number(raw);
  return raw;
};

/**
 * `-f key=value` (string) and `-F key=value` (typed) pairs, as `gh api` takes
 * them, in argument order. A `key[]=value` pair appends to an array, which is
 * how `lease.mjs` passes `parents[]` to `POST /git/commits`; sending it as a
 * literal `parents[]` key would be refused by GitHub.
 *
 * @param {string[]} args
 */
export const fields = (args) => {
  /** @type {Record<string, unknown>} */
  const body = {};

  args.forEach((flag, index) => {
    if (flag !== "-f" && flag !== "-F") return;
    const pair = args[index + 1];
    if (pair === undefined) return;
    const at = pair.indexOf("=");
    if (at === -1) return;
    const key = pair.slice(0, at);
    const raw = pair.slice(at + 1);
    const parsed = flag === "-F" ? typed(raw) : raw;

    if (key.endsWith("[]")) {
      const name = key.slice(0, -2);
      const list = Array.isArray(body[name]) ? /** @type {unknown[]} */ (body[name]) : [];
      list.push(parsed);
      body[name] = list;
    } else {
      body[key] = parsed;
    }
  });

  return body;
};

/**
 * Label names from repeated flags, each of which `gh` also accepts as a
 * comma-separated list (`--add-label a,b`).
 *
 * @param {string[]} args
 * @param {string} flag
 */
const labelValues = (args, flag) =>
  values(args, flag).flatMap((entry) =>
    entry.split(",").map((name) => name.trim()).filter(Boolean),
  );

/**
 * The transport. `request` performs one call and reports the status, the parsed
 * body, and the `Link: rel="next"` path when there is one; everything about how
 * that happens — sockets, proxies, credentials — stays outside this module so it
 * can be tested without any of them.
 *
 * @param {{
 *   request: (call: ApiRequest) => ApiResponse,
 *   repository: string,
 * }} input
 * @returns {(...args: string[]) => string}
 */
export const createTransport = ({ request, repository }) => {
  /**
   * @param {ApiRequest} call
   * @returns {unknown}
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
   * Follows `Link: rel="next"` and concatenates the pages, which is what
   * `gh api --paginate` does for an array response.
   *
   * @param {ApiRequest} call
   * @returns {unknown[]}
   */
  const sendPaginated = (call) => {
    /** @type {unknown[]} */
    const pages = [];
    /** @type {string | null | undefined} */
    let path = call.path;

    while (path) {
      const response = request({ ...call, path });

      if (response.status < 200 || response.status >= 300) {
        throw new ApiError({ ...call, path }, response);
      }

      pages.push(response.body);
      path = response.nextPath;
    }

    return pages;
  };

  /**
   * Follows `Link: rel="next"` until `limit` items that `keep` accepts are
   * collected. REST caps a page at 100, so a `--limit 500` asked for as
   * `per_page=500` would silently return 100 — this is what `gh`'s own
   * `--limit` does instead.
   *
   * @param {string} path
   * @param {number} limit
   * @param {(item: Record<string, any>) => boolean} [keep]
   * @returns {Record<string, any>[]}
   */
  const collect = (path, limit, keep = () => true) => {
    /** @type {Record<string, any>[]} */
    const items = [];
    /** @type {string | null | undefined} */
    let next = path;

    while (next && items.length < limit) {
      const call = { method: "GET", path: next };
      const response = request(call);

      if (response.status < 200 || response.status >= 300) {
        throw new ApiError(call, response);
      }

      items.push(
        .../** @type {Record<string, any>[]} */ (response.body).filter(keep),
      );
      next = response.nextPath;
    }

    return items.slice(0, limit);
  };

  /**
   * An issue's comments in `gh`'s shape — `author.login`, `createdAt`, `url`,
   * which is what the scripts read — alongside the REST fields.
   *
   * @param {string} base
   * @param {unknown} issue
   */
  const issueComments = (base, issue) =>
    /** @type {Record<string, any>[]} */ (
      sendPaginated({
        method: "GET",
        path: `${base}/issues/${issue}/comments?per_page=100`,
      }).flat()
    ).map((comment) => ({
      ...comment,
      author: comment.user ? { login: comment.user.login } : null,
      createdAt: comment.created_at,
      updatedAt: comment.updated_at,
      url: comment.html_url,
    }));

  const authenticatedLogin = () =>
    /** @type {{ login: string }} */ (send({ method: "GET", path: "/user" })).login;

  /**
   * `@me`, or an explicit login — the form `release-claim.mjs` uses to clear
   * a dead session's assignees.
   */
  const resolveAssignee = (assignee, /** @type {string[]} */ args) => {
    if (assignee === "@me") return authenticatedLogin();
    if (/^[A-Za-z0-9-]+(?:\[bot\])?$/.test(assignee)) return assignee;
    throw new UnsupportedCommand(args);
  };

  /** `--limit N` as a positive number, or `fallback`. */
  const limitOf = (/** @type {string[]} */ args, fallback = 30) => {
    const limit = Number(value(args, "--limit") ?? fallback);
    return Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : fallback;
  };

  return (...args) => {
    const [group, command, ...rest] = args;
    const base = `/repos/${repository}`;
    const owner = repository.split("/")[0];

    // `gh pr view|merge <branch>` accepts a branch name; REST wants the number.
    /** @param {string} ref */
    const pullNumber = (ref) => {
      if (/^\d+$/.test(String(ref))) return String(ref);
      const found = /** @type {{ number: number }[]} */ (
        send({
          method: "GET",
          path: `${base}/pulls?state=all&per_page=5&head=${encodeURIComponent(`${owner}:${ref}`)}`,
        })
      );
      if (!found.length) throw new Error(`no pull requests found for branch "${ref}"`);
      return String(found[0].number);
    };

    // gh repo view --json nameWithOwner[,defaultBranchRef]
    if (group === "repo" && command === "view") {
      const repo = /** @type {{ full_name: string, default_branch: string }} */ (
        send({ method: "GET", path: base })
      );

      return JSON.stringify(
        pick(
          {
            nameWithOwner: repo.full_name,
            defaultBranchRef: { name: repo.default_branch },
          },
          value(args, "--json"),
          args,
        ),
      );
    }

    // gh issue list --state open [--label …]… [--assignee A] --limit … --json …
    if (group === "issue" && command === "list") {
      const limit = limitOf(args);
      const query = new URLSearchParams({
        state: value(args, "--state") ?? "open",
        per_page: String(Math.min(limit, 100)),
      });
      const labels = labelValues(args, "--label");
      const assignee = value(args, "--assignee");

      if (labels.length > 0) query.set("labels", labels.join(","));
      if (assignee !== undefined) {
        query.set("assignee", assignee === "@me" ? authenticatedLogin() : assignee);
      }

      const requested = value(args, "--json")?.split(",") ?? [];
      const issues = collect(
        `${base}/issues?${query}`,
        limit,
        // The REST issues list includes pull requests; `gh issue list` does
        // not. Without this, `claim.mjs` could reserve a pull request number.
        (issue) => !("pull_request" in issue),
      );

      return JSON.stringify(
        issues.map((issue) => {
          const available = issueFields(issue);

          // Comments are a separate resource, so only fetch them when asked.
          if (requested.includes("comments")) {
            available.comments = issueComments(base, issue.number);
          }

          return pick(available, value(args, "--json"), args);
        }),
      );
    }

    // gh issue view <n> --json state|comments|…
    if (group === "issue" && command === "view") {
      const issue = /** @type {Record<string, unknown>} */ (
        send({ method: "GET", path: `${base}/issues/${rest[0]}` })
      );
      const requested = value(args, "--json")?.split(",") ?? [];
      const available = issueFields(issue);

      // Comments are a separate resource, so only fetch them when asked.
      if (requested.includes("comments")) {
        available.comments = issueComments(base, rest[0]);
      }

      return JSON.stringify(pick(available, value(args, "--json"), args));
    }

    // gh issue comment <n> --body <text>
    if (group === "issue" && command === "comment") {
      send({
        method: "POST",
        path: `${base}/issues/${rest[0]}/comments`,
        body: { body: value(args, "--body") },
      });
      return "";
    }

    // gh issue edit <n> [--add-assignee @me] [--remove-assignee @me]
    //                   [--add-label L] [--remove-label L]
    //
    // `gh` performs this as one mutation; REST needs up to four calls. A failure
    // partway through throws, which `claim.mjs` compensates for by restoring the
    // issue and releasing its reservation — the same handling it already has for
    // a failed `gh issue edit`.
    if (group === "issue" && command === "edit") {
      const issue = rest[0];

      for (const assignee of values(args, "--add-assignee")) {
        send({
          method: "POST",
          path: `${base}/issues/${issue}/assignees`,
          body: { assignees: [resolveAssignee(assignee, args)] },
        });
      }

      for (const assignee of values(args, "--remove-assignee")) {
        send({
          method: "DELETE",
          path: `${base}/issues/${issue}/assignees`,
          body: { assignees: [resolveAssignee(assignee, args)] },
        });
      }

      const added = labelValues(args, "--add-label");

      if (added.length > 0) {
        send({
          method: "POST",
          path: `${base}/issues/${issue}/labels`,
          body: { labels: added },
        });
      }

      for (const label of labelValues(args, "--remove-label")) {
        // A label that is not present is not an error for `gh`, and callers
        // remove a label without first checking it is there.
        try {
          send({
            method: "DELETE",
            path: `${base}/issues/${issue}/labels/${encodeURIComponent(label)}`,
          });
        } catch (error) {
          if (!(error instanceof ApiError) || error.status !== 404) throw error;
        }
      }

      return "";
    }

    // gh pr view <n> --json …
    if (group === "pr" && command === "view") {
      const pull =
        /** @type {{ number: number, body: string | null, labels: unknown[], head: { sha: string, ref: string }, base?: { ref: string }, user: { login: string, type: string } | null }} */ (
          send({ method: "GET", path: `${base}/pulls/${pullNumber(rest[0])}` })
        );

      return JSON.stringify(
        pick(
          {
            ...pullFields(pull),
            number: pull.number,
            body: pull.body,
            labels: pull.labels,
            headRefOid: pull.head.sha,
            headRefName: pull.head.ref,
            // Read by `isPromotionBranch` for the snapshot promotion shape
            //: a `promotion/*` head is a promotion only when it
            // targets the promotion branch.
            baseRefName: pull.base?.ref ?? null,
            // `gh pr view --json author` reports `{ login, is_bot, ... }` with
            // the `[bot]` suffix stripped; REST reports
            // `user: { login: "dependabot[bot]", type: "Bot" }`. Only `login`
            // and `is_bot` are read (`isDependabotAuthor` in provenance.mjs),
            // and it accepts either spelling of the login, so the two
            // transports agree on whether a pull request is bot-authored.
            author: pull.user
              ? { login: pull.user.login, is_bot: pull.user.type === "Bot" }
              : null,
          },
          value(args, "--json"),
          args,
        ),
      );
    }

    // gh pr edit <n> --add-label|--remove-label <label>
    //
    // Labels on a pull request are issue labels, which is also why this needs no
    // pull-request-specific route.
    if (group === "pr" && command === "edit") {
      const number = pullNumber(rest[0]);
      const added = labelValues(args, "--add-label");

      if (added.length > 0) {
        send({
          method: "POST",
          path: `${base}/issues/${number}/labels`,
          body: { labels: added },
        });
      }

      for (const label of labelValues(args, "--remove-label")) {
        try {
          send({
            method: "DELETE",
            path: `${base}/issues/${number}/labels/${encodeURIComponent(label)}`,
          });
        } catch (error) {
          if (!(error instanceof ApiError) || error.status !== 404) throw error;
        }
      }

      return "";
    }

    // gh pr review <n> --comment --body <text>
    //
    // Only COMMENT. APPROVE and REQUEST_CHANGES are refused by GitHub from a
    // pull request's own author, and every session here shares one identity
    //, so `review.mjs` never asks for them.
    if (group === "pr" && command === "review") {
      if (!args.includes("--comment")) throw new UnsupportedCommand(args);

      send({
        method: "POST",
        path: `${base}/pulls/${pullNumber(rest[0])}/reviews`,
        body: { event: "COMMENT", body: value(args, "--body") },
      });
      return "";
    }

    // gh issue create --title T --body B [--label L]… → prints the issue URL,
    // as `gh` does.
    if (group === "issue" && command === "create") {
      const title = value(args, "--title");
      if (!title) throw new UnsupportedCommand(args);

      const created = /** @type {{ html_url: string }} */ (
        send({
          method: "POST",
          path: `${base}/issues`,
          body: {
            title,
            body: value(args, "--body") ?? "",
            labels: labelValues(args, "--label"),
          },
        })
      );
      return created.html_url;
    }

    // gh pr list [--state open|closed|merged|all] [--head B] [--base B]
    //            [--label L]… [--limit N] --json …
    if (group === "pr" && command === "list") {
      const wanted = value(args, "--state") ?? "open";
      const limit = limitOf(args);
      const query = new URLSearchParams({
        state: wanted === "merged" ? "closed" : wanted,
        per_page: String(Math.min(limit, 100)),
      });
      const head = value(args, "--head");
      const baseRef = value(args, "--base");
      const labels = labelValues(args, "--label");

      if (head) query.set("head", `${owner}:${head}`);
      if (baseRef) query.set("base", baseRef);

      const pulls = collect(
        `${base}/pulls?${query}`,
        limit,
        (pull) =>
          (wanted !== "merged" || Boolean(pull.merged_at)) &&
          // REST cannot filter pull requests by label; `gh` can.
          labels.every((label) =>
            (pull.labels ?? []).some((/** @type {{ name: string }} */ l) => l.name === label),
          ),
      );

      return JSON.stringify(
        pulls.map((pull) => pick(pullFields(pull), value(args, "--json"), args)),
      );
    }

    // gh pr create --title T --body B --base X --head Y [--label L]… [--draft]
    // → prints the pull request URL, as `gh` does.
    if (group === "pr" && command === "create") {
      const title = value(args, "--title");
      const baseRef = value(args, "--base");
      const head = value(args, "--head");
      if (!title || !baseRef || !head) throw new UnsupportedCommand(args);

      const created = /** @type {{ number: number, html_url: string }} */ (
        send({
          method: "POST",
          path: `${base}/pulls`,
          body: {
            title,
            body: value(args, "--body") ?? "",
            base: baseRef,
            head,
            draft: args.includes("--draft"),
          },
        })
      );
      const labels = labelValues(args, "--label");

      if (labels.length > 0) {
        send({
          method: "POST",
          path: `${base}/issues/${created.number}/labels`,
          body: { labels },
        });
      }

      return created.html_url;
    }

    // gh pr merge <n|branch> --merge|--squash|--rebase [--subject S] [--body B]
    //                        [--match-head-commit SHA]
    //
    // `--delete-branch` is refused rather than emulated: deleting the head is
    // a separate ref write that a cloud session's proxy may refuse, and a
    // merge that half-succeeds should say so. `delete-merged-branch.mjs` is the
    // loop's own path for that.
    if (group === "pr" && command === "merge") {
      if (args.includes("--delete-branch") || args.includes("--auto")) {
        throw new UnsupportedCommand(args);
      }

      const number = pullNumber(rest[0]);
      const method = args.includes("--squash")
        ? "squash"
        : args.includes("--rebase")
          ? "rebase"
          : "merge";
      const subject = value(args, "--subject");
      const message = value(args, "--body");
      const sha = value(args, "--match-head-commit");

      send({
        method: "PUT",
        path: `${base}/pulls/${number}/merge`,
        body: {
          merge_method: method,
          ...(subject ? { commit_title: subject } : {}),
          ...(message !== undefined ? { commit_message: message } : {}),
          ...(sha ? { sha } : {}),
        },
      });
      return "";
    }

    // gh label list [--limit N] --json name[,color,description]
    if (group === "label" && command === "list") {
      const limit = limitOf(args);
      const labels = collect(
        `${base}/labels?per_page=${Math.min(limit, 100)}`,
        limit,
      );

      return JSON.stringify(
        labels.map((label) =>
          pick(
            { name: label.name, color: label.color, description: label.description ?? "" },
            value(args, "--json"),
            args,
          ),
        ),
      );
    }

    // gh label create <name> [--color C] [--description D]
    if (group === "label" && command === "create") {
      const name = rest[0];
      if (!name || name.startsWith("-") || args.includes("--force")) {
        throw new UnsupportedCommand(args);
      }

      const color = value(args, "--color");
      send({
        method: "POST",
        path: `${base}/labels`,
        body: {
          name,
          ...(color ? { color: color.replace(/^#/, "") } : {}),
          ...(value(args, "--description") !== undefined
            ? { description: value(args, "--description") }
            : {}),
        },
      });
      return "";
    }

    // gh api [--method M] [--paginate] [--slurp] <path> [-f k=v]… [-F k=v]…
    if (group === "api") {
      // `--jq` filters output in `gh`; returning the unfiltered JSON instead
      // would be read as the filtered value, so it is refused by name.
      if (args.includes("--jq")) throw new UnsupportedCommand(args);

      const method = value(args, "--method") ?? "GET";
      // The path is the first bare argument: everything else is a flag or a
      // flag's value.
      const flagged = new Set(
        args.flatMap((entry, index) =>
          ["--method", "-f", "-F"].includes(entry) ? [index + 1] : [],
        ),
      );
      const path = args
        .slice(1)
        .find(
          (entry, index) => !entry.startsWith("-") && !flagged.has(index + 1),
        );

      if (!path) throw new UnsupportedCommand(args);

      const body = fields(args);
      const call = {
        method,
        path: path.startsWith("/") ? path : `/${path}`,
        ...(Object.keys(body).length > 0 ? { body } : {}),
      };

      if (args.includes("--paginate")) {
        const pages = sendPaginated(call);
        // `--slurp` keeps the pages as an array of arrays; without it `gh`
        // concatenates them.
        return JSON.stringify(args.includes("--slurp") ? pages : pages.flat());
      }

      const response = send(call);

      // A 204 has no body. `gh` prints nothing, and the DELETE callers ignore
      // stdout entirely.
      return response === undefined || response === null
        ? ""
        : JSON.stringify(response);
    }

    throw new UnsupportedCommand(args);
  };
};

/**
 * The `gh issue`-flavoured view of a REST issue.
 *
 * `state` is the one to be careful with: `gh` reports `OPEN`/`CLOSED` and
 * `cleanup.mjs` compares against `CLOSED`, so lower-casing it here would stop
 * every reservation from being released.
 *
 * @param {Record<string, unknown>} issue
 * @returns {Record<string, unknown>}
 */
const issueFields = (issue) => ({
  number: issue.number,
  title: issue.title,
  body: issue.body,
  labels: issue.labels,
  assignees: issue.assignees,
  state: String(issue.state ?? "").toUpperCase(),
  createdAt: issue.created_at,
  updatedAt: issue.updated_at,
  closedAt: issue.closed_at ?? null,
  url: issue.html_url,
});

/**
 * The `gh pr`-flavoured view of a REST pull request, for `pr list` and
 * `pr view`. `state` follows `gh`: `MERGED` for a merged pull request, which
 * REST reports as `closed` with a `merged_at`.
 *
 * `closingIssuesReferences` is deliberately absent. `gh` reads it from
 * GitHub's own issue linking, which REST does not expose, and
 * `preflight.mjs` compares it against the body's keywords — deriving it from
 * those same keywords would make that comparison agree with itself. Asking
 * for it throws, which its caller already treats as "not available".
 *
 * @param {Record<string, any>} pull
 * @returns {Record<string, unknown>}
 */
const pullFields = (pull) => ({
  number: pull.number,
  title: pull.title,
  body: pull.body,
  labels: pull.labels,
  url: pull.html_url,
  isDraft: Boolean(pull.draft),
  state: pull.merged_at ? "MERGED" : String(pull.state ?? "").toUpperCase(),
  headRefName: pull.head?.ref ?? null,
  headRefOid: pull.head?.sha ?? null,
  baseRefName: pull.base?.ref ?? null,
  mergedAt: pull.merged_at ?? null,
  closedAt: pull.closed_at ?? null,
  createdAt: pull.created_at,
  updatedAt: pull.updated_at,
  mergeCommit:
    pull.merged_at && pull.merge_commit_sha ? { oid: pull.merge_commit_sha } : null,
  author: pull.user
    ? { login: pull.user.login, is_bot: pull.user.type === "Bot" }
    : null,
});

export default createTransport;
