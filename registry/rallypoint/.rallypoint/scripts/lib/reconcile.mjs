// Attaches a retroactive claim comment to an issue that already has an open
// pull request referencing it but no Rallypoint claim comment to identify its
// authoring session.
//
// `review.mjs record` refuses permanently when `workerAgent()` cannot resolve
// a claimant from the linked issue's comments, and until now nothing let
// anyone attach one after the fact. Pull requests hit this regularly: their pull
// requests were reviewed in full, but no claim comment existed to
// bind the verdict to, and the only way through was a human editing GitHub
// state by hand outside any documented process.
//
// This does not authenticate the id it posts. Every agent id in this loop is
// self-declared -- `review.mjs`'s header already states the self-review
// guard is bookkeeping, not authentication, and this command inherits that
// same limitation. What it does guard against is defaulting to the
// *reconciling* session's own id: `--agent-id` is mandatory, exactly like
// `claim.mjs`, so the caller must name whose session actually authored the
// branch rather than have the tool assume it was the one running right now.
//
// Two structural refusals keep this from being usable to fabricate a claim
// after the fact: it never overwrites an issue that already carries a claim
// comment, and it never guesses between several open pull requests that
// reference the same issue -- authorship would be ambiguous, so nothing is
// posted.
//
// `--pull <n>` is the other entry point. The caller of `--issue`
// already has to know the authoring issue number, which is exactly what is
// missing when a pull request was opened outside the claim flow with no
// `agent/<issue>-...` branch and a body that either has no closing keyword or
// one nobody has cross-checked yet. With
// `--pull`, the issue is resolved the same way `review.mjs record` and
// `preflight.mjs` resolve it: via `recordableIssue()`, reusing the identical
// branch/body signals rather than a second parser. Resolution failure is a
// third structural refusal, alongside the two above: a pull request whose
// branch and body disagree, or name several issues, or name none, is refused
// rather than guessed at.

import {
  branchIssue,
  claimant,
  linkedIssues,
  recordableIssue,
  referencingPullRequests,
  SAFE_AGENT_ID,
} from "../provenance.mjs";
import { openPullRequests } from "./release-claim.mjs";

// Exit codes are a public interface, matching the table in
// docs/AGENT_LOOP.md.
export const EXIT = {
  ok: 0,
  usage: 1,
  alreadyClaimed: 2, // the issue already carries a Rallypoint claim comment
  noReferencingPullRequest: 3, // no open pull request references the issue
  ambiguousPullRequests: 4, // more than one open pull request references it
  inconclusive: 5, // the open pull request listing could not be established
  pullRequestNotOpen: 6, // --pull named a pull request that is not open
  unresolvableIssue: 7, // --pull's branch/body do not resolve to one issue
};

const USAGE =
  "Usage: reconcile.mjs (--issue <n> | --pull <n>) --agent-id " +
  "<authoring-session-id> [--dry-run]";

/** @param {string[]} argv */
export const parseArgs = (argv) => {
  /** @param {string} flag */
  const values = (flag) =>
    argv.flatMap((value, index) =>
      value === flag && argv[index + 1] ? [argv[index + 1]] : [],
    );

  return {
    issue: values("--issue").at(0),
    pull: values("--pull").at(0),
    agentId: values("--agent-id").at(0),
    dryRun: argv.includes("--dry-run"),
  };
};

/** @param {unknown} error */
const describeError = (error) =>
  error instanceof Error ? error.message : String(error);

/**
 * Resolves `--pull <n>` to an issue number by reading the pull request itself
 * and running the same `recordableIssue()` rule `record` and `preflight` use
 * -- never a second parser. Returns the issue on success, or the exit code
 * and message to refuse with.
 *
 * @param {{
 *   pull: string,
 *   config: { branchPrefix: string },
 *   gh: (...args: string[]) => string,
 * }} input
 * @returns {{ ok: true, issue: string } | { ok: false, code: number, message: string }}
 */
export const resolveIssueFromPull = ({ pull, config, gh }) => {
  /** @type {{ number: number, headRefName: string, body: string | null, state: string }} */
  let view;

  try {
    view = JSON.parse(
      gh("pr", "view", pull, "--json", "number,headRefName,body,state"),
    );
  } catch (error) {
    return {
      ok: false,
      code: EXIT.inconclusive,
      message: `Pull request #${pull} could not be read (${describeError(error)}).`,
    };
  }

  if (view.state !== "OPEN") {
    return {
      ok: false,
      code: EXIT.pullRequestNotOpen,
      message:
        `Pull request #${pull} is ${view.state.toLowerCase()}, not open; ` +
        "reconcile only an open pull request.",
    };
  }

  const linked = linkedIssues(view.body);
  const branch = branchIssue(view.headRefName, config.branchPrefix);
  const recordable = recordableIssue({ linkedIssues: linked, branchIssue: branch });

  if (!recordable.ok) {
    const message = {
      "ambiguous-body":
        `Pull request #${pull}'s body links several issues ` +
        `(${linked.map((issue) => `#${issue}`).join(", ")}); authorship is ` +
        "ambiguous, so nothing was resolved.",
      mismatch:
        `Pull request #${pull}'s branch \`${view.headRefName}\` names issue ` +
        `#${branch}, but its body links #${linked[0]}. Reconcile a mismatch ` +
        "between the two by hand rather than picking one.",
      unidentifiable:
        `Pull request #${pull}'s branch \`${view.headRefName}\` does not ` +
        `name a claimed issue (expected \`${config.branchPrefix}<issue>-...\`), ` +
        "and its body has no `Closes`/`Fixes`/`Resolves #<issue>` reference " +
        "either, so there is nothing to reconcile against.",
    }[recordable.reason];

    return { ok: false, code: EXIT.unresolvableIssue, message };
  }

  return { ok: true, issue: recordable.issue };
};

// Which open pull requests reference the given issue. The predicate itself
// lives in `provenance.mjs` alongside the two signals it reads, so a pull
// request this command can reconcile is one `record` would actually recognise
// afterward and one `claim.mjs` would already have refused to hand out.
// Re-exported here because it has always been part of this module's interface.
export { referencingPullRequests };

/**
 * @param {{
 *   agentId: string,
 *   issue: string,
 *   pull: { number: number },
 * }} input
 */
export const claimComment = ({ agentId, issue, pull }) =>
  [
    `Claimed by Rallypoint agent \`${agentId}\`.`,
    "",
    "**Retroactive/backfilled claim.** This comment was posted by " +
      "`reconcile.mjs` after the fact, not before implementation, because " +
      `pull request #${pull.number} was already open against #${issue} with ` +
      "no prior Rallypoint claim comment to identify its authoring session. " +
      "It exists solely so `review.mjs record` can identify that session and " +
      `bind a verdict to #${pull.number}'s current head SHA.`,
  ].join("\n");

/**
 * @param {{
 *   argv: string[],
 *   config: { branchPrefix: string },
 *   gh: (...args: string[]) => string,
 *   stdout?: (line: string) => void,
 *   stderr?: (line: string) => void,
 * }} input
 * @returns {number} Process exit code.
 */
export const reconcile = ({
  argv,
  config,
  gh,
  stdout = console.log,
  stderr = console.error,
}) => {
  const { issue: issueArg, pull: pullArg, agentId, dryRun } = parseArgs(argv);

  if (issueArg && pullArg) {
    stderr(`${USAGE}\n--issue and --pull are mutually exclusive; pass one.`);
    return EXIT.usage;
  }

  if ((!issueArg && !pullArg) || !agentId) {
    stderr(USAGE);
    return EXIT.usage;
  }

  if (issueArg && !/^\d+$/.test(issueArg)) {
    stderr(USAGE);
    return EXIT.usage;
  }

  if (pullArg && !/^\d+$/.test(pullArg)) {
    stderr(USAGE);
    return EXIT.usage;
  }

  // The id lands in a comment `review.mjs` reads back, so hold it to the same
  // shape `claim.mjs` and `review.mjs` require.
  if (!SAFE_AGENT_ID.test(agentId)) {
    stderr(
      `Agent id "${agentId}" must match ${SAFE_AGENT_ID}: letters, digits, ` +
        "dot, underscore, and hyphen only.",
    );
    return EXIT.usage;
  }

  // `issueArg` is validated non-empty and numeric above whenever `pullArg` is
  // not given, but that validation happened in separate `if` statements, which
  // checkJs does not carry forward as a narrowing of `issueArg`'s type here.
  // Route both selectors through the same `{ ok, issue } | { ok, code,
  // message }` shape instead of assigning a possibly-`undefined` value, so the
  // rest of this function reads `issue` as the plain `string` it always is by
  // this point.
  const resolved = pullArg
    ? resolveIssueFromPull({ pull: pullArg, config, gh })
    : { ok: /** @type {const} */ (true), issue: /** @type {string} */ (issueArg) };

  if (!resolved.ok) {
    stderr(resolved.message);
    return resolved.code;
  }

  const issue = resolved.issue;

  const { comments } = JSON.parse(
    gh("issue", "view", issue, "--json", "comments"),
  );

  if (claimant(comments)) {
    stderr(
      `Issue #${issue} already carries a Rallypoint claim comment; refusing ` +
        "to post a conflicting one. This command never overwrites or " +
        "duplicates an existing claim -- resolve a wrong one by hand.",
    );
    return EXIT.alreadyClaimed;
  }

  const pullRequests = openPullRequests(gh);

  if (!pullRequests.ok) {
    stderr(
      `Refusing to reconcile #${issue}: ${pullRequests.reason}. A lookup ` +
        "that could not be established is not evidence that exactly one " +
        "pull request references this issue.",
    );
    return EXIT.inconclusive;
  }

  const matches = referencingPullRequests({
    pulls: pullRequests.items,
    issue,
    branchPrefix: config.branchPrefix,
  });

  if (matches.length === 0) {
    stderr(
      `No open pull request references issue #${issue}; nothing to reconcile.`,
    );
    return EXIT.noReferencingPullRequest;
  }

  if (matches.length > 1) {
    stderr(
      `#${matches.map((pull) => `${pull.number}`).join(", #")} all ` +
        `reference issue #${issue}; authorship is ambiguous, so nothing was ` +
        "posted. Reconcile only once a single open pull request remains.",
    );
    return EXIT.ambiguousPullRequests;
  }

  const [pull] = matches;
  const body = claimComment({ agentId, issue, pull });

  if (dryRun) {
    stdout(body);
    stdout("\n(dry run: nothing was posted)");
    return EXIT.ok;
  }

  gh("issue", "comment", issue, "--body", body);
  stdout(`Reconciled issue #${issue} against #${pull.number} for agent \`${agentId}\`.`);
  return EXIT.ok;
};

export default reconcile;
