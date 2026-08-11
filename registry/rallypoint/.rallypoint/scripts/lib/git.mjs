// The real `git` runner, kept out of the pure modules so no test can reach
// the actual repository by importing one of them. Mirrors `gh.mjs`'s shape:
// a thin wrapper the pure decision logic receives as a parameter, so a test
// can inject a real `git` pointed at a throwaway fixture repository, or a
// fake one, without either module knowing which it got.

import { execFileSync } from "node:child_process";

// A git hook (this repository's own `pre-push` included) runs with `GIT_DIR`,
// `GIT_WORK_TREE`, and related `GIT_*` variables pointed at the repository
// invoking it. Those leak into every child process by default, so a `git`
// call this module makes against an unrelated directory — a carry-forward
// comparison's own checkout, or a test fixture — would silently operate on
// the invoking repository instead, or fail outright with "this operation
// must be run in a work tree". Stripped here rather than left to each call
// site to remember.
const GIT_ENV_PREFIX = "GIT_";

const sanitisedEnv = () => {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith(GIT_ENV_PREFIX)) delete env[key];
  }
  return env;
};

/**
 * @param {string[]} args
 * @param {{ input?: string, cwd?: string }} [options]
 */
export const git = (args, { input, cwd } = {}) =>
  execFileSync("git", args, {
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    cwd,
    input,
    env: sanitisedEnv(),
  }).trim();
