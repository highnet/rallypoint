// Reservation release, with every call to `gh` injected.
//
// The refusal below is the whole point: deleting a reservation for an issue that
// is still open re-opens it to a second claimant while the first is still
// working, which is precisely the collision the reservation exists to prevent.

import { reservationPresence } from "./release-claim.mjs";

// Exit codes are a public interface, as they are for `release-claim.mjs` and
// `review.mjs`. Keep them in sync with the table in docs/AGENT_LOOP.md.
export const EXIT = {
  ok: 0,
  usage: 1,
  notClosed: 2,
  inconclusive: 3, // presence could not be established; no delete attempted
  deleteFailed: 4, // ref was confirmed present but the delete failed
};

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

/** @param {string[]} argv */
export const parseArgs = (argv) => {
  const index = argv.indexOf("--issue");
  return { issue: index === -1 ? undefined : argv[index + 1] };
};

/**
 * @param {{
 *   argv: string[],
 *   config: { claimRefPrefix: string },
 *   gh: (...args: string[]) => string,
 *   stdout?: (line: string) => void,
 *   stderr?: (line: string) => void,
 * }} input
 * @returns {number} Process exit code.
 */
export const cleanup = ({
  argv,
  config,
  gh,
  stdout = console.log,
  stderr = console.error,
}) => {
  const { issue } = parseArgs(argv);

  if (!issue) {
    stderr("Usage: cleanup.mjs --issue <closed-issue-number>");
    return EXIT.usage;
  }

  const repository = JSON.parse(
    gh("repo", "view", "--json", "nameWithOwner"),
  ).nameWithOwner;
  const { state } = JSON.parse(gh("issue", "view", issue, "--json", "state"));

  if (state !== "CLOSED") {
    stderr(
      `Issue #${issue} is ${state.toLowerCase()}; reservation preserved.`,
    );
    return EXIT.notClosed;
  }

  const refName = `${config.claimRefPrefix}${issue}`;
  const refPath = `refs/heads/${refName}`;

  // Presence is established by listing, never inferred from a delete's
  // failure — a branch-scoped credential answers 403 whether or not the ref
  // is there, and an already-absent ref is a success, not a crash.
  // `release-claim.mjs` already solves this; reuse it rather than growing a
  // second presence check.
  const presence = reservationPresence(gh, repository, refName);

  if (presence.kind === "unknown") {
    stderr(
      `Whether \`${refPath}\` exists could not be established (${presence.reason}). No delete was attempted.`,
    );
    return EXIT.inconclusive;
  }

  if (presence.kind === "absent") {
    stdout(`No reservation for closed issue #${issue}; already clean.`);
    return EXIT.ok;
  }

  try {
    gh("api", "--method", "DELETE", `repos/${repository}/git/${refPath}`);
  } catch (error) {
    stderr(
      `\`${refPath}\` could not be deleted (${describeError(error)}).`,
    );
    return EXIT.deleteFailed;
  }

  stdout(`Removed reservation for closed issue #${issue}.`);
  return EXIT.ok;
};

export default cleanup;
