// GitHub's git-data writes, emulated with plain `git` where the API refuses
// them — and the `rallypoint: released` markers that emulation leaves behind,
// hidden from every read.
//
// A Claude Code cloud session's GitHub proxy refuses every write to the
// git-data API (`POST/PATCH/DELETE …/git/refs`, `POST …/git/commits`) with
// `HTTP 403: Write access to this GitHub API path is not permitted through this
// proxy`, over REST and through `gh` alike, and its git proxy refuses branch
// deletes. `git push` of a new or moved ref works. Rallypoint's claims and
// leases are refs, so without this no session there can claim an issue.
//
// Each write keeps the semantics a caller depends on:
//
//  - **Create stays atomic.** `--force-with-lease=<ref>:` refuses the push when
//    the ref already exists, which is the "another session got there first"
//    that `claim.mjs` reads from a throw. Each reservation is pushed as its own
//    commit (a wrapper on the requested sha), because pushing a sha the remote
//    already holds at that ref is a no-op success, not a refusal.
//  - **Delete becomes release.** A coordination ref (`rallypoint-claims/…`,
//    `rallypoint-sessions/…`) is moved, under a lease, onto a marker commit
//    whose subject starts `rallypoint: released`. `hideReleased` makes every
//    read treat it as absent, and the next create may take it over.
//    `sweep-released.mjs`, run where deletes are allowed, removes them for
//    good. Any other ref (an agent branch) cannot be released, so deleting one
//    throws by name rather than reporting a delete that did not happen.
//  - **Commits are made locally** with `git commit-tree` and pushed by the ref
//    write that names them.
//
// Kept apart from `gh.mjs` so all of it can be tested with a stub `git`.

/** The subject prefix of every marker a release leaves on a coordination ref. */
export const RELEASED_MARK = "rallypoint: released";

/** @param {unknown} message */
export const isReleasedMessage = (message) =>
  String(message ?? "").startsWith(RELEASED_MARK);

/**
 * The proxy's refusal of a git-data write. A refused write changed nothing, so
 * emulating it afterwards is safe.
 *
 * @param {unknown} error
 */
export const isGitDataRefused = (error) => {
  const detail = /** @type {{ stderr?: unknown, message?: unknown }} */ (error ?? {});
  return /Write access to this GitHub API path is not permitted through this proxy/.test(
    `${detail.stderr ?? ""}\n${detail.message ?? ""}`,
  );
};

/**
 * Which git-data write a `gh api` call is, if any — the pure half, so the
 * routing of every ref create, move and delete can be tested without a remote.
 *
 * @param {string[]} args
 * @returns {{ method: string, kind: "refs" | "commits", rest: string | undefined, fields: Record<string, string[]> } | null}
 */
export const gitDataRequest = (args) => {
  if (args[0] !== "api") return null;

  let method;
  /** @type {Record<string, string[]>} */
  const fields = {};
  /** @type {string | undefined} */
  let path;

  for (let index = 1; index < args.length; index += 1) {
    const entry = args[index];
    if (entry === "--method" || entry === "-X") {
      method = String(args[(index += 1)] ?? "").toUpperCase();
    } else if (["-f", "-F", "--raw-field", "--field"].includes(entry)) {
      const pair = args[(index += 1)] ?? "";
      const at = pair.indexOf("=");
      if (at === -1) continue;
      const key = pair.slice(0, at).replace(/\[\]$/, "");
      (fields[key] ??= []).push(pair.slice(at + 1));
    } else if (entry === "--jq" || entry === "-q") {
      index += 1;
    } else if (!entry.startsWith("-") && path === undefined) {
      path = entry;
    }
  }

  // `gh api` with fields and no method is a POST.
  method ??= Object.keys(fields).length > 0 ? "POST" : "GET";
  if (method === "GET" || !path) return null;

  const match = /^\/?repos\/[^/]+\/[^/]+\/git\/(refs|commits)(?:\/([^?]+))?$/.exec(path);
  if (!match) return null;

  return {
    method,
    kind: /** @type {"refs" | "commits"} */ (match[1]),
    rest: match[2],
    fields,
  };
};

/**
 * Whether a full ref name is a Rallypoint coordination ref: under the claim or
 * session prefix of `.rallypoint/config.json`.
 *
 * @param {{ claimRefPrefix?: string, sessionRefPrefix?: string }} [config]
 * @returns {(ref: string) => boolean}
 */
export const coordinationRefs = (config = {}) => {
  // The namespace, not the per-issue prefix: `rallypoint-claims/issue-` →
  // `rallypoint-claims/`.
  const root = (/** @type {string} */ prefix) =>
    prefix.includes("/") ? prefix.slice(0, prefix.lastIndexOf("/") + 1) : prefix;
  const roots = [config.claimRefPrefix ?? "rallypoint-claims/issue-", config.sessionRefPrefix ?? "rallypoint-sessions/"]
    .map(root)
    .filter(Boolean)
    .map((prefix) => `refs/heads/${prefix}`);

  return (ref) => roots.some((prefix) => ref.startsWith(prefix));
};

/** A refused emulated write, shaped like the `gh api` failure it stands for. */
const refused = (/** @type {number} */ status, /** @type {string} */ message) =>
  Object.assign(new Error(`HTTP ${status}: ${message}`), { status, stderr: `gh: ${message} (HTTP ${status})` });

/**
 * The emulation itself. `git` runs one git command in the checkout and returns
 * its trimmed stdout, throwing on a non-zero exit.
 *
 * @param {{
 *   git: (...args: string[]) => string,
 *   isCoordinationRef: (ref: string) => boolean,
 *   now?: () => string,
 *   nonce?: () => string,
 * }} input
 * @returns {(request: NonNullable<ReturnType<typeof gitDataRequest>>) => string}
 */
export const createGitDataEmulation = ({
  git,
  isCoordinationRef,
  now = () => new Date().toISOString(),
  nonce = () => String(process.pid),
}) => {
  /** Makes `sha` available locally, fetching it from origin when it is not. */
  const have = (/** @type {string} */ sha) => {
    try {
      git("cat-file", "-e", `${sha}^{commit}`);
    } catch {
      git("fetch", "--quiet", "--no-tags", "origin", sha);
    }
  };

  /** The sha `ref` holds on origin, or "" when it is absent. Exact names only. */
  const remoteSha = (/** @type {string} */ ref) => {
    for (const line of git("ls-remote", "origin", ref).split("\n")) {
      const [sha, name] = line.trim().split(/\s+/);
      if (name === ref) return sha;
    }
    return "";
  };

  const released = (/** @type {string} */ sha) => {
    have(sha);
    return isReleasedMessage(git("log", "-1", "--format=%s", sha));
  };

  /** @param {string} key @param {Record<string, string[]>} fields */
  const one = (key, fields) => {
    const value = fields[key]?.at(-1);
    if (value === undefined) throw refused(422, `Invalid request: "${key}" is required`);
    return value;
  };

  return ({ method, kind, rest, fields }) => {
    if (kind === "commits" && method === "POST") {
      const tree = one("tree", fields);
      const parents = fields.parents ?? [];
      for (const parent of parents) have(parent);
      const sha = git(
        "commit-tree",
        tree,
        ...parents.flatMap((parent) => ["-p", parent]),
        "-m",
        fields.message?.at(-1) ?? "",
      );
      return JSON.stringify({
        sha,
        tree: { sha: tree },
        parents: parents.map((parent) => ({ sha: parent })),
        message: fields.message?.at(-1) ?? "",
      });
    }

    if (kind === "refs" && method === "POST") {
      const ref = one("ref", fields);
      const sha = one("sha", fields);
      have(sha);

      // Absent, or left at a released marker: anything else is taken.
      const current = remoteSha(ref);
      if (current && !released(current)) throw refused(422, "Reference already exists");

      // A lease commit is unique already (dispatch time, head) and is the
      // record `lease.mjs` reads from the commit the ref points at, so it is
      // pushed as itself; wrapping it would hide those trailers.
      const unique = /^Rallypoint-Lease-Role:/m.test(git("log", "-1", "--format=%B", sha))
        ? sha
        : git(
            "commit-tree",
            git("rev-parse", `${sha}^{tree}`),
            "-p",
            sha,
            "-m",
            `rallypoint: reserve ${ref} at ${now()} ${nonce()}`,
          );

      try {
        git("push", "--quiet", "--no-verify", `--force-with-lease=${ref}:${current}`, "origin", `${unique}:${ref}`);
      } catch (error) {
        // The lease refused: someone else wrote the ref between the read and
        // the push. That is the lost race, reported as GitHub would.
        throw Object.assign(refused(422, "Reference already exists"), { cause: error });
      }
      return JSON.stringify({ ref, object: { sha: unique, type: "commit" } });
    }

    if (kind === "refs" && method === "PATCH" && rest) {
      const ref = `refs/${rest}`;
      const sha = one("sha", fields);
      have(sha);
      const force = (fields.force ?? []).at(-1) === "true";
      if (!remoteSha(ref)) throw refused(422, "Reference does not exist");
      git("push", "--quiet", "--no-verify", ...(force ? ["--force"] : []), "origin", `${sha}:${ref}`);
      return JSON.stringify({ ref, object: { sha, type: "commit" } });
    }

    if (kind === "refs" && method === "DELETE" && rest) {
      const ref = `refs/${rest}`;
      const current = remoteSha(ref);
      if (!current || released(current)) throw refused(422, "Reference does not exist");

      if (!isCoordinationRef(ref)) {
        throw refused(
          403,
          `this session cannot delete \`${ref}\`: the GitHub API and git proxy here refuse ref ` +
            "deletes, and only Rallypoint coordination refs can be released instead. It is left " +
            "in place for `.rallypoint/scripts/sweep-released.mjs`, run where deletes are allowed",
        );
      }

      const mark = git(
        "commit-tree",
        git("rev-parse", `${current}^{tree}`),
        "-p",
        current,
        "-m",
        `${RELEASED_MARK} ${ref} at ${now()}`,
      );
      git("push", "--quiet", "--no-verify", `--force-with-lease=${ref}:${current}`, "origin", `${mark}:${ref}`);
      return "";
    }

    throw refused(422, `the git-data emulation does not implement ${method} git/${kind}`);
  };
};

/**
 * Hides released coordination refs from a `gh api` read, exactly as if they
 * were deleted: dropped from a `matching-refs` listing, a 404 for a single-ref
 * read. Applies on every transport, `gh` included — a released marker left by
 * a cloud session must read the same from a laptop.
 *
 * A commit that cannot be read is *not* released: an unreadable ref stays
 * visible, never folded into "absent".
 *
 * @param {{
 *   read: (...args: string[]) => string,
 *   isCoordinationRef: (ref: string) => boolean,
 * }} input
 * @returns {(args: string[], out: string) => string}
 */
export const createReleasedFilter = ({ read, isCoordinationRef }) => {
  /** @type {Map<string, boolean>} */
  const cache = new Map();

  /** @param {string} repository @param {string} sha */
  const releasedAt = (repository, sha) => {
    const key = `${repository}@${sha}`;
    if (!cache.has(key)) {
      let isReleased = false;
      try {
        isReleased = isReleasedMessage(
          JSON.parse(read("api", `repos/${repository}/git/commits/${sha}`))?.message,
        );
      } catch {
        isReleased = false;
      }
      cache.set(key, isReleased);
    }
    return cache.get(key);
  };

  return (args, out) => {
    if (args[0] !== "api" || gitDataRequest(args) !== null) return out;
    // A `--jq` result is no longer the ref records this reads. No Rallypoint
    // script filters a ref read with `--jq`.
    if (args.includes("--jq") || args.includes("-q")) return out;

    const path = args.find((entry, index) => index > 0 && /^\/?repos\//.test(entry)) ?? "";
    const match = /^\/?repos\/([^/]+\/[^/]+)\/git\/(matching-refs|ref)\/(heads\/[^?]*)/.exec(path);
    if (!match) return out;
    const [, repository, route] = match;

    /** @type {unknown} */
    let parsed;
    try {
      parsed = JSON.parse(out || "null");
    } catch {
      return out;
    }

    const isHidden = (/** @type {any} */ ref) =>
      typeof ref?.ref === "string" &&
      isCoordinationRef(ref.ref) &&
      typeof ref?.object?.sha === "string" &&
      releasedAt(repository, ref.object.sha);

    if (route === "matching-refs" && Array.isArray(parsed)) {
      const pages = args.includes("--slurp") && parsed.every(Array.isArray);
      return JSON.stringify(
        pages
          ? parsed.map((page) => page.filter((/** @type {unknown} */ ref) => !isHidden(ref)))
          : parsed.filter((ref) => !isHidden(ref)),
      );
    }

    if (route === "ref" && isHidden(parsed)) throw refused(404, "Not Found");
    return out;
  };
};
