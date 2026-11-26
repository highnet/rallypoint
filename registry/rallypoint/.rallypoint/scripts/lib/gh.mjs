// The real `gh` runner and the config load, kept out of the pure modules so no
// test can reach the live repository by importing one of them.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { createTransport, fields } from "./api.mjs";
import { validateConfig } from "./config.mjs";
import { EXIT_MISSING_PREREQUISITE, checkGh } from "./prerequisites.mjs";
import { repositoryFrom, syncRequest } from "./request.mjs";

// Probed once per process, and lazily: importing this module must stay free of
// side effects, and a command that never reaches GitHub should not require a
// binary it will not use.
let ghAvailable = false;

/**
 * A deliberate testability seam: a fixture that sets this variable to
 * the absolute path of a `.mjs` file redirects every `gh` invocation below to
 * `process.execPath <that file>` instead of resolving a `gh` binary from
 * `PATH`. That sidesteps two POSIX-only assumptions the previous fixtures
 * made — that an extensionless file can be marked executable, and that `PATH`
 * is `:`-delimited — without touching how the real `gh` is invoked in
 * production, where this variable is never set.
 *
 * A default of `"gh"` rather than reading an ambient variable that might
 * already be set is deliberate: fixtures must opt in explicitly, so this
 * cannot become a way for an unrelated test, or a developer's environment, to
 * silently redirect a script at something other than the real `gh` CLI.
 */
const GH_SCRIPT_ENV = "RALLYPOINT_GH_SCRIPT";

/**
 * Resolves the command and leading arguments used to invoke `gh`, honouring
 * the `RALLYPOINT_GH_SCRIPT` override described above.
 *
 * @returns {{ command: string, prefixArgs: string[] }}
 */
const ghCommand = () => {
  const script = process.env[GH_SCRIPT_ENV];
  if (script) return { command: process.execPath, prefixArgs: [script] };
  return { command: "gh", prefixArgs: [] };
};

/**
 * Establishes that `gh` is runnable before the first call that needs it, so a
 * missing prerequisite is reported by name instead of arriving as an
 * `execFileSync` ENOENT several calls into a claim.
 */
export const ensureGh = () => {
  if (ghAvailable) return;

  const { command, prefixArgs } = ghCommand();
  const result = checkGh({
    probe: () =>
      execFileSync(command, [...prefixArgs, "--version"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }),
  });

  if (!result.ok) {
    console.error(result.message);
    process.exit(EXIT_MISSING_PREREQUISITE);
  }

  ghAvailable = true;
};

// ---------------------------------------------------------------------------
// Transport choice
// ---------------------------------------------------------------------------

/**
 * Which transport a Rallypoint command should use, and why — pure over the
 * environment so the rule can be tested and reported (`swarm doctor` prints
 * it). In order:
 *
 *  1. `RALLYPOINT_TRANSPORT=rest|gh` forces either.
 *  2. `RALLYPOINT_GH_SCRIPT` (the fixture seam above) means `gh`: a fixture
 *     that opted into a fake `gh` must get it, even inside a cloud session.
 *  3. `CLAUDE_CODE_REMOTE=true` — a Claude Code cloud session — means REST.
 *     `gh` is installed there, but GitHub's GraphQL API, which every
 *     high-level `gh pr|issue|repo|label` subcommand uses, answers 403. Only
 *     REST, and `git` itself, reach GitHub.
 *  4. Otherwise `gh` when it is on `PATH`, REST when it is not.
 *
 * `emulateGitData` is set for the first and third REST cases: the session
 * proxy in a cloud session also refuses GitHub's git-data writes
 * (`POST /git/refs`, `POST /git/commits`, ref deletes), so those are performed
 * with `git push` instead — see `emulateGitDataWrite`. A forced
 * `RALLYPOINT_TRANSPORT=rest` gets the same treatment, so a cloud session's
 * behaviour can be reproduced anywhere.
 *
 * @param {Record<string, string | undefined>} [env]
 * @param {{ hasGhBinary?: () => boolean }} [probes]
 * @returns {{ kind: "gh" | "rest", emulateGitData: boolean, reason: string }}
 */
export const transportChoice = (env = process.env, { hasGhBinary = () => hasGh() } = {}) => {
  const forced = env.RALLYPOINT_TRANSPORT;

  if (forced === "rest") {
    return { kind: "rest", emulateGitData: true, reason: "RALLYPOINT_TRANSPORT=rest" };
  }
  if (forced === "gh") {
    return { kind: "gh", emulateGitData: false, reason: "RALLYPOINT_TRANSPORT=gh" };
  }
  if (env[GH_SCRIPT_ENV]) {
    return { kind: "gh", emulateGitData: false, reason: `${GH_SCRIPT_ENV} fixture` };
  }
  if (env.CLAUDE_CODE_REMOTE === "true") {
    return {
      kind: "rest",
      emulateGitData: true,
      reason: "CLAUDE_CODE_REMOTE=true (cloud session: GraphQL is blocked)",
    };
  }
  if (hasGhBinary()) return { kind: "gh", emulateGitData: false, reason: "gh on PATH" };
  return { kind: "rest", emulateGitData: false, reason: "no gh on PATH" };
};

/**
 * Whether the environment asks for REST outright — a cloud session or a
 * forced `RALLYPOINT_TRANSPORT=rest` — decided without probing for `gh`.
 */
const restRequested = () =>
  transportChoice(process.env, { hasGhBinary: () => true }).emulateGitData;

// ---------------------------------------------------------------------------
// Released coordination refs
// ---------------------------------------------------------------------------

/**
 * The subject every emulated ref delete leaves on a coordination ref.
 *
 * Some sessions may not delete refs at all: a cloud session's git proxy
 * answers a ref deletion with 403. A claim or lease that could never be
 * released would wedge its issue forever, so such a session *releases* the
 * ref instead — moves it to a commit whose subject starts with this marker —
 * and every read through this module treats a ref at a marker exactly as if
 * it were absent. The next claimant may take it over.
 *
 * Released refs accumulate until something with delete rights prunes them
 * (`close-referenced-issues.mjs` already deletes the reservations of closed
 * issues when it runs in Actions); until then a raw `git ls-remote` still
 * lists them.
 */
export const RELEASED_MARK = "rallypoint: released";

/** The subject of the commit each emulated ref create pushes. */
export const RESERVE_MARK = "rallypoint: reserve";

/** @param {unknown} message */
export const isReleasedMessage = (message) =>
  String(message ?? "").startsWith(RELEASED_MARK);

/**
 * The ref namespaces Rallypoint coordinates through — the only refs a release
 * marker can stand for. Read from `.rallypoint/config.json` when it is there,
 * without failing when it is not: this runs inside every `gh` call, and a
 * broken config is `loadConfig`'s to report.
 *
 * @returns {string[]}
 */
const coordinationPrefixes = () => {
  try {
    const config = JSON.parse(
      readFileSync(new URL("../../config.json", import.meta.url), "utf8"),
    );
    const prefixes = [config.claimRefPrefix, config.sessionRefPrefix].filter(
      (prefix) => typeof prefix === "string" && prefix !== "",
    );
    if (prefixes.length > 0) return prefixes;
  } catch {
    // fall through to the defaults
  }
  return ["rallypoint-claims/", "rallypoint-sessions/"];
};

/** @param {string} shortRef a ref name without `refs/heads/` */
const isCoordinationRef = (shortRef, prefixes = coordinationPrefixes()) =>
  prefixes.some((prefix) => shortRef.startsWith(prefix));

/** sha → whether that commit is a release marker. Commits never change. */
const releasedCache = new Map();

/**
 * Hides released coordination refs from a `gh api` read, so they read as
 * absent exactly as deleted ones would: a `matching-refs` listing drops them,
 * and a single `git/ref/heads/…` read of one throws a 404.
 *
 * A marker commit that cannot be read is treated as *not* released: an
 * unreadable ref stays visible, never folded into "absent", for the same
 * reason `lease.mjs` reports an unreadable lease rather than dropping it.
 *
 * @param {string[]} args the `gh api` call that produced `out`.
 * @param {string} out its output.
 * @param {(...args: string[]) => string} read the transport commits are read through.
 * @param {{ prefixes?: string[] }} [options]
 * @returns {string}
 */
export const hideReleased = (args, out, read, { prefixes } = {}) => {
  if (args[0] !== "api") return out;
  const method = (args[args.indexOf("--method") + 1] ?? "GET").toUpperCase();
  if (args.includes("--method") && method !== "GET") return out;

  const path = args.find((entry, index) => index > 0 && /^\/?repos\//.test(entry)) ?? "";
  const listing = /\/git\/matching-refs\/heads\//.test(path);
  const single = /\/git\/ref\/heads\//.exec(path);
  if (!listing && !single) return out;

  const known = prefixes ?? coordinationPrefixes();
  const repository = /repos\/([^/]+\/[^/]+)\//.exec(path)?.[1];

  /** @param {{ ref?: string, object?: { sha?: string } } | null | undefined} ref */
  const released = (ref) => {
    const name = String(ref?.ref ?? "").replace(/^refs\/heads\//, "");
    const sha = ref?.object?.sha;
    if (!sha || !isCoordinationRef(name, known)) return false;
    if (!releasedCache.has(sha)) {
      try {
        const commit = JSON.parse(read("api", `repos/${repository}/git/commits/${sha}`));
        releasedCache.set(sha, isReleasedMessage(commit?.message));
      } catch {
        return false;
      }
    }
    return releasedCache.get(sha);
  };

  let parsed;
  try {
    parsed = JSON.parse(out || "null");
  } catch {
    return out;
  }

  if (listing && Array.isArray(parsed)) {
    // `--paginate --slurp` returns an array of pages.
    const pages = parsed.every(Array.isArray);
    const kept = pages
      ? parsed.map((page) => page.filter((ref) => !released(ref)))
      : parsed.filter((ref) => !released(ref));
    return JSON.stringify(kept);
  }

  if (single && parsed && !Array.isArray(parsed) && released(parsed)) {
    throw new Error(`HTTP 404: Not Found (${path} is a released coordination ref)`);
  }

  return out;
};

// ---------------------------------------------------------------------------
// Git-data writes over git
// ---------------------------------------------------------------------------

/**
 * Which git-data write a `gh api` call is, if any — the pure half of
 * `emulateGitDataWrite`, so the routing of every ref create, move and delete
 * can be tested without a remote.
 *
 * @param {string[]} args
 * @returns {{ method: string, kind: "refs" | "commits", rest: string | undefined, body: Record<string, unknown> } | null}
 */
export const gitDataRequest = (args) => {
  if (args[0] !== "api" || !args.includes("--method")) return null;
  const method = String(args[args.indexOf("--method") + 1] ?? "GET").toUpperCase();
  if (method === "GET") return null;
  const path = args.find((entry, index) => index > 0 && /^\/?repos\//.test(entry));
  const match = path && /repos\/[^/]+\/[^/]+\/git\/(refs|commits)(?:\/(.+))?$/.exec(path);
  if (!match) return null;
  return {
    method,
    kind: /** @type {"refs" | "commits"} */ (match[1]),
    rest: match[2],
    body: fields(args),
  };
};

/** @param {string} message @param {number} [status] */
const httpError = (message, status = 422) => {
  const error = new Error(`HTTP ${status}: ${message}`);
  /** @type {any} */ (error).status = status;
  return error;
};

/**
 * Performs a git-data write with plain `git` against `origin`, for a session
 * whose proxy refuses GitHub's git-data API but lets `git push` through. Each
 * write keeps the semantics a caller depends on:
 *
 *  - **`POST /git/commits`** builds the commit locally with `git commit-tree`
 *    (fetching parents first); the ref write that follows pushes it.
 *  - **`POST /git/refs` stays create-only.** It is a compare-and-swap:
 *    `--force-with-lease=<ref>:<expected>` refuses the push if anyone moved the
 *    ref since it was read, and the ref must be absent or at a release marker.
 *    The pushed commit is a fresh `rallypoint: reserve` commit on top of the
 *    requested SHA, because two claimants pushing the *same* SHA would both
 *    see "up to date" and both believe they won. A lease commit is already
 *    unique and carries the trailers `lease.mjs` reads, so it is pushed as
 *    itself.
 *  - **`PATCH /git/refs/…`** pushes, forcing only when `force=true` was asked.
 *  - **`DELETE /git/refs/…`** deletes when the remote allows it. When it does
 *    not, a coordination ref is released instead — moved to a
 *    `rallypoint: released` marker — and any other ref is reported as the
 *    failure it is, never silently skipped.
 *
 * @param {string[]} args
 * @param {{ git?: (...args: string[]) => string, now?: () => Date, prefixes?: string[] }} [options]
 * @returns {string | null} the `gh`-shaped output, or null when `args` is not such a write.
 */
export const emulateGitDataWrite = (args, { git: run = git, now = () => new Date(), prefixes } = {}) => {
  const request = gitDataRequest(args);
  if (!request) return null;

  const { method, kind, rest, body } = request;
  const str = (/** @type {unknown} */ entry) => (typeof entry === "string" ? entry : "");

  /** Makes `sha` available locally, fetching `ref` (or the SHA itself) from origin. */
  const have = (/** @type {string} */ sha, /** @type {string} */ ref = "") => {
    try {
      run("cat-file", "-e", `${sha}^{commit}`);
      return;
    } catch {
      // fetched below
    }
    try {
      run("fetch", "--quiet", "--no-tags", "origin", ref || sha);
    } catch {
      run("fetch", "--quiet", "--no-tags", "origin", sha);
    }
  };

  /** The remote SHA of exactly `ref`, or "" when it does not exist. */
  const remoteSha = (/** @type {string} */ ref) =>
    run("ls-remote", "origin", ref)
      .split("\n")
      .map((line) => line.split(/\s+/))
      .find(([, name]) => name === ref)?.[0] ?? "";

  const isReleased = (/** @type {string} */ sha, /** @type {string} */ ref) => {
    have(sha, ref);
    return isReleasedMessage(run("log", "-1", "--format=%s", sha));
  };

  if (kind === "commits" && method === "POST") {
    const parents = /** @type {unknown[]} */ (Array.isArray(body.parents) ? body.parents : []).map(str);
    for (const parent of parents) have(parent);
    const sha = run(
      "commit-tree",
      str(body.tree),
      ...parents.flatMap((parent) => ["-p", parent]),
      "-m",
      str(body.message),
    );
    return JSON.stringify({ sha, tree: { sha: str(body.tree) }, parents: parents.map((p) => ({ sha: p })) });
  }

  if (kind === "refs" && method === "POST" && rest === undefined) {
    const ref = str(body.ref);
    const sha = str(body.sha);
    have(sha);

    const current = remoteSha(ref);
    if (current && !isReleased(current, ref)) throw httpError(`Reference already exists: ${ref}`);

    const own = run("log", "-1", "--format=%B", sha);
    const unique = /^Rallypoint-Lease-Role:/m.test(own)
      ? sha
      : run(
          "commit-tree",
          run("rev-parse", `${sha}^{tree}`),
          "-p",
          sha,
          "-m",
          `${RESERVE_MARK} ${ref} at ${now().toISOString()} ${process.pid}`,
        );
    try {
      run("push", "--quiet", `--force-with-lease=${ref}:${current}`, "origin", `${unique}:${ref}`);
    } catch (error) {
      throw httpError(`Reference already exists: ${ref} (${describe(error)})`);
    }
    return JSON.stringify({ ref, object: { sha: unique, type: "commit" } });
  }

  if (kind === "refs" && method === "PATCH" && rest) {
    const ref = `refs/${rest}`;
    const sha = str(body.sha);
    have(sha);
    const force = body.force === true || body.force === "true";
    try {
      run("push", "--quiet", "origin", `${force ? "+" : ""}${sha}:${ref}`);
    } catch (error) {
      throw httpError(`Update is not a fast forward: ${ref} (${describe(error)})`);
    }
    return JSON.stringify({ ref, object: { sha, type: "commit" } });
  }

  if (kind === "refs" && method === "DELETE" && rest) {
    const ref = `refs/${rest}`;
    const current = remoteSha(ref);
    if (!current || isReleased(current, ref)) throw httpError(`Reference does not exist: ${ref}`);

    try {
      run("push", "--quiet", `--force-with-lease=${ref}:${current}`, "origin", `:${ref}`);
      return "";
    } catch (error) {
      const shortRef = ref.replace(/^refs\/heads\//, "");
      if (!isCoordinationRef(shortRef, prefixes ?? coordinationPrefixes())) {
        throw httpError(`${ref} could not be deleted (${describe(error)})`, 403);
      }
    }

    const marker = run(
      "commit-tree",
      run("rev-parse", `${current}^{tree}`),
      "-p",
      current,
      "-m",
      `${RELEASED_MARK} ${ref} at ${now().toISOString()}`,
    );
    try {
      run("push", "--quiet", `--force-with-lease=${ref}:${current}`, "origin", `${marker}:${ref}`);
    } catch (error) {
      throw httpError(`${ref} could not be released (${describe(error)})`, 409);
    }
    return "";
  }

  return null;
};

/** @param {unknown} error */
const describe = (error) => {
  const detail = /** @type {{ stderr?: unknown, message?: unknown }} */ (error ?? {});
  return String(detail.stderr || detail.message || error).trim().split("\n")[0];
};

// ---------------------------------------------------------------------------
// The seam
// ---------------------------------------------------------------------------

/** @type {((...args: string[]) => string) | null} */
let restTransport = null;

/**
 * The `gh` binary itself, with released coordination refs hidden from its
 * reads.
 *
 * @param {string[]} args
 */
const ghBinary = (...args) => {
  ensureGh();

  const { command, prefixArgs } = ghCommand();
  return execFileSync(command, [...prefixArgs, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
};

/**
 * Wraps a transport so released coordination refs read as absent through it,
 * whichever transport it is: a marker written by a cloud session must not
 * read as a live claim to a later `gh` session either.
 *
 * @param {(...args: string[]) => string} transport
 * @param {{ emulateGitData?: boolean }} [options]
 * @returns {(...args: string[]) => string}
 */
const withCoordination = (transport, { emulateGitData = false } = {}) => {
  const wrapped = (/** @type {string[]} */ ...args) => {
    if (emulateGitData) {
      if (args[0] === "--version") return "gh (rallypoint REST transport)";
      const emulated = emulateGitDataWrite(args);
      if (emulated !== null) return emulated;
    }
    const out = transport(...args);
    return hideReleased(args, out, transport);
  };
  return wrapped;
};

/** @param {string[]} args */
export const gh = (...args) => {
  if (restRequested()) {
    restTransport ??= withCoordination(restOnly(), { emulateGitData: true });
    return restTransport(...args);
  }
  return withCoordination(ghBinary)(...args);
};

/** @param {string[]} args */
export const git = (...args) =>
  execFileSync("git", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();

/**
 * Whether the `gh` binary is on `PATH`, asked once and before any request so a
 * missing prerequisite is reported by name rather than three calls into a
 * claim — the missing-prerequisite failure mode, extended to the transport
 * choice itself.
 */
const hasGh = () => {
  try {
    const { command, prefixArgs } = ghCommand();
    execFileSync(command, [...prefixArgs, "--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
};

/**
 * The transport Rallypoint scripts should use here, chosen by
 * `transportChoice`: `gh` when it is installed and usable, since it is the
 * reference implementation and carries its own auth; otherwise the REST
 * transport in `api.mjs`, which needs no binary at all — sessions without
 * `gh` were failing with `spawnSync gh ENOENT`, and cloud sessions, where
 * `gh` exists but GraphQL is blocked, with a 403 on the first
 * `gh issue|pr|repo` call.
 *
 * Not pre-flighted: a request GitHub refuses reports GitHub's own reason,
 * which is more useful than any guess this could make beforehand.
 *
 * @param {{ remote?: string }} [input]
 * @returns {(...args: string[]) => string}
 */
export const resolveTransport = ({ remote } = {}) => {
  const choice = transportChoice();
  if (choice.kind === "gh") return gh;
  if (choice.emulateGitData && remote === undefined) return gh;
  return withCoordination(restOnly({ remote }), { emulateGitData: choice.emulateGitData });
};

/**
 * The REST transport for this checkout's repository (or `remote`'s).
 *
 * @param {{ remote?: string }} [input]
 * @returns {(...args: string[]) => string}
 */
export const restOnly = ({ remote } = {}) => {
  const repository = repositoryFrom({
    remote:
      remote ??
      (() => {
        try {
          return execFileSync("git", ["config", "--get", "remote.origin.url"], {
            encoding: "utf8",
            stdio: ["ignore", "pipe", "ignore"],
          }).trim();
        } catch {
          return "";
        }
      })(),
  });

  if (!repository) {
    console.error(
      "No usable `gh` and no repository could be read from the git remote, " +
        "so there is no way to reach GitHub. Set GITHUB_REPOSITORY to " +
        "`owner/repo`, or run this from a checkout with an `origin` remote.",
    );
    process.exit(1);
  }

  return createTransport({ request: syncRequest(), repository });
};

// Resolved on call rather than at module scope. `import.meta.url` is not a
// `file:` URL under every loader — vitest's is not — so doing this at import
// time made this module unimportable from anything a test touches, which is
// the opposite of what the header above intends. Only `checkPullRequest` needs
// the path, and only when it actually runs.
const reviewScript = () =>
  fileURLToPath(new URL("../review.mjs", import.meta.url));

/**
 * Runs `review.mjs check --pr <n>` and reports its exit code, rather than
 * reimplementing the exit-code table it already owns. `review.mjs check` is
 * itself read-only — it only ever removes a stale `review:approved` label
 * under `--strip-stale`, which this call never passes — so this stays within
 * the report's own read-only contract.
 *
 * @param {number} pr
 * @returns {{ code: number | null, output: string }}
 */
export const checkPullRequest = (pr) => {
  try {
    const stdout = execFileSync(
      process.execPath,
      [reviewScript(), "check", "--pr", String(pr)],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    return { code: 0, output: stdout.trim() };
  } catch (error) {
    const detail = /** @type {{ status?: unknown, stderr?: unknown, stdout?: unknown, message?: unknown }} */ (
      error ?? {}
    );
    return {
      code: typeof detail.status === "number" ? detail.status : null,
      output: String(detail.stderr ?? detail.stdout ?? detail.message ?? "").trim(),
    };
  }
};

/**
 * Reads and validates `.rallypoint/config.json`. A malformed config is fatal
 * here rather than a confusing failure three `gh` calls later.
 */
export const loadConfig = () => {
  const config = JSON.parse(
    readFileSync(new URL("../../config.json", import.meta.url), "utf8"),
  );
  const result = validateConfig(config);

  if (!result.ok) {
    for (const problem of result.problems) {
      console.error(`.rallypoint/config.json: ${problem}`);
    }
    process.exit(1);
  }

  return config;
};
