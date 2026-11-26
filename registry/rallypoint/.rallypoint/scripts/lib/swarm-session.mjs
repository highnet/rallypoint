// Telling an open Rallypoint Swarm session what this script just took.
//
// ## Why this exists
//
// A swarm session records its role, target, issue and pull request in the
// swarm's memory (`swarm_sessions`), and the swarm UI's fleet and roles views
// read nothing else. `swarm next` writes those fields when a session picks
// its own role. A session a conductor dispatched for a known job skips
// `swarm next`, and `swarm prepare --role` records only what the conductor
// knew: a worker's issue is not known until `claim.mjs` picks it. So the
// claim, a verdict and a lease each tell the open session, through
// `swarm assign --if-open`.
//
// ## What this does not do
//
// It never opens a session, never changes an exit code and never throws.
// Without the swarm installed it does nothing at all; with the swarm
// installed but no session open, `--if-open` makes `swarm assign` a silent
// no-op. A failure (memory unreachable, no swarm secret) is one line on
// stderr: the GitHub-side work has already happened and is what counts.

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

export const SWARM_SCRIPT = ".rallypoint/swarm/swarm.mjs";

// The checkout these scripts were installed into (`.rallypoint/scripts/lib/`
// is three levels down), whatever directory they were run from.
const CHECKOUT = fileURLToPath(new URL("../../../", import.meta.url));

/**
 * The `swarm assign` arguments for what was taken, or null when there is
 * nothing to record.
 *
 * @param {{ role?: string | null, issue?: number | string | null, pr?: number | string | null }} work
 * @returns {string[] | null}
 */
export const swarmAssignArgs = ({ role = null, issue = null, pr = null } = {}) => {
  const args = [];
  if (role) args.push("--role", String(role));
  if (issue !== null && issue !== undefined && issue !== "") args.push("--issue", String(issue));
  if (pr !== null && pr !== undefined && pr !== "") args.push("--pr", String(pr));
  return args.length ? ["assign", ...args, "--if-open", "--json"] : null;
};

/**
 * Best-effort: record `work` on the open swarm session, if there is one.
 *
 * @param {{
 *   work: { role?: string | null, issue?: number | string | null, pr?: number | string | null },
 *   cwd?: string,
 *   stderr?: (line: string) => void,
 *   run?: typeof spawnSync,
 * }} input
 * @returns {"recorded" | "skipped" | "failed"}
 */
export const noteSwarmWork = ({ work, cwd = CHECKOUT, stderr = console.error, run = spawnSync }) => {
  const script = join(cwd, SWARM_SCRIPT);
  const args = swarmAssignArgs(work);
  if (!args || !existsSync(script)) return "skipped";
  try {
    const result = run(process.execPath, [script, ...args], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 30_000,
    });
    if (result.status === 0) {
      try {
        return JSON.parse(result.stdout || "{}").assigned ? "recorded" : "skipped";
      } catch {
        return "recorded";
      }
    }
    const reason = String(result.stderr || result.error?.message || `exit ${result.status}`).trim().split("\n")[0];
    stderr(`Swarm: could not record this on the open session (${reason}). The GitHub side is unaffected.`);
    return "failed";
  } catch (error) {
    stderr(`Swarm: could not record this on the open session (${error.message}). The GitHub side is unaffected.`);
    return "failed";
  }
};
