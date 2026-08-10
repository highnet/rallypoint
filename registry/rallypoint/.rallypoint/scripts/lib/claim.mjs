// The atomic claim, with every call to `gh` injected.
//
// Assignment is not a lock: several agent sessions may share one GitHub
// identity, so `--add-assignee @me` proves nothing about who got there first.
// Creating `refs/heads/<claimRefPrefix><issue>` does, because GitHub refuses a
// second creation of the same ref. Everything in this module exists to keep that
// one guarantee: reserve before mutating, skip a contended issue without
// touching it, and release the reservation if the follow-up mutation fails.
//
// The ref cannot see one collision, though: an issue whose work is already in
// flight under an open pull request that never reserved anything. There is no
// ref to collide with, so a second session claims it, branches, implements, and
// opens a second pull request. `partitionCandidates` below filters those out in
// front of the reservation; it does not replace it.

import {
  referencingPullRequests,
  SAFE_AGENT_ID,
} from "../provenance.mjs";
import { ISSUE_PAGE, explainHold, isClaimable } from "./claimable.mjs";
import { openPullRequests } from "./release-claim.mjs";

/**
 * @typedef {{
 *   number: number,
 *   title: string,
 *   labels: { name: string }[],
 *   assignees: unknown[],
 * }} Issue
 */

/**
 * @typedef {{
 *   integrationBranch?: string,
 *   branchPrefix: string,
 *   claimRefPrefix: string,
 *   labels: { claimed: string, blocked?: string, deferred?: string, human?: string },
 * }} ClaimConfig
 */

export const EXIT = {
  ok: 0,
  usage: 1,
  noneAvailable: 2,
};

// Flags this parser recognises as taking a value. A bare issue number typed
// after the script name — `claim.mjs 858 --agent-id x` — reads, in English, as
// "claim issue 858", but nothing here ever consumed it: `values("--issue")`
// only looks for `--issue`, so the token was silently dropped and the run
// fell through to "claim whatever is next", handing out a different issue
// with no error. `strays` below is what makes that loud instead of
// silent.
const FLAGS_WITH_VALUE = ["--agent-id", "--issue", "--plan"];

/**
 * @param {string[]} argv Arguments after the script path.
 */
export const parseArgs = (argv) => {
  /** @param {string} flag */
  const values = (flag) =>
    argv.flatMap((value, index) =>
      value === flag && argv[index + 1] ? [argv[index + 1]] : [],
    );

  // Every argv index a recognised flag consumed as its value, so it is not
  // also counted as a stray positional below.
  const consumedValueIndices = new Set(
    FLAGS_WITH_VALUE.flatMap((flag) =>
      argv.flatMap((value, index) =>
        value === flag && argv[index + 1] !== undefined ? [index + 1] : [],
      ),
    ),
  );

  // Anything left that is not a `--flag` itself and was not consumed as one's
  // value is a positional argument this command has never supported. Report
  // it rather than discard it — an unrecognised `--flag` still passes through
  // untouched (the tolerant-scanner behaviour every Rallypoint entry point
  // documents), but a bare positional reads as an instruction and must not be
  // silently ignored.
  const strays = argv.filter(
    (value, index) =>
      !consumedValueIndices.has(index) && !value.startsWith("--"),
  );

  return {
    agentId: values("--agent-id").at(0),
    requestedIssue: values("--issue").at(0),
    // Three is the documented plan length; a longer list is truncated rather
    // than refused, because a verbose caller is not a broken one.
    plans: values("--plan").slice(0, 3),
    strays,
  };
};

/**
 * The rank an unlabelled issue sorts at: after every `prio:p0` … `prio:p9`.
 *
 * Deliberately not the middle of the scale. An issue nobody has prioritised
 * carries no claim about its own urgency, and the old two-level `priority()`
 * returned `2` for it — which under a ten-level scheme would have placed it
 * above seven real levels on the strength of having no label at all.
 */
const UNPRIORITISED = 10;

const PRIORITY_LABEL = /^prio:p([0-9])$/;

/**
 * The numeric level from an issue's `prio:p<n>` label, per `docs/PRIORITIES.md`.
 *
 * Parsed rather than enumerated, so adding a level to the scheme is a label and
 * a documentation change and not also a change here. It used to test for
 * `prio:p0` and `prio:p1` by name and return `2` for everything else, which was
 * lossy at one boundary while three levels existed and collapsed eight of them
 * into one rank once P0–P9 landed — a P9 nitpick would then have been
 * offered ahead of a P2 bug whenever it held the lower issue number, since that
 * is the tie-break this falls through to.
 *
 * Two `prio:` labels resolve to the more urgent, so ordering does not depend on
 * the order GitHub happens to return labels in. That is damage control for a
 * mislabelled issue, not a supported way to label one.
 *
 * @param {Issue} issue
 */
const priority = (issue) =>
  issue.labels.reduce((lowest, label) => {
    const match = PRIORITY_LABEL.exec(label?.name ?? "");
    return match ? Math.min(lowest, Number(match[1])) : lowest;
  }, UNPRIORITISED);

/**
 * Why a specifically-named issue was not offered, decided from a read of the
 * issue itself.
 *
 * Thin wrapper over `explainHold`, kept as a named export because it is the
 * shape `claim.mjs`'s refusal path and its tests both address. The whole of the
 * judgement lives in `lib/claimable.mjs` so that this command and `report.mjs`
 * cannot drift on what "claimable" means — the drift that produced
 * `readyWithoutTask`, an issue the report advertised and this command could
 * never offer.
 *
 * Returns `null` when nothing explains it, so the caller falls back to its
 * ordinary message rather than asserting a cause it did not establish.
 *
 * @param {{
 *   issue: { state?: string, labels?: unknown, assignees?: unknown } | null,
 *   number: string,
 *   config: { labels: Record<string, string | undefined> },
 * }} input
 * @returns {string | null}
 */
export const explainUnavailable = ({ issue, number, config }) =>
  explainHold({ issue, number, config });

/**
 * Highest priority first, then oldest issue number.
 *
 * Every exclusion is now a *negative* label test, which is why this filters in
 * JavaScript rather than in the `gh issue list` query: that query can only
 * express labels an issue must **have**. Before #1510 the positive
 * `task` + `status:ready` pair carried most of the work and only `needs:human`
 * was filtered here; now the hold set — `status:claimed`, `status:blocked`,
 * `status:deferred`, `needs:human` — is the whole of the rule, so all of it
 * lives here.
 *
 * `config` is **required**, and deliberately not optional the way the previous
 * `humanLabel` parameter was. That allowance was safe only because the query
 * pre-narrowed candidates to `task` + `status:ready`: an un-updated caller still
 * got a sane pool, and the missing label merely failed to narrow it further.
 * With the pool defined by absence, the same fallback would *widen* it to every
 * open unassigned issue — handing out `status:claimed` and `needs:human` work —
 * so the failure mode inverted from "slightly too broad" to "no exclusions at
 * all". A fallback that fails open is worse than a missing argument that
 * throws.
 *
 * @param {{
 *   issues: Issue[],
 *   requestedIssue?: string,
 *   config: { labels: Record<string, string | undefined> },
 * }} input
 */
export const selectCandidates = ({ issues, requestedIssue, config }) =>
  issues
    .filter((issue) => isClaimable(issue, config))
    .filter(
      (issue) => !requestedIssue || String(issue.number) === requestedIssue,
    )
    .sort(
      (left, right) =>
        priority(left) - priority(right) || left.number - right.number,
    );

/**
 * Splits the ordered candidate list into the issues nothing is already working
 * and the ones an open pull request already references.
 *
 * The reservation ref is the only real atomicity guarantee and this does not
 * touch it; this is a filter in front of it, for the state the ref cannot see.
 * A claimable issue with an open pull request and no reservation —
 * `report.mjs`'s `unclaimedWithOpenPr`, or `unreservedWithOpenPr` when a claim
 * comment survives the missing ref — passes both of `claim.mjs`'s
 * existing filters, so a second session is handed work that is already in
 * flight and only finds out when somebody next runs the report.
 *
 * A listing that could not be established fires nothing. The #236 / #311 rule
 * cuts both ways: an error, a non-array body, or a response that filled its
 * page is no more evidence of a pull request's *presence* than of its absence,
 * so an unreadable listing leaves every candidate claimable and the claim rests
 * on the reservation ref alone, exactly as it did before this check existed.
 *
 * @template {{ number: number }} Candidate
 * @param {{
 *   candidates: Candidate[],
 *   pullRequests: { ok: true, items: { number: number, headRefName: string, body: string | null }[] } | { ok: false, reason: string },
 *   branchPrefix: string,
 * }} input
 * @returns {{ claimable: Candidate[], covered: { issue: number, pulls: number[] }[] }}
 */
export const partitionCandidates = ({
  candidates,
  pullRequests,
  branchPrefix,
}) => {
  /** @type {Candidate[]} */
  const claimable = [];
  /** @type {{ issue: number, pulls: number[] }[]} */
  const covered = [];

  for (const candidate of candidates) {
    const referencing = pullRequests.ok
      ? referencingPullRequests({
          pulls: pullRequests.items,
          issue: String(candidate.number),
          branchPrefix,
        })
      : [];

    if (referencing.length > 0) {
      covered.push({
        issue: candidate.number,
        pulls: referencing.map((pull) => pull.number),
      });
      continue;
    }

    claimable.push(candidate);
  }

  return { claimable, covered };
};

/** @param {{ issue: number, pulls: number[] }[]} covered */
const describeCovered = (covered) =>
  covered
    .map(
      ({ issue, pulls }) =>
        `#${issue} (pull request ${pulls.map((pull) => `#${pull}`).join(", ")})`,
    )
    .join("; ");

/**
 * A branch name component derived from an issue title. Titles are free text and
 * arrive with slashes, quotes, and non-Latin scripts in them; anything that is
 * not a lowercase alphanumeric collapses to a single hyphen.
 *
 * @param {string | null | undefined} title
 */
export const branchSlug = (title) =>
  (title ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 42);

/**
 * @param {{
 *   argv: string[],
 *   config: ClaimConfig,
 *   gh: (...args: string[]) => string,
 *   stdout?: (line: string) => void,
 *   stderr?: (line: string) => void,
 *   afterClaim?: (claimed: { issue: number, branch: string }) => void,
 * }} input
 * @returns {number} Process exit code.
 */
export const claim = ({
  argv,
  config,
  gh,
  stdout = console.log,
  stderr = console.error,
  afterClaim = () => {},
}) => {
  const { agentId, requestedIssue, plans, strays } = parseArgs(argv);

  if (strays.length > 0) {
    stderr(
      `Unsupported argument${strays.length > 1 ? "s" : ""} ${strays.map((value) => `"${value}"`).join(", ")}: this command takes no positional issue number. ` +
        "Pass the issue with `--issue <n>` to claim it specifically, or omit " +
        "it to take the highest-priority claimable issue. Nothing was reserved.",
    );
    return EXIT.usage;
  }

  if (!agentId) {
    stderr("Missing required --agent-id <unique-session-id>.");
    return EXIT.usage;
  }

  // The claim comment is what `review.mjs` reads to identify a branch's author,
  // so an id containing a backtick or a newline would break that record.
  if (!SAFE_AGENT_ID.test(agentId)) {
    stderr(
      `Agent id "${agentId}" must match ${SAFE_AGENT_ID}: letters, digits, dot, underscore, and hyphen only.`,
    );
    return EXIT.usage;
  }

  const repository = JSON.parse(
    gh("repo", "view", "--json", "nameWithOwner,defaultBranchRef"),
  );
  const baseBranch =
    config.integrationBranch || repository.defaultBranchRef.name;
  const base = JSON.parse(
    gh("api", `repos/${repository.nameWithOwner}/git/ref/heads/${baseBranch}`),
  );
  // Every open issue, filtered in `selectCandidates`. The query carries no
  // `--label` at all now: the pool is defined by the *absence* of a hold label
  // and `gh issue list` cannot express that.
  //
  // Truncation is detected here rather than by `listing()`, deliberately.
  // `listing()` drops the items when a page fills, which is right for a report
  // — a possibly-truncated listing is not evidence about what exists — and
  // wrong here: a listing that is complete as far as it goes is still correct
  // for every issue in it, and discarding them would stop the claim loop dead
  // over a condition that raising `ISSUE_PAGE` fixes. So this warns and
  // proceeds, and the refusal messages below say so rather than asserting an
  // empty board.
  //
  // It must never be silent. `gh issue list` sorts newest-first, so an over-full
  // page drops the *oldest* issues, and `selectCandidates` tie-breaks ascending
  // by number — the dropped tail is precisely what this command would otherwise
  // have offered first. Undetected that is not a delay; it is a permanently
  // unclaimable and permanently invisible tail that grows as issues are filed.
  /** @type {Issue[]} */
  const issues = JSON.parse(
    gh(
      "issue",
      "list",
      "--state",
      "open",
      "--limit",
      String(ISSUE_PAGE),
      "--json",
      "number,title,labels,assignees",
    ),
  );

  const truncated = issues.length >= ISSUE_PAGE;

  if (truncated) {
    stderr(
      `The open-issue listing filled its page of ${ISSUE_PAGE}, so it may be ` +
        "truncated and this claim may be drawn from an incomplete backlog. " +
        "`gh issue list` returns newest first, so what is missing is the " +
        "oldest work — the end this command offers from first. Raise " +
        "`ISSUE_PAGE` in `lib/claimable.mjs`, which shares it with `report.mjs` " +
        "so the two cannot describe different populations.",
    );
  }

  // Appended to every "nothing to claim" message when the listing was full, so
  // an incomplete read is never reported as an empty board.
  const truncationCaveat = truncated
    ? ` (Note: the open-issue listing filled its page of ${ISSUE_PAGE}, so this` +
      " may not be the whole backlog.)"
    : "";

  // Read once per run, before anything is reserved, so a candidate an open pull
  // request already covers is left completely untouched — no ref, no label, no
  // assignee, no comment.
  const pullRequests = openPullRequests(gh);

  if (!pullRequests.ok) {
    stderr(
      `Skipped the open-pull-request check on every candidate: ${pullRequests.reason}. ` +
        "An unreadable listing is not evidence either way, so this claim rests " +
        "on the reservation ref alone.",
    );
  }

  const { claimable, covered } = partitionCandidates({
    candidates: selectCandidates({ issues, requestedIssue, config }),
    pullRequests,
    branchPrefix: config.branchPrefix,
  });

  for (const issue of claimable) {
    const ref = `refs/heads/${config.claimRefPrefix}${issue.number}`;
    let issueMutated = false;

    try {
      gh(
        "api",
        "--method",
        "POST",
        `repos/${repository.nameWithOwner}/git/refs`,
        "-f",
        `ref=${ref}`,
        "-f",
        `sha=${base.object.sha}`,
      );
    } catch {
      // Another session holds it. Move on without touching this issue at all —
      // editing labels on somebody else's claim is the failure this guards.
      continue;
    }

    try {
      gh(
        "issue",
        "edit",
        String(issue.number),
        "--add-assignee",
        "@me",
        "--add-label",
        config.labels.claimed,
      );
      issueMutated = true;
      const body = [
        `Claimed by Rallypoint agent \`${agentId}\`.`,
        "",
        ...plans.map((plan) => `- ${plan}`),
      ].join("\n");
      gh("issue", "comment", String(issue.number), "--body", body);
    } catch (error) {
      // Order matters here, and it is the subject of #140.
      //
      // If the issue edit already landed, the issue is claimed and assigned.
      // Deleting the reservation first would leave it in exactly the worst
      // state: held out of the pool by `status:claimed`, so nobody claims it,
      // and with no reservation ref, so the janitor has nothing to find.
      // Restore the issue first, and only release the reservation once that
      // has succeeded.
      //
      // Restoring is now purely subtractive — removing `status:claimed` and the
      // assignee is the whole of it, because claimability is derived from their
      // absence. Before #1510 this also had to re-add `status:ready`, a second
      // write that could itself fail and leave the issue claimable by nobody.
      if (issueMutated) {
        try {
          gh(
            "issue",
            "edit",
            String(issue.number),
            "--remove-assignee",
            "@me",
            "--remove-label",
            config.labels.claimed,
          );
        } catch {
          // Compensation failed, so the issue still reads as claimed. Keep the
          // reservation deliberately: it is the only signal left that tells the
          // janitor this issue needs recovering.
          stderr(
            `Claim failed and issue #${issue.number} plus reservation ${ref} require manual cleanup.`,
          );
          throw error;
        }
      }

      // A reservation with no claimed issue behind it is worse than no
      // reservation: nothing releases it except the janitor, and until then the
      // issue is unclaimable by anyone.
      try {
        gh(
          "api",
          "--method",
          "DELETE",
          `repos/${repository.nameWithOwner}/git/${ref}`,
        );
      } catch {
        stderr(`Claim failed and reservation ${ref} requires manual cleanup.`);
      }
      throw error;
    }

    stdout(`CLAIMED_ISSUE=${issue.number}`);
    stdout(
      `CLAIMED_URL=https://github.com/${repository.nameWithOwner}/issues/${issue.number}`,
    );
    const branch = `${config.branchPrefix}${issue.number}-${branchSlug(issue.title)}`;
    stdout(`CLAIM_BRANCH=${branch}`);

    // The beacon push. Deliberately after every GitHub mutation has
    // landed and outside the compensation block above: this touches only git,
    // it cannot leave the claim half-made, and a claim that succeeded with no
    // beacon behind it is exactly the state the protocol was in before. So it
    // never throws and never changes this exit code — `beaconPush` reports its
    // own refusals on stderr.
    afterClaim({ issue: issue.number, branch });

    return EXIT.ok;
  }

  // Exit code 2 covers both refusals — there is still nothing to claim — but
  // "every claimable issue already has a pull request" is a different board from
  // "the backlog is empty", and an operator naming one issue needs the pull
  // request number to act on it without re-deriving the link.
  if (covered.length > 0) {
    const detail = describeCovered(covered);

    if (claimable.length === 0) {
      stderr(
        `No claimable issue is available: an open pull request already ` +
          `references every candidate — ${detail}. Nothing was reserved. If a ` +
          "pull request there is missing its claim comment, recover it with " +
          "`node .rallypoint/scripts/reconcile.mjs --issue <n> --agent-id " +
          `<authoring-session-id>\`.${truncationCaveat}`,
      );
      return EXIT.noneAvailable;
    }

    stderr(
      "No unreserved claimable issue is available. Also skipped because an " +
        `open pull request already references them: ${detail}.${truncationCaveat}`,
    );
    return EXIT.noneAvailable;
  }

  // Only for an explicitly named issue, and only on the refusal path: one extra
  // read, on a path that is already terminal, to turn a message about the board
  // into a message about the issue the operator actually asked for.
  if (requestedIssue) {
    let named = null;

    try {
      named = JSON.parse(
        gh(
          "issue",
          "view",
          requestedIssue,
          "--json",
          "state,labels,assignees",
        ),
      );
    } catch {
      // Left null; `explainUnavailable` says so rather than guessing.
    }

    const reason = explainUnavailable({
      issue: named,
      number: requestedIssue,
      config,
    });

    if (reason !== null) {
      stderr(`Not claiming #${requestedIssue}: ${reason} Nothing was reserved.`);
      return EXIT.noneAvailable;
    }
  }

  stderr(`No unreserved claimable issue is available.${truncationCaveat}`);
  return EXIT.noneAvailable;
};

export default claim;
