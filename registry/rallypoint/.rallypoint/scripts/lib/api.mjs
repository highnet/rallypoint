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
// The surface is deliberately only what `claim.mjs`, `cleanup.mjs`, and
// `review.mjs` actually call. `close-referenced-issues.mjs` is not included: it
// runs in Actions where `gh` exists, and has never been affected by any of this.

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
        // session rediscovering it — see #246.
        (detail?.includes("not enabled for this session")
          ? "\n\nThis session's credential is not authorized for the repository " +
            "API, so no Rallypoint command can reach GitHub from here. The " +
            "remedy is an org admin connecting the GitHub App for the " +
            "organization; see #246 for what has been measured."
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
 * `-f key=value` pairs, as `gh api` takes them. Values are strings; `gh` also
 * accepts typed `-F`, which no caller here uses.
 *
 * @param {string[]} args
 */
const fields = (args) => {
  /** @type {Record<string, string>} */
  const body = {};

  for (const pair of values(args, "-f")) {
    const at = pair.indexOf("=");
    if (at === -1) continue;
    body[pair.slice(0, at)] = pair.slice(at + 1);
  }

  return body;
};

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

  const authenticatedLogin = () =>
    /** @type {{ login: string }} */ (send({ method: "GET", path: "/user" })).login;

  /** @param {string} assignee `@me`, which is the only form any caller uses. */
  const resolveAssignee = (assignee, /** @type {string[]} */ args) => {
    if (assignee !== "@me") throw new UnsupportedCommand(args);
    return authenticatedLogin();
  };

  return (...args) => {
    const [group, command, ...rest] = args;
    const base = `/repos/${repository}`;

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

    // gh issue list --state open --label … --limit … --json …
    if (group === "issue" && command === "list") {
      const query = new URLSearchParams({
        state: value(args, "--state") ?? "open",
        per_page: value(args, "--limit") ?? "30",
      });
      const labels = values(args, "--label");

      if (labels.length > 0) query.set("labels", labels.join(","));

      const issues = /** @type {Record<string, unknown>[]} */ (
        send({ method: "GET", path: `${base}/issues?${query}` })
      );

      return JSON.stringify(
        issues
          // The REST issues list includes pull requests; `gh issue list` does
          // not. Without this, `claim.mjs` could reserve a pull request number.
          .filter((issue) => !("pull_request" in issue))
          .map((issue) => pick(issueFields(issue), value(args, "--json"), args)),
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
        available.comments = /** @type {unknown[]} */ (
          sendPaginated({
            method: "GET",
            path: `${base}/issues/${rest[0]}/comments?per_page=100`,
          }).flat()
        );
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

      const added = values(args, "--add-label");

      if (added.length > 0) {
        send({
          method: "POST",
          path: `${base}/issues/${issue}/labels`,
          body: { labels: added },
        });
      }

      for (const label of values(args, "--remove-label")) {
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
          send({ method: "GET", path: `${base}/pulls/${rest[0]}` })
        );

      return JSON.stringify(
        pick(
          {
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
            // and `is_bot` are read (`isDependabotAuthor` in provenance.mjs,
            // #1225), and it accepts either spelling of the login, so the two
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
      const added = values(args, "--add-label");

      if (added.length > 0) {
        send({
          method: "POST",
          path: `${base}/issues/${rest[0]}/labels`,
          body: { labels: added },
        });
      }

      for (const label of values(args, "--remove-label")) {
        try {
          send({
            method: "DELETE",
            path: `${base}/issues/${rest[0]}/labels/${encodeURIComponent(label)}`,
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
        path: `${base}/pulls/${rest[0]}/reviews`,
        body: { event: "COMMENT", body: value(args, "--body") },
      });
      return "";
    }

    // gh api [--method M] [--paginate] [--slurp] <path> [-f k=v]…
    if (group === "api") {
      const method = value(args, "--method") ?? "GET";
      // The path is the first bare argument: everything else is a flag or a
      // flag's value.
      const flagged = new Set(
        args.flatMap((entry, index) =>
          ["--method", "-f", "--jq"].includes(entry) ? [index + 1] : [],
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
});

export default createTransport;
