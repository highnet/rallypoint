// The real `gh` runner and the config load, kept out of the pure modules so no
// test can reach the live repository by importing one of them.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { createTransport } from "./api.mjs";
import {
  coordinationRefs,
  createGitDataEmulation,
  createReleasedFilter,
  gitDataRequest,
  isGitDataRefused,
} from "./git-data.mjs";
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
 * @param {Record<string, string | undefined>} [env]
 * @returns {{ command: string, prefixArgs: string[] }}
 */
const ghCommand = (env = process.env) => {
  const script = env[GH_SCRIPT_ENV];
  if (script) return { command: process.execPath, prefixArgs: [script] };
  return { command: "gh", prefixArgs: [] };
};

/**
 * Establishes that `gh` is runnable before the first call that needs it, so a
 * missing prerequisite is reported by name instead of arriving as an
 * `execFileSync` ENOENT several calls into a claim.
 */
export const ensureGh = ({ exit = true } = {}) => {
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
    // A caller that reports rather than exits — `swarm doctor` — gets the
    // same message as a throw.
    if (!exit) throw new Error(result.message);
    console.error(result.message);
    process.exit(EXIT_MISSING_PREREQUISITE);
  }

  ghAvailable = true;
};

/**
 * The `gh` binary itself, run in `cwd` (the Swarm runtime's `--cwd`).
 *
 * @param {{ cwd?: string }} [options]
 * @returns {(...args: string[]) => string}
 */
const binaryIn =
  ({ cwd, exit = true } = {}) =>
  (...args) => {
    ensureGh({ exit });

    const { command, prefixArgs } = ghCommand();
    return execFileSync(command, [...prefixArgs, ...args], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      // `swarm next` lists up to 500 issues with bodies.
      maxBuffer: 64 * 1024 * 1024,
    }).trim();
  };

/**
 * The `gh` binary, always — for the rare caller that needs `gh` itself rather
 * than whichever transport reaches GitHub here.
 */
export const ghBinary = binaryIn();

/** @param {string[]} args */
export const git = (...args) =>
  execFileSync("git", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();

/**
 * Whether the `gh` binary is runnable, asked once and before any request so a
 * missing prerequisite is reported by name rather than three calls into a
 * claim — the missing-prerequisite failure mode, extended to the transport
 * choice itself.
 *
 * @param {Record<string, string | undefined>} [env]
 */
const hasGh = (env = process.env) => {
  try {
    const { command, prefixArgs } = ghCommand(env);
    execFileSync(command, [...prefixArgs, "--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
};

/**
 * Whether this process runs inside a Claude Code cloud session. Those sessions
 * set `CLAUDE_CODE_REMOTE=true`, and their GitHub proxy refuses GraphQL — which
 * `gh pr …` and `gh issue …` are built on — while REST keeps working.
 *
 * @param {Record<string, string | undefined>} [env]
 */
export const isCloudSession = (env = process.env) =>
  ["1", "true"].includes(String(env.CLAUDE_CODE_REMOTE ?? "").trim().toLowerCase());

/**
 * Whether a failed `gh` call failed because GraphQL is blocked, rather than
 * for a reason that would fail over REST too. Matches the Claude Code proxy's
 * own words, and any `HTTP 403` from the GraphQL endpoint.
 *
 * @param {unknown} error
 */
export const isGraphqlBlocked = (error) => {
  const detail = /** @type {{ stderr?: unknown, stdout?: unknown, message?: unknown }} */ (
    error ?? {}
  );
  const text = [detail.stderr, detail.stdout, detail.message]
    .filter((part) => part !== undefined && part !== null)
    .map(String)
    .join("\n");

  return (
    /GraphQL is not available from Claude Code sessions/i.test(text) ||
    (/HTTP 403/.test(text) && /graphql/i.test(text))
  );
};

/** Lets an operator, or a test, pin the transport: `gh` or `rest`. */
const TRANSPORT_ENV = "RALLYPOINT_TRANSPORT";

/**
 * Which transport to start with, and why. Pure, so the decision is testable
 * without a `gh` on `PATH` or a cloud session around it.
 *
 * In order: an explicit `RALLYPOINT_TRANSPORT`; the `RALLYPOINT_GH_SCRIPT`
 * test seam (a fixture that opted in to a fake `gh` must get it, even when the
 * suite itself runs in a cloud session); REST when there is no `gh`; REST in a
 * Claude Code cloud session, where `gh` is installed but its GraphQL calls are
 * refused; otherwise `gh`, the reference implementation, which carries its own
 * auth.
 *
 * @param {{ env?: Record<string, string | undefined>, hasGh: () => boolean }} input
 * @returns {{ kind: "gh" | "rest", reason: string }}
 */
export const chooseTransport = ({ env = process.env, hasGh: probe }) => {
  const forced = String(env[TRANSPORT_ENV] ?? "").trim().toLowerCase();
  if (forced === "gh" || forced === "rest") {
    return { kind: forced, reason: `${TRANSPORT_ENV}=${forced}` };
  }
  if (forced !== "") {
    throw new Error(`${TRANSPORT_ENV} must be "gh" or "rest", not "${env[TRANSPORT_ENV]}"`);
  }

  if (env[GH_SCRIPT_ENV]) return { kind: "gh", reason: `${GH_SCRIPT_ENV} is set` };
  if (!probe()) return { kind: "rest", reason: "no `gh` on PATH" };
  if (isCloudSession(env)) {
    return {
      kind: "rest",
      reason: "Claude Code cloud session (CLAUDE_CODE_REMOTE), where GitHub GraphQL is blocked",
    };
  }
  return { kind: "gh", reason: "`gh` on PATH" };
};

/**
 * `primary`, switching to `fallback` for good the first time a call fails
 * because GraphQL is blocked — and retrying that call there. The retry is safe
 * for the commands that hit this: `gh` resolves its GraphQL lookup before any
 * mutation, so a refused call changed nothing. Every other failure is thrown
 * unchanged, which keeps claim atomicity intact.
 *
 * @param {{
 *   primary: (...args: string[]) => string,
 *   fallback: () => (...args: string[]) => string,
 *   onSwitch?: (error: unknown) => void,
 * }} input
 */
export const withGraphqlFallback = ({ primary, fallback, onSwitch }) => {
  /** @type {((...args: string[]) => string) | undefined} */
  let switched;

  /** @param {string[]} args */
  const transport = (...args) => {
    if (switched) return switched(...args);

    try {
      return primary(...args);
    } catch (error) {
      if (!isGraphqlBlocked(error)) throw error;
      onSwitch?.(error);
      switched = fallback();
      return switched(...args);
    }
  };

  transport.switched = () => switched !== undefined;
  return transport;
};

/**
 * `owner/repo` from the environment or this checkout's `origin`.
 *
 * @param {{ remote?: string, env?: Record<string, string | undefined>, cwd?: string }} input
 */
const repositoryHere = ({ remote, env, cwd }) =>
  repositoryFrom({
    env,
    remote:
      remote ??
      (() => {
        try {
          return execFileSync("git", ["config", "--get", "remote.origin.url"], {
            cwd,
            encoding: "utf8",
            stdio: ["ignore", "pipe", "ignore"],
          }).trim();
        } catch {
          return "";
        }
      })(),
  });

const NO_REPOSITORY =
  "There is no `gh` that can reach GitHub here and no repository could be read " +
  "from the git remote, so there is no way to reach GitHub. Set " +
  "GITHUB_REPOSITORY to `owner/repo`, or run this from a checkout with an " +
  "`origin` remote.";

/**
 * The transport Rallypoint scripts and the Swarm runtime use here.
 *
 * `gh` by default, since it is the reference implementation and carries its
 * own auth. The REST transport in `api.mjs` instead when `gh` is missing (cloud
 * agent sessions without one failed with `spawnSync gh ENOENT`), when this is a
 * Claude Code cloud session (where `gh` is installed but every `gh pr …` and
 * `gh issue …` fails with `HTTP 403: GitHub GraphQL is not available from
 * Claude Code sessions`), and — so an environment this does not recognise
 * recovers too — from the first `gh` call that fails with that 403.
 *
 * The returned function carries `describe()`: which transport is in use and
 * why, for `swarm doctor`.
 *
 * Not pre-flighted: a request GitHub refuses reports GitHub's own reason,
 * which is more useful than any guess this could make beforehand.
 *
 * @param {{
 *   remote?: string,
 *   env?: Record<string, string | undefined>,
 *   cwd?: string,
 *   exitOnMissingRepository?: boolean,   false: throw, rather than exit, for a
 *     missing repository or a missing `gh` — for a caller that reports.
 *   request?: Parameters<typeof createTransport>[0]["request"],
 *   binary?: (...args: string[]) => string,
 *   probe?: () => boolean,
 *   runGit?: (...args: string[]) => string,
 *   quiet?: boolean,
 *   showReleased?: boolean,
 * }} [input] `showReleased` keeps released markers visible, for
 *   `sweep-released.mjs`, which deletes them. `request`, `binary`, `probe` and `runGit` are test seams.
 * @returns {((...args: string[]) => string) & { describe: () => { kind: "gh" | "rest", reason: string, gitData: "api" | "push" } }}
 */
export const resolveTransport = ({
  remote,
  env = process.env,
  cwd,
  exitOnMissingRepository = true,
  request,
  binary,
  probe,
  runGit,
  quiet = false,
  showReleased = false,
} = {}) => {
  const choice = chooseTransport({ env, hasGh: probe ?? (() => hasGh(env)) });
  let current = choice;
  let emulating = chooseGitData({ env });

  const rest = () => {
    const repository = repositoryHere({ remote, env, cwd });

    if (!repository) {
      if (exitOnMissingRepository) {
        console.error(NO_REPOSITORY);
        process.exit(1);
      }
      throw new Error(NO_REPOSITORY);
    }

    return createTransport({
      request: request ?? syncRequest(),
      repository,
      readFile: (path) => readFileSync(cwd ? resolvePath(cwd, path) : path, "utf8"),
      // The Claude Code proxy serves auto-merge over REST; GitHub does not.
      autoMergeRoute: isCloudSession(env),
    });
  };

  /** @type {(...args: string[]) => string} */
  let transport;

  if (choice.kind === "rest") {
    /** @type {((...args: string[]) => string) | undefined} */
    let built;
    transport = (...args) => (built ??= rest())(...args);
  } else {
    transport = withGraphqlFallback({
      primary: binary ?? binaryIn({ cwd, exit: exitOnMissingRepository }),
      fallback: rest,
      onSwitch: () => {
        current = {
          kind: "rest",
          reason: "`gh` was refused with HTTP 403 because GitHub GraphQL is blocked here",
        };
        if (!quiet) {
          console.error(
            "rallypoint: `gh` cannot use GitHub GraphQL here (HTTP 403); " +
              "using the REST transport for the rest of this command.",
          );
        }
      },
    });
  }

  const base = transport;
  const isCoordinationRef = coordinationRefs(quietConfig());
  /** @type {ReturnType<typeof createGitDataEmulation> | undefined} */
  let emulation;
  const emulate = (/** @type {NonNullable<ReturnType<typeof gitDataRequest>>} */ call) =>
    (emulation ??= createGitDataEmulation({
      git:
        runGit ??
        ((...args) =>
          execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim()),
      isCoordinationRef,
    }))(call);
  const hideReleased = createReleasedFilter({ read: (...args) => base(...args), isCoordinationRef });

  /** @param {string[]} args */
  const withGitData = (...args) => {
    const call = gitDataRequest(args);

    if (call) {
      if (emulating) return emulate(call);
      try {
        return base(...args);
      } catch (error) {
        // Refused before it changed anything, so the emulated write is the
        // same write, not a second one.
        if (!isGitDataRefused(error)) throw error;
        emulating = true;
        if (!quiet) {
          console.error(
            "rallypoint: this session may not write GitHub's git-data API (HTTP 403); " +
              "writing refs with `git push` for the rest of this command.",
          );
        }
        return emulate(call);
      }
    }

    const out = base(...args);
    return showReleased ? out : hideReleased(args, out);
  };

  return Object.assign(withGitData, {
    describe: () => ({ ...current, gitData: emulating ? "push" : "api" }),
  });
};

/**
 * Whether git-data writes (refs, commits) go through `git push` from the
 * start rather than the API: in a Claude Code cloud session, whose proxy
 * refuses them — unless the `RALLYPOINT_GH_SCRIPT` test seam is set, for the
 * same reason it wins in `chooseTransport`. `RALLYPOINT_GIT_DATA=push|api`
 * pins it. Elsewhere the API is used, and the first refusal switches.
 *
 * @param {{ env?: Record<string, string | undefined> }} input
 */
export const chooseGitData = ({ env = process.env }) => {
  const forced = String(env.RALLYPOINT_GIT_DATA ?? "").trim().toLowerCase();
  if (forced === "push") return true;
  if (forced === "api") return false;
  if (forced !== "") throw new Error(`RALLYPOINT_GIT_DATA must be "push" or "api", not "${env.RALLYPOINT_GIT_DATA}"`);
  return isCloudSession(env) && !env[GH_SCRIPT_ENV];
};

/** The ref prefixes from `.rallypoint/config.json`, or the defaults when it cannot be read. */
const quietConfig = () => {
  try {
    return JSON.parse(readFileSync(new URL("../../config.json", import.meta.url), "utf8"));
  } catch {
    return {};
  }
};

/** @type {ReturnType<typeof resolveTransport> | undefined} */
let shared;

/**
 * The transport every script that imports `gh` uses: chosen on first call by
 * `resolveTransport()`, so `release-claim.mjs`, `report.mjs`, `lease.mjs` and
 * the rest reach GitHub the same way `claim.mjs` does, not through a `gh` that
 * cannot.
 *
 * @param {string[]} args
 */
export const gh = (...args) => (shared ??= resolveTransport())(...args);

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
