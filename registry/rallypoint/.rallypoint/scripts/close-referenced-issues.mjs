#!/usr/bin/env node

// Closes the issues a merged pull request references, and removes their claim
// reservations.
//
// `Closes #N` fires natively on merge **only when the pull request targets the
// repository's default branch**. Where the configured `integrationBranch` is
// also the default branch, GitHub closes the issue itself. Where it is not — a
// repository whose agents merge into a `develop` or `staging` tier that
// promotes into `main` later — the keyword never fires on the merge that
// actually shipped the work, and issues stay open indefinitely with nobody
// noticing.
//
// This script runs in both topologies, because closing the issue was only ever
// half of what it does. It also removes the matching
// `rallypoint-claims/issue-<N>` reservation ref, which native closing does not
// touch, and nothing else deletes that ref for an issue that closes this way.
// Its own `issueSnapshot()` check (below) already treats an issue GitHub closed
// natively as a no-op rather than a redundant close: it never calls
// `gh issue close` a second time, it only reports the state and moves straight
// to removing the reservation. So the "does this error on an already-closed
// issue" question the script's purpose depends on is answered by that branch,
// not by GitHub tolerating a second close.
//
// The reservation-cleanup role matters more than tidiness on its own. The issue
// queue is the coordination mechanism: `claim.mjs` draws from every open issue
// no hold label covers,
// the orchestrator sizes sessions from the `status:claimed` count, and the
// janitor's stale-claim logic reads reservation refs. An issue whose work has
// shipped but which still carries a live reservation is unclaimable by anyone
// else even after GitHub closes it, and the failure is silent, which is exactly
// what remembering-to-do-it-by-hand does not catch.
//
// The reservation and the `status:claimed` label are two halves of one claim,
// and this script used to remove only the first. `release-claim.mjs` treats
// them as a pair, and leaving the label behind states something untrue: a
// closed issue is not claimed. That residue did not distort any coordination
// count — `report.mjs` lists `status:claimed` issues with `--state open`, so a
// closed issue never reached the orchestrator's count or its `unprotected`
// check, and `gh issue list` defaults to open too — but it did make label-based
// queries and human reads of the board misleading. Correctness and
// tidiness, then, rather than a fix for a miscount. Both halves go in the same
// pass now.
//
// "Which issues did this merge close" is read from the pull request body AND
// the merged commit's own message, not the body alone. A worker writing
// `Refs #<issue>` in the body to keep an issue open as a disclosed partial
// delivery can still end its squash commit's message with `Closes #<issue>` —
// and GitHub's native closing scans commit messages landing on the default
// branch, not just the pull request body, so it closes the issue anyway. A
// script reading only the body finds nothing to act on and leaves
// `status:claimed` and the reservation behind. See `planClosures`'s doc comment
// for the fix.
//
// An empty lookup is no longer a normal outcome by default. Queried too soon
// after a merge, GitHub does not yet report the pull request as merged, so this
// script resolves nothing at all, logs "No merged pull request at <sha>
// references an issue." and exits 0 — while the reservation ref and
// `status:claimed` both survive. A green run is what nobody re-checks, so the
// failure mode was to corrupt coordination state with every signal saying it
// had succeeded.
// `classifyEmptyLookup` and `unresolvedLookupMessage` below separate the
// legitimate empty case from that one; the merger's habit of verifying cleanup
// rather than trusting the green run is what caught it, and still owes the check
// this guard does not replace.

import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { sweepClearedBlockers } from "./lib/blocked-by.mjs";
import { gh } from "./lib/gh.mjs";
import { lastClaim } from "./lib/release-claim.mjs";
import { branchIssue, linkedIssues } from "./provenance.mjs";

// Read on demand rather than at module scope: the pure decision below is
// imported by tests that have no repository checkout to read a config from.
const loadConfig = () =>
  JSON.parse(readFileSync(new URL("../config.json", import.meta.url), "utf8"));

/** @param {...string} command */
const run = (...command) => {
  // Only `gh` is a prerequisite the repository cannot vendor; `git` is already
  // present wherever this runs. Routed through `lib/gh.mjs`'s `gh` rather than
  // spawned here so this script honours the `RALLYPOINT_GH_SCRIPT` seam
  // the other Rallypoint scripts already use — which is what lets the
  // end-to-end exit-code test below drive it without a real `gh` on `PATH`.
  if (command[0] === "gh") return gh(...command.slice(1));

  return execFileSync(command[0], command.slice(1), {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
};

/**
 * Whether a pull request reported for a pushed commit actually shipped it into
 * the integration branch, as opposed to merely containing it.
 *
 * A type predicate rather than a plain boolean so both callers keep the
 * narrowing on `merged_at` that the check establishes.
 *
 * @template {{ merged_at?: string | null, base?: { ref?: string } }} T
 * @param {T} pullRequest
 * @param {string} integrationBranch
 * @returns {pullRequest is T & { merged_at: string }}
 */
const shipped = (pullRequest, integrationBranch) =>
  pullRequest.merged_at !== undefined &&
  pullRequest.merged_at !== null &&
  pullRequest.base?.ref === integrationBranch;

/**
 * The decision, separated from every call to `gh` so it is testable without a
 * live GitHub.
 *
 * `commitMessage` is read alongside `pullRequest.body` because GitHub does the
 * same: its native closing scans the message of the commit landing on the
 * default branch, not only the pull request body. The case that exposes the gap
 * is a pull request whose body deliberately says `Refs #<issue>` to keep the
 * issue open as a disclosed partial delivery, while the squash commit's own
 * message still ends in `Closes #<issue>` — GitHub closes the issue natively,
 * and a script reading only the body sees no closure to act on and leaves the
 * `status:claimed` label and reservation behind. Since
 * `sha` here is always the commit that actually landed (`github.sha` on push,
 * or an operator-supplied SHA on `workflow_dispatch`), its message is exactly
 * what GitHub itself consulted.
 *
 * @param {{
 *   pullRequests: { number: number, body?: string, merged_at?: string | null, base?: { ref?: string } }[],
 *   integrationBranch: string,
 *   commitMessage?: string | null,
 * }} input Pull requests GitHub reports for the pushed commit.
 * @returns {{ pullRequest: number, mergedAt: string, issues: string[] }[]}
 */
export const planClosures = ({
  pullRequests,
  integrationBranch,
  commitMessage,
}) =>
  pullRequests.flatMap((pullRequest) => {
    // A commit is reported for every pull request that contains it, which
    // includes ones still open and ones targeting another branch. Only a merged
    // pull request into the integration branch actually shipped it.
    if (!shipped(pullRequest, integrationBranch)) return [];

    const issues = [
      ...new Set([
        ...linkedIssues(pullRequest.body),
        ...linkedIssues(commitMessage),
      ]),
    ];
    return issues.length === 0
      ? []
      : [
          {
            pullRequest: pullRequest.number,
            mergedAt: pullRequest.merged_at,
            issues,
          },
        ];
  });

/**
 * Merged pull requests that shipped an issue's work without closing it.
 *
 * A worker may ship code for an issue that is not thereby finished — a pull
 * request carrying a "Why `Refs`, not `Closes`" section because the issue's
 * primary defect needs an owner to provision something no diff can do. That is
 * legitimate and recurring, and it used to have **no** exit from
 * `status:claimed` at all: the only ways out of a claim were a closing keyword
 * or a janitor timeout, and this shape has neither. The issue
 * stayed claimed, assigned, and reserved after its session ended, which makes
 * it unclaimable by anyone and distorts the orchestrator's session sizing —
 * exactly the failure this file's header already argues against for the closed
 * case.
 *
 * Authorship comes from the **branch name**, not the body. `provenance.mjs`
 * already calls that the stronger signal because a body can be edited after
 * the fact, and here it is stronger for a second reason: `claim.mjs` derives
 * the branch name from the claim itself, so `agent/<N>-…` and the reservation
 * on `<N>` are two halves of one act. Reading the body instead would have
 * needed a looser `Refs`-style keyword, and widening the shared `linkedIssues`
 * predicate would silently change `review.mjs`, `report.mjs`, `reconcile.mjs`,
 * and `claim.mjs`'s open-pull-request filter along with it.
 *
 * A pull request whose body *does* close the issue is deliberately excluded:
 * `planClosures` above already handles it, and both acting on it would race.
 * The same exclusion applies to a body that leaves it open while the commit
 * message closes it anyway — `planClosures`'s `commitMessage` reading already
 * owns that case, for the reason documented there.
 *
 * @param {{
 *   pullRequests: { number: number, body?: string, merged_at?: string | null, base?: { ref?: string }, head?: { ref?: string } }[],
 *   integrationBranch: string,
 *   branchPrefix: string,
 *   commitMessage?: string | null,
 * }} input
 * @returns {{ pullRequest: number, issue: string, mergedAt: string }[]}
 */
export const planClaimReleases = ({
  pullRequests,
  integrationBranch,
  branchPrefix,
  commitMessage,
}) =>
  pullRequests.flatMap((pullRequest) => {
    if (!shipped(pullRequest, integrationBranch)) return [];

    const issue = branchIssue(pullRequest.head?.ref, branchPrefix);

    if (
      issue === null ||
      linkedIssues(pullRequest.body).includes(issue) ||
      linkedIssues(commitMessage).includes(issue)
    ) {
      return [];
    }

    return [
      {
        pullRequest: pullRequest.number,
        issue,
        mergedAt: pullRequest.merged_at,
      },
    ];
  });

/**
 * Whether the claim currently on an issue is the one a given merge ended.
 *
 * The closing path above is idempotent for free: it leaves the issue `CLOSED`,
 * so a second run recognises that and does nothing. This path deliberately
 * leaves the issue **open** and hands it back to the queue, which means a
 * re-run has something to act on — and re-running against an older merge SHA is
 * documented and supported. On an issue that has since been re-claimed, acting
 * again would delete the *new* session's reservation and flip its issue to
 * claimable while it is being worked. That is the collision the
 * reservation exists to prevent.
 *
 * The claim comment's timestamp is the guard. A claim made after the merge
 * belongs to a later session, and this merge has no business releasing it.
 * A claim that cannot be read or dated is not treated as absent — nothing is
 * released, matching `release-claim.mjs`'s rule for the same question.
 *
 * @param {{
 *   claim: { agent: string, createdAt: string } | null,
 *   mergedAt: string,
 * }} input
 * @returns {{ ended: true } | { ended: false, reason: string }}
 */
export const claimEndedByMerge = ({ claim, mergedAt }) => {
  if (!claim) {
    return {
      ended: false,
      reason: "it carries no Rallypoint claim comment, so no claim can be dated",
    };
  }

  const claimedAt = Date.parse(claim.createdAt);
  const merged = Date.parse(mergedAt);

  if (Number.isNaN(claimedAt) || Number.isNaN(merged)) {
    return {
      ended: false,
      reason: `the claim by \`${claim.agent}\` could not be dated against the merge`,
    };
  }

  return claimedAt > merged
    ? {
        ended: false,
        reason: `it was re-claimed by \`${claim.agent}\` at ${claim.createdAt}, after this merge, so the live claim belongs to a later session`,
      }
    : { ended: true };
};

/**
 * Ends the claim on an issue whose work has shipped but which is not finished.
 * The issue stays open, and whether it is claimable afterwards follows from its
 * own labels rather than from anything written here.
 *
 * That was not always so, and the reason it matters is worth recording.
 * Restoring a readiness label
 * used to be unconditional, gated only on whether the label was already there:
 * a worker who finds the remaining work needs an owner decision moves the issue
 * to `status:blocked` and `needs:human` — the sanctioned move, per
 * `docs/AGENT_LOOP.md`'s "Coordination state" — and then ships whatever part it
 * could with `Refs #N`. That merge arrives here, and handing the issue back to
 * the queue overwrites the very judgement the session was left to record. An
 * issue can go round that loop repeatedly before anyone notices, each pass
 * costing a fresh worker a full session to re-derive "this needs a human".
 *
 * Ending the claim and restoring the queue entry are therefore separated. The
 * session genuinely ended, so `status:claimed` and the assignee go in every
 * case; only the wording of the comment differs, and only when the issue
 * carries a label that says an agent cannot pick it up. This matches what
 * `release-claim.mjs` already does for an orphaned reservation on a blocked
 * issue: release the claim, change nothing that states the issue is available.
 *
 * Clearing the assignee still matters on a held issue even though nothing will
 * claim it: `lib/claim.mjs` filters out every assigned issue, so leaving the
 * assignee behind would silently suppress the claim later, after an owner has
 * cleared the block.
 *
 * Since the readiness label was removed, this is **purely subtractive** — it removes `status:claimed` and
 * the assignees and adds nothing. Claimability is derived from the absence of a
 * hold label, so an issue is back in the pool the moment the claim comes off,
 * and there is no second write that could fail and leave it claimable by
 * nobody. The old `status:ready` restoration, its `alreadyQueued` incoherence
 * report, and the whole class of `status:ready`-beside-a-hold-label defect went
 * with it: that state can no longer be represented.
 *
 * `queueable: false` says the issue is closed, which no longer changes what is
 * *written* — a closed issue is outside the pool by being closed. It still
 * changes what the comment claims, because every sentence about the issue being
 * claimable again would be false. The claim half runs unchanged; only the
 * wording differs.
 *
 * @param {{
 *   issue: string,
 *   labels: unknown,
 *   assignees: unknown,
 *   claimedLabel: string,
 *   holdLabels?: string[],
 *   queueable?: boolean,
 *   execute?: (...command: string[]) => string,
 * }} input
 * @returns {{ changed: boolean, queued: boolean, held: string[] }}
 *   Whether anything was changed, whether the issue is claimable now, and the
 *   hold labels found on it.
 *
 *   `queued` is **derived and reported, never acted on**. Nothing in this
 *   module branches on it: `releaseShippedClaim` decides from `changed` and
 *   `held`, and `claimReleaseComment` from `held` and `closed`. It was a
 *   decision before the readiness label was removed — it said whether `status:ready` had just been added
 *   — and is now only a restatement of `queueable && held.length === 0`, kept
 *   because it is the one place the answer "is this issue claimable now?" is
 *   named in this module's vocabulary rather than re-derived by a caller. Do
 *   not reintroduce a branch on it without checking `held` and `closed` say
 *   the same thing, or the comment and the log will disagree.
 */
export const restoreToQueue = ({
  issue,
  labels,
  assignees,
  claimedLabel,
  holdLabels = [],
  queueable = true,
  execute = run,
}) => {
  // Presence is decided from what was read, never inferred from a removal's
  // own failure. A payload that is not an array is not an empty one.
  if (!Array.isArray(labels) || !Array.isArray(assignees)) {
    throw new Error(
      `Could not establish the labels and assignees on #${issue}; refusing to guess.`,
    );
  }

  const names = labels.flatMap((label) =>
    typeof label?.name === "string" ? [label.name] : [],
  );
  const claimed = names.includes(claimedLabel);
  // Order by the configured list rather than by label order on the issue, so the
  // comment below reads the same way every time.
  const held = holdLabels.filter((label) => names.includes(label));
  const logins = assignees.flatMap((assignee) =>
    typeof assignee?.login === "string" ? [assignee.login] : [],
  );

  // Whether the issue is claimable once this run finishes. Derived, not
  // written: nothing below adds a label.
  const queued = queueable && held.length === 0;

  if (!claimed && logins.length === 0) {
    return { changed: false, queued, held };
  }

  /** @type {string[]} */
  const args = ["issue", "edit", issue];

  if (claimed) args.push("--remove-label", claimedLabel);
  for (const login of logins) args.push("--remove-assignee", login);

  execute("gh", ...args);
  return { changed: true, queued, held };
};

/**
 * The per-issue decision, separated from the `gh` calls that produce its
 * inputs so it is testable without a live GitHub.
 *
 * `state` already answers the question this script's purpose depends on: is
 * closing this issue a redundant call GitHub might reject, or a no-op this
 * script can recognize on its own? An issue GitHub already closed natively —
 * the ordinary case now that `release` is both the default and integration
 * branch — resolves to `"already-closed"` here and `main` never calls
 * `gh issue close` for it at all, so there is nothing for GitHub to tolerate
 * or reject.
 *
 * @param {{ state: string, wasReopened: boolean }} input
 * @returns {"already-closed" | "reopened" | "close"}
 */
export const resolveIssueAction = ({ state, wasReopened }) => {
  if (state === "CLOSED") return "already-closed";
  if (wasReopened) return "reopened";
  return "close";
};

/**
 * @param {{
 *   events: { event?: string, created_at?: string }[],
 *   mergedAt: string,
 * }} input Issue events and the merge that would close it.
 * @returns {boolean}
 */
export const wasReopenedAfterMerge = ({ events, mergedAt }) =>
  events.some(
    (event) =>
      event.event === "reopened" &&
      event.created_at !== undefined &&
      // GitHub timestamps have second precision. Treat an equal timestamp
      // conservatively because their order within that second is unknowable.
      Date.parse(event.created_at) >= Date.parse(mergedAt),
  );

/**
 * How many times the pull-request lookup is attempted before an empty result is
 * believed, and how long to wait between attempts.
 *
 * Three attempts, waiting 2s then 4s — a ceiling of six seconds added, and only
 * on the path where the answer is already suspicious (see `classifyEmptyLookup`
 * for the gate). The ceiling is deliberately short because this workflow runs on
 * **every** push to the integration branch: a long retry loop on a commit that
 * legitimately has no pull request would be its own problem, and replication lag
 * of this kind resolves in well under a second when it
 * resolves at all. Retrying cannot close the window — any query can race
 * replication — so the exit path below, not this loop, is the actual guard. The
 * loop only keeps the guard from crying wolf over the common transient.
 */
export const UNRESOLVED_LOOKUP_ATTEMPTS = 3;

/** @type {readonly number[]} Waits between attempts; one shorter than the above. */
export const UNRESOLVED_LOOKUP_BACKOFF_MS = Object.freeze([2000, 4000]);

/**
 * The pull-request lookup, retried while it comes back empty for a merge commit.
 *
 * The gate is `isMergeCommit`, so an ordinary pull-request-less push to the
 * integration branch resolves on the first attempt and waits for nothing at all
 * — which is what keeps this off the common path of a workflow that runs on
 * every push.
 *
 * @template T
 * @param {{
 *   lookup: () => T[],
 *   isMergeCommit: boolean,
 *   ceiling?: number,
 *   backoff?: readonly number[],
 *   wait?: (ms: number) => void,
 * }} input
 * @returns {{ pullRequests: T[], attempts: number }}
 */
export const lookupWithRetries = ({
  lookup,
  isMergeCommit,
  ceiling = UNRESOLVED_LOOKUP_ATTEMPTS,
  backoff = UNRESOLVED_LOOKUP_BACKOFF_MS,
  wait = sleep,
}) => {
  let pullRequests = lookup();
  let attempts = 1;

  while (pullRequests.length === 0 && isMergeCommit && attempts < ceiling) {
    // The last configured wait repeats if the ceiling is ever raised past the
    // backoff list, rather than sleeping `undefined` milliseconds.
    wait(backoff[attempts - 1] ?? backoff.at(-1) ?? 0);
    pullRequests = lookup();
    attempts += 1;
  }

  return { pullRequests, attempts };
};

/**
 * Whether an empty pull-request lookup is a normal outcome or a failure.
 *
 * Two situations used to be conflated, at a real cost. A commit that
 * resolves a pull request carrying no closing keywords legitimately has nothing
 * to do — the common case for a direct push, or a merge that closes nothing —
 * and should exit 0 quietly. A **merge commit on the integration branch** that
 * resolves *no pull request at all* is different: the repository ruleset
 * requires every commit on `release`, `staging`, and `main` to land via a pull
 * request, so an empty answer there contradicts a platform control. It is either
 * replication lag or a genuine bug, and in both cases it means this run did no
 * cleanup while reporting success.
 *
 * That is strictly worse than a red run. `claim.mjs` draws from the unheld open
 * issues,
 * the orchestrator sizes sessions from `status:claimed`, and the janitor reads
 * reservation refs — all three read state this workflow is responsible for
 * clearing, and a green run is exactly what nobody re-checks.
 *
 * The merge-commit test is `parentCount`, not the commit message: a squash merge
 * onto the integration branch has one parent and is indistinguishable from a
 * direct push, so requiring two parents keeps ordinary pushes quiet, which is
 * what stops this guard from being tuned out.
 *
 * @param {{
 *   pullRequests: unknown[],
 *   parentCount: number,
 *   onIntegrationBranch: boolean,
 * }} input
 * @returns {"quiet" | "unresolved"}
 */
export const classifyEmptyLookup = ({
  pullRequests,
  parentCount,
  onIntegrationBranch,
}) =>
  pullRequests.length === 0 && parentCount >= 2 && onIntegrationBranch
    ? "unresolved"
    : "quiet";

/**
 * What the run says when it resolved no pull request for a merge commit on the
 * integration branch.
 *
 * It names the SHA and the exact command that finishes the job by hand, because
 * the first merger to catch this had to work that out unaided.
 *
 * @param {{ sha: string, integrationBranch: string, attempts: number }} input
 * @returns {string}
 */
export const unresolvedLookupMessage = ({
  sha,
  integrationBranch,
  attempts,
}) =>
  [
    `Resolved no pull request for ${sha} after ${attempts} attempt(s), but it is a merge commit on \`${integrationBranch}\`.`,
    `Every commit on \`${integrationBranch}\` must land via a pull request, so this is either GitHub's merge-state replication lagging behind the push or a genuine defect — and either way this run performed no claim cleanup. Any issue that merge shipped still carries \`status:claimed\` and a live \`rallypoint-claims/issue-<N>\` reservation, which makes it unclaimable by anyone.`,
    `Finish the job by hand once the merge is visible: node .rallypoint/scripts/close-referenced-issues.mjs ${sha}`,
  ].join(" ");

/**
 * Surfaces a message where the outcome is read, not only in the log.
 *
 * A workflow-command annotation puts it on the run's own summary, and the job
 * summary file puts it in the checks list — the lesson being that a control whose
 * skip and pass look identical in the checks list can stay inert indefinitely.
 *
 * @param {{
 *   message: string,
 *   env?: Record<string, string | undefined>,
 *   log?: (line: string) => void,
 *   append?: (path: string, contents: string) => void,
 * }} input
 */
export const annotateFailure = ({
  message,
  env = process.env,
  log = console.error,
  append = appendFileSync,
}) => {
  // Newlines would end the workflow command early; GitHub's own escape is `%0A`.
  log(`::error::${message.replaceAll("\n", "%0A")}`);

  const summary = env.GITHUB_STEP_SUMMARY;
  if (!summary) return;

  try {
    append(summary, `\n**Close referenced issues:** ${message}\n`);
  } catch (error) {
    // The annotation above already carries the failure; losing the summary
    // must not turn a diagnostic into the thing that crashes the run.
    log(
      `Could not write the job summary: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
};

const repository = () =>
  JSON.parse(run("gh", "repo", "view", "--json", "nameWithOwner")).nameWithOwner;

/**
 * @param {string} nameWithOwner
 * @param {string} sha
 */
const pullRequestsForCommit = (nameWithOwner, sha) =>
  JSON.parse(run("gh", "api", `repos/${nameWithOwner}/commits/${sha}/pulls`));

/**
 * The message of the commit this run is reconciling — the same text GitHub's
 * own native closing scans, and `sha` is always that landed commit (see
 * `planClosures`'s doc comment for why body-only reading misses closures) — plus
 * its parent count, which is how `classifyEmptyLookup` recognises a merge
 * commit. One call rather than two for the same object.
 *
 * @param {string} nameWithOwner
 * @param {string} sha
 * @returns {{ message: string, parentCount: number }}
 */
const commitDetail = (nameWithOwner, sha) => {
  const commit = JSON.parse(
    run("gh", "api", `repos/${nameWithOwner}/commits/${sha}`),
  );

  return {
    message: commit.commit.message,
    parentCount: Array.isArray(commit.parents) ? commit.parents.length : 0,
  };
};

/**
 * Whether the commit is an ancestor of the integration branch.
 *
 * Asked through the compare endpoint rather than from git, because the workflow
 * checkout is not guaranteed to carry the branch, and asked **only** on the
 * already-suspicious path so the common case pays nothing for it.
 *
 * A comparison that cannot be made is treated as contained. The bias is
 * deliberate and one-directional: this answer only ever gates a warning, so
 * guessing "yes" costs a false alarm somebody reads, and guessing "no" costs
 * exactly the silence this check exists to break.
 *
 * @param {string} nameWithOwner
 * @param {string} sha
 * @param {string} integrationBranch
 * @returns {boolean}
 */
const containedInIntegrationBranch = (nameWithOwner, sha, integrationBranch) => {
  try {
    const { status } = JSON.parse(
      run(
        "gh",
        "api",
        `repos/${nameWithOwner}/compare/${integrationBranch}...${sha}`,
      ),
    );
    return status === "identical" || status === "behind";
  } catch {
    return true;
  }
};

/**
 * A synchronous pause, because everything else in this script is synchronous
 * and making `main` async to hold a six-second ceiling would be a larger change
 * than the pause is worth.
 *
 * @param {number} ms
 */
const sleep = (ms) => {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
};

/**
 * State, labels, assignees, and comments come from one call: the label removal
 * below needs the first two, `restoreToQueue` needs three, and
 * `claimEndedByMerge` needs the comments, and asking four times would spend
 * three more requests to learn the same thing.
 *
 * @param {string} issue
 * @returns {{
 *   state: string,
 *   labels: unknown,
 *   assignees: unknown,
 *   comments: { body?: string | null, createdAt?: string }[],
 * }}
 */
const issueSnapshot = (issue) =>
  JSON.parse(
    run(
      "gh",
      "issue",
      "view",
      issue,
      "--json",
      "state,labels,assignees,comments",
    ),
  );

/**
 * @param {string} nameWithOwner
 * @param {string} issue
 */
const issueEvents = (nameWithOwner, issue) =>
  JSON.parse(
    run(
      "gh",
      "api",
      "--paginate",
      "--slurp",
      `repos/${nameWithOwner}/issues/${issue}/events?per_page=100`,
    ),
  ).flat();

/**
 * @param {{
 *   nameWithOwner: string,
 *   issue: string,
 *   claimRefPrefix: string,
 *   execute?: (...command: string[]) => string,
 * }} input Reservation and command runner.
 * @returns {boolean} Whether a reservation was removed.
 */
export const removeReservation = ({
  nameWithOwner,
  issue,
  claimRefPrefix,
  execute = run,
}) => {
  const shortRef = `${claimRefPrefix}${issue}`;
  const fullRef = `refs/heads/${shortRef}`;
  /** @type {{ ref?: string }[]} */
  const matchingRefs = JSON.parse(
    execute(
      "gh",
      "api",
      `repos/${nameWithOwner}/git/matching-refs/heads/${shortRef}`,
    ),
  );

  if (!matchingRefs.some((candidate) => candidate.ref === fullRef)) {
    return false;
  }

  execute(
    "gh",
    "api",
    "--method",
    "DELETE",
    `repos/${nameWithOwner}/git/${fullRef}`,
  );
  return true;
};

/**
 * Removes `status:claimed` from an issue whose work has shipped, the other half
 * of the claim `removeReservation` above releases.
 *
 * Presence is decided from labels that were *read*, never inferred from a
 * removal's own failure — the same rule `removeReservation` follows for the ref
 * and `release-claim.mjs` states outright. A labels payload that is not an array
 * is not an empty one: it is an answer that could not be established, and it
 * throws rather than reporting the label absent and moving on.
 *
 * Nothing is added in its place — since the readiness label was removed nothing ever is, here or in
 * `release-claim.mjs`: removing `status:claimed` is by itself what returns a
 * still-open issue to the pool. Here the issue is closed and has no next
 * claimant either way.
 *
 * @param {{
 *   issue: string,
 *   labels: unknown,
 *   claimedLabel: string,
 *   execute?: (...command: string[]) => string,
 * }} input Labels as read from the issue, and the command runner.
 * @returns {boolean} Whether the label was removed.
 */
export const removeClaimedLabel = ({
  issue,
  labels,
  claimedLabel,
  execute = run,
}) => {
  if (!Array.isArray(labels)) {
    throw new Error(
      `Could not establish the labels on #${issue}; refusing to guess at ${claimedLabel}.`,
    );
  }

  if (!labels.some((label) => label?.name === claimedLabel)) return false;

  execute("gh", "issue", "edit", issue, "--remove-label", claimedLabel);
  return true;
};

/**
 * The comment this script posts when it ends a claim it did not close.
 *
 * Separated from the `gh` call and exported so the blocked wording is a tested
 * fact rather than a string nobody reads until it is on an issue. The old text
 * asserted "The issue is back on the queue, unassigned, with its
 * reservation removed, so it can be claimed again for whatever remains"
 * unconditionally, which on a `status:blocked` / `needs:human` issue was simply
 * false — and worse, it told every reader that the queue had been restored when
 * the whole point of the hold was that it must not be.
 *
 * `closed: true` is the same comment for an issue that is already closed, where
 * every sentence about the queue would be false. It says instead why a closed
 * issue had a live claim to release at all, because that state is not supposed
 * to happen and the reader will want to know.
 *
 * @param {{
 *   pullRequest: number,
 *   restored: ReturnType<typeof restoreToQueue>,
 *   integrationBranch: string,
 *   claimedLabel: string,
 *   closed?: boolean,
 * }} input
 * @returns {string}
 */
export const claimReleaseComment = ({
  pullRequest,
  restored,
  integrationBranch,
  claimedLabel,
  closed = false,
}) => {
  if (closed) {
    return [
      `Claim released: #${pullRequest} shipped work for this issue and merged into \`${integrationBranch}\`, so the session that held the claim has ended. The issue was already closed when that merge landed, and its claim was left behind — \`${claimedLabel}\`, the assignee, and the \`rallypoint-claims/\` reservation ref all outlived it.`,
      "",
      `This script used to skip a closed issue entirely, on the reasoning that a closed issue has no claim to hand back. That is true of the queue and false of the claim: the reservation ref makes the issue unclaimable and \`report.mjs\` surfaces the pair as coordination drift, on an issue nobody is working. So the claim is released here and the issue stays closed — nothing was reopened.`,
      "",
      `If this issue is not in fact finished, reopen it; it becomes claimable again then, since claimability is the absence of a hold label rather than a label of its own. Its being closed is not something this script decided or should second-guess.`,
    ].join("\n");
  }

  const preamble = [
    `Claim released: #${pullRequest} shipped work for this issue and merged into \`${integrationBranch}\` without closing it, so the session that held the claim has ended while the issue itself is not finished.`,
    "",
    "This is not a stale-claim release — nothing timed out. It is `.rallypoint/scripts/close-referenced-issues.mjs` recognising that a merged pull request ends its author's session whether or not it also closes the issue.",
    "",
  ];

  if (restored.held.length === 0) {
    return [
      ...preamble,
      "The issue is unassigned with its reservation removed and carries no hold label, so it is claimable again for whatever remains.",
    ].join("\n");
  }

  const held = restored.held.map((label) => `\`${label}\``).join(" and ");

  const lines = [
    ...preamble,
    `This issue carries ${held}, so it is **not** claimable. The claim itself is gone — \`${claimedLabel}\` removed, assignee cleared, reservation deleted — but the issue stays out of the pool on purpose: \`claim.mjs\` filters out every issue carrying a hold label, and offering it would hand the next worker an issue an earlier session already established no agent can advance.`,
    "",
    `Whoever clears the hold owns the requeue. Remove ${held} once the dependency or the owner decision lands, and the issue is claimable again with no second label to remember.`,
  ];

  return lines.join("\n");
};

/**
 * Releases the claim on an issue whose work shipped without closing it.
 *
 * The reservation goes first, for the reason `lib/release-claim.mjs` sets out
 * in full: a failure after that point leaves the issue readable as
 * `status:claimed` for the next janitor pass, whereas clearing the labels
 * first and failing on the delete strands it as claimable behind a live
 * reservation that no claim attempt can get past.
 *
 * @param {{
 *   nameWithOwner: string,
 *   issue: string,
 *   pullRequest: number,
 *   mergedAt: string,
 *   config: ReturnType<typeof loadConfig>,
 * }} input
 */
const releaseShippedClaim = ({
  nameWithOwner,
  issue,
  pullRequest,
  mergedAt,
  config,
}) => {
  const { state, labels, assignees, comments } = issueSnapshot(issue);
  // A closed issue has no *queue entry* to hand back, and it used to be skipped
  // outright on that reasoning — "`planClosures` owns that path", which is true
  // only when `planClosures` saw the closure. It does not always see it. GitHub
  // closes an issue from any closing keyword anywhere in the body or in a commit
  // message, while `linkedIssues` reads only a keyword at the start of a line,
  // so a body sentence merely *discussing* a closure closes the issue on
  // GitHub's side and declares nothing on this side. `planClaimReleases` then
  // resolves the branch's issue, arrives here, finds it already closed, and the
  // skip left the claim standing: `status:claimed`, the assignee, and the
  // reservation ref all outlived the session, on an issue nobody could claim
  // and nobody was working. `report.mjs` surfaced the residue afterwards, which
  // is detection after the fact.
  //
  // So a closed issue now takes the same path with the queue half withheld. The
  // claim is the session's, and the session has ended whatever state the issue
  // is in. Nothing here reopens anything — whether the closure was right is a
  // separate question this script has no standing to answer.
  const closed = state === "CLOSED";

  const ended = claimEndedByMerge({ claim: lastClaim(comments), mergedAt });

  if (!ended.ended) {
    console.log(
      `Leaving #${issue} alone: ${ended.reason}. Nothing was deleted or edited.`,
    );
    return;
  }

  const removed = removeReservation({
    nameWithOwner,
    issue,
    claimRefPrefix: config.claimRefPrefix,
  });

  const restored = restoreToQueue({
    issue,
    labels,
    assignees,
    claimedLabel: config.labels.claimed,
    holdLabels: [
      config.labels.blocked,
      config.labels.deferred,
      config.labels.human,
    ],
    queueable: !closed,
  });

  if (!removed && !restored.changed) {
    console.log(`#${issue} carries no claim from #${pullRequest} to release.`);
    return;
  }

  run(
    "gh",
    "issue",
    "comment",
    issue,
    "--body",
    claimReleaseComment({
      pullRequest,
      restored,
      integrationBranch: config.integrationBranch,
      claimedLabel: config.labels.claimed,
      closed,
    }),
  );

  console.log(
    closed
      ? `Released the claim on #${issue} (shipped by #${pullRequest}; the issue was already closed).`
      : `Released the claim on #${issue} (shipped by #${pullRequest}, not closed).`,
  );
  console.log(
    removed
      ? `  removed reservation for #${issue}`
      : `  no reservation for #${issue}`,
  );

  if (closed) {
    console.log(
      `  left #${issue} closed and out of the queue; released the claim only`,
    );
  } else if (restored.held.length > 0) {
    console.log(
      `  left #${issue} out of the queue: it carries ${restored.held.join(", ")}`,
    );
  } else {
    console.log(
      restored.changed
        ? `  cleared the claim on #${issue}; it is unassigned and claimable`
        : `  #${issue} was already claimable and unassigned`,
    );
  }
};

const main = () => {
  const sha = process.argv[2] ?? "HEAD";
  const config = loadConfig();
  const nameWithOwner = repository();
  const { message, parentCount } = commitDetail(nameWithOwner, sha);

  const { pullRequests, attempts } = lookupWithRetries({
    lookup: () => pullRequestsForCommit(nameWithOwner, sha),
    isMergeCommit: parentCount >= 2,
  });

  const closures = planClosures({
    pullRequests,
    integrationBranch: config.integrationBranch,
    commitMessage: message,
  });
  const releases = planClaimReleases({
    pullRequests,
    integrationBranch: config.integrationBranch,
    branchPrefix: config.branchPrefix,
    commitMessage: message,
  });

  // A throw here must not stop the closing path below. That path predates this
  // one and is the reason this script exists; a new failure surface should not
  // be able to take it down with it.
  let released = 0;
  let failed = false;

  for (const { pullRequest, issue, mergedAt } of releases) {
    try {
      releaseShippedClaim({
        nameWithOwner,
        issue,
        pullRequest,
        mergedAt,
        config,
      });
      released += 1;
    } catch (error) {
      failed = true;
      console.error(
        `Could not release the claim on #${issue} from #${pullRequest}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  if (failed) process.exitCode = 1;

  if (closures.length === 0) {
    // An empty lookup is not automatically a normal outcome. `classifyEmptyLookup`
    // separates "resolved a pull request with no closing keywords" — quiet, exit
    // 0 — from "resolved no pull request for a merge commit on the integration
    // branch", which contradicts the ruleset and means this run silently did
    // nothing.
    if (
      classifyEmptyLookup({
        pullRequests,
        parentCount,
        onIntegrationBranch: containedInIntegrationBranch(
          nameWithOwner,
          sha,
          config.integrationBranch,
        ),
      }) === "unresolved"
    ) {
      annotateFailure({
        message: unresolvedLookupMessage({
          sha,
          integrationBranch: config.integrationBranch,
          attempts,
        }),
      });
      process.exitCode = 1;
      return;
    }

    console.log(
      released > 0
        ? `No merged pull request at ${sha} closes an issue; ${released} claim release(s) handled above.`
        : `No merged pull request at ${sha} references an issue.`,
    );
    return;
  }

  // Issues this merge actually left closed, which is what the `Blocked-By:`
  // sweep below is entitled to act on. A reopened issue is deliberately absent:
  // it did not close, so nothing it blocks has cleared.
  /** @type {string[]} */
  const closed = [];

  for (const { pullRequest, mergedAt, issues } of closures) {
    for (const issue of issues) {
      const { state, labels } = issueSnapshot(issue);
      // Only fetch events when the issue isn't already closed: an issue
      // GitHub closed on merge needs no reopened-check at all.
      const wasReopened =
        state === "CLOSED"
          ? false
          : wasReopenedAfterMerge({
              events: issueEvents(nameWithOwner, issue),
              mergedAt,
            });
      const action = resolveIssueAction({ state, wasReopened });

      if (action === "already-closed") {
        console.log(`#${issue} is already closed.`);
      } else if (action === "reopened") {
        console.log(
          `#${issue} was reopened after pull request #${pullRequest} merged; leaving it open.`,
        );
        continue;
      } else {
        run(
          "gh",
          "issue",
          "close",
          issue,
          "--reason",
          "completed",
          "--comment",
          `Closed by #${pullRequest}, merged into \`${config.integrationBranch}\`.\n\nGitHub's native closing keyword should have handled this on merge; \`.rallypoint/scripts/close-referenced-issues.mjs\` closed it instead because that did not happen (a missed workflow run, a manual reconciliation, or an integration branch that is not also the default branch).`,
        );
        console.log(`Closed #${issue} for pull request #${pullRequest}.`);
      }

      closed.push(issue);

      const removed = removeReservation({
        nameWithOwner,
        issue,
        claimRefPrefix: config.claimRefPrefix,
      });
      console.log(
        removed
          ? `  removed reservation for #${issue}`
          : `  no reservation for #${issue}`,
      );

      // The snapshot above predates the close, and closing an issue does not
      // change its labels, so it is still the right read here.
      const unlabelled = removeClaimedLabel({
        issue,
        labels,
        claimedLabel: config.labels.claimed,
      });
      console.log(
        unlabelled
          ? `  removed ${config.labels.claimed} from #${issue}`
          : `  no ${config.labels.claimed} on #${issue}`,
      );
    }
  }

  // Dependents of what just closed. This script already runs on every
  // push to the integration branch and already knows exactly which issues
  // closed, which makes it the cheapest place in the loop to make
  // `docs/AGENT_LOOP.md`'s "work resumes on its own" true rather than
  // aspirational — no new workflow, no new schedule, and the issue becomes
  // claimable in the same minute its blocker merged.
  //
  // Wrapped for the same reason the claim-release loop above is: a new failure
  // surface must not be able to take down the closing path this script exists
  // for. `janitor-pass.mjs` re-sweeps unconditionally, so a throw here costs a
  // delay rather than the repair.
  try {
    const swept = sweepClearedBlockers({ gh, config, closedIssues: closed });

    if (swept.requeued.length > 0) {
      console.log(
        `Requeued ${swept.requeued.map((issue) => `#${issue}`).join(", ")} whose Blocked-By: trailer cleared.`,
      );
    }

    // `unparseable` is deliberately absent from this condition. It is the one
    // finding the sweep cannot scope to this merge — a trailer that does not
    // parse has no blocker list to compare against `closed` — so counting it
    // would make every run of this script red for as long as one typo sits
    // anywhere on the board, and this exit code is how an operator running it
    // by hand after a merge learns whether the closing and reservation cleanup
    // worked. It is on `stderr`, and `report.mjs` carries it as an unknown.
    if (swept.reported.length > 0 || swept.failed.length > 0) {
      process.exitCode = 1;
    }

    if (swept.unparseable.length > 0) {
      console.log(
        `${swept.unparseable.map((issue) => `#${issue}`).join(", ")} carry an unparseable Blocked-By: trailer (reported above, not treated as a failure of this run).`,
      );
    }
  } catch (error) {
    process.exitCode = 1;
    console.error(
      `Could not sweep ${config.labels.blocked} issues for cleared Blocked-By: trailers: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
};

const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  main();
}

export default planClosures;
