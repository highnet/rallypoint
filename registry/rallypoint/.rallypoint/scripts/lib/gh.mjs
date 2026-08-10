// The real `gh` runner and the config load, kept out of the pure modules so no
// test can reach the live repository by importing one of them.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { createTransport } from "./api.mjs";
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

/** @param {string[]} args */
export const gh = (...args) => {
  ensureGh();

  const { command, prefixArgs } = ghCommand();
  return execFileSync(command, [...prefixArgs, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
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
 * claim (#247's failure mode, extended to the transport choice itself).
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
 * The transport Rallypoint scripts should use here: `gh` when it is
 * installed, since it is the reference implementation and carries its own
 * auth; otherwise the REST transport in `api.mjs`, which needs no binary at
 * all — cloud agent sessions have none, and every coordination
 * command was failing with `spawnSync gh ENOENT`.
 *
 * Not pre-flighted: a request GitHub refuses reports GitHub's own reason,
 * which is more useful than any guess this could make beforehand.
 *
 * @param {{ remote?: string }} [input]
 * @returns {(...args: string[]) => string}
 */
export const resolveTransport = ({ remote } = {}) => {
  if (hasGh()) return gh;

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
      "No `gh` on PATH and no repository could be read from the git remote, " +
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
