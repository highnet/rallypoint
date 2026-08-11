#!/usr/bin/env node

// Records review verdicts durably and binds `review:approved` to a revision.
//
// GitHub rejects APPROVE and REQUEST_CHANGES from a pull request's own author,
// and every Rallypoint session authenticates as the same identity, so formal
// approvals cannot be recorded at all. Verdicts are
// therefore written as COMMENTED reviews carrying a machine-readable block, and
// this script is the only thing that may apply or remove the approval label.
//
// LIMITATION: agent ids are self-declared. `claim.mjs` takes `--agent-id` on
// trust and there is no session identity to check it against, so the
// self-review guard below is bookkeeping, not authentication. It catches an
// honest session reviewing its own work; it does not stop a session that lies
// about its id.
//
// SUBAGENT LINEAGE: a subagent's own id is distinct by construction
// from the session that dispatched it, so the guard above did not catch a
// subagent dispatched by the authoring session to review its own work — the
// exact shape this failure takes. `record` accepts an optional
// `--dispatched-by <id>`, self-declared the same way `--agent-id` is, naming
// the session a reviewing subagent was dispatched by. When that parent is the
// branch's own author, this is self-review by another name and is refused
// identically. This is the same trust model as everything else in this file:
// an honest subagent names its parent, a dishonest one omits or falsifies it,
// and making any of it authenticated, rather than self-declared, remains the
// real fix. `.rallypoint/roles/reviewer.md` states plainly
// that dispatching a review subagent from the authoring session is not
// permitted; this is the tooling backstop for an honest session that does it
// by mistake.
//
// SEVERAL REFERENCED ISSUES: a pull request may legitimately close
// more than one issue — commonly when a second is folded into the first by
// operator decision. `record` used to refuse that shape
// outright as an ambiguous authoring session, so a completed review of an
// 83-file payment-critical change had nowhere to put its verdict and went in
// as a plain comment `check` does not read. The self-review guarantee never
// needed a single issue: it needs the set of agent ids that claimed any
// referenced issue, and must refuse if the reviewer is among them. Both
// subcommands resolve that set (`workerClaims` below). What stays refused is a
// body whose closing keywords all point away from the issue the branch names —
// that would compare the reviewer against a stranger's claim.
//
// PROMOTION PULL REQUESTS: a pull request whose head branch IS the
// configured `integrationBranch` or `promotionBranch` (`release` -> `staging`,
// `staging` -> `main`) has no linked issue and no claim comment — nobody runs
// `claim.mjs` against a promotion, so there is no individual "author" to
// compare a reviewer against. `record`/`check` take a distinct path for this
// shape: the verdict binds to the pull request number and head SHA directly
// rather than to a claimed issue, and the self-review guard is skipped rather
// than refused, because there is no worker identity for it to compare against.
// Head-SHA binding, the replay/nonce defence, and stale-label handling are
// unchanged, so a promotion verdict still goes stale the moment the branch
// moves.
//
// CARRY-FORWARD: a push that only merges the integration branch in —
// contributing nothing of the branch's own — still moves the head SHA and
// still invalidates the verdict bound to the old one, same as any other
// push. `check` no longer stops at "no verdict at this exact head" before
// asking whether the branch's own contribution actually changed; see
// `carry-forward.mjs` for the proof and `EXIT.carriedApprove` /
// `EXIT.carriedRequestChanges` below for how the result surfaces. This never
// widens what `record` accepts and never changes the nonce or head-SHA
// binding a verdict is written with — it only changes what `check` is
// willing to infer still applies at a head nothing was recorded against.
// Out of scope for promotion pull requests: their head branch IS the
// integration branch, so the topology this exists for does not arise there.
//
// DEPENDABOT PULL REQUESTS: a pull request opened by the Dependabot
// bot has no authoring agent session either — nobody ran `claim.mjs`, there is
// no issue, and the head branch is `dependabot/npm_and_yarn/...`. `record`
// refused every one of them for want of an author, so completed reviews went in
// as plain comments `check` does not read and no dependency bump was mergeable
// through the documented path. It takes the same path a promotion does: the verdict binds to the
// pull request number and head SHA, and the self-review guard is skipped
// rather than refused. Recognition is by **authorship**
// (`isDependabotAuthor`), never by the `dependabot/` branch prefix — a branch
// name is not proof of authorship, so a human-authored pull request cannot
// acquire the bypass by naming its branch cleverly. `unclaimed` below is the
// union of the two shapes: "this pull request has no claimed author, and that
// is expected".

import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

import {
  authorshipIssues,
  branchIssue as branchIssueOf,
  claimant,
  isDependabotAuthor,
  isPromotionBranch,
  linkedIssues as linkedIssuesOf,
  recordableIssue,
  SAFE_AGENT_ID,
} from "./provenance.mjs";
import { resolveCarryForward } from "./carry-forward.mjs";
import { resolveTransport } from "./lib/gh.mjs";
import { git as realGit } from "./lib/git.mjs";
// The authority for every exit code below; see the comment above `EXIT`'s use.
import { EXIT } from "./lib/review-exit-codes.mjs";
import {
  legacyVerdictAtHead,
  MARKER,
  parseVerdicts,
  resolveApproval,
  resolveContestedApprove,
  resolvePromotionApproval,
} from "./verdicts.mjs";

const VERDICTS = new Set(["approve", "request-changes"]);

const config = JSON.parse(
  readFileSync(new URL("../config.json", import.meta.url), "utf8"),
);

const args = process.argv.slice(2);
const command = args[0];
/** @param {string} flag */
const values = (flag) =>
  args.flatMap((entry, index) =>
    entry === flag && args[index + 1] ? [args[index + 1]] : [],
  );
/** @param {string} flag */
const value = (flag) => values(flag).at(0);
/** @param {string} name */
const flag = (name) => args.includes(name);
// Resolved lazily and once: a command that never reaches GitHub (a `check`
// serving entirely from carry-forward, say) should not have to probe for
// `gh` or fail on a missing repository remote it will not use.
/** @type {((...args: string[]) => string) | null} */
let transport = null;

/** @param {string[]} parts */
const run = (...parts) => {
  // This script runs `git` directly and reaches GitHub through the resolved
  // transport — `gh` itself when installed, the REST transport otherwise
  // — rather than always shelling out to the `gh` binary.
  if (parts[0] === "gh") {
    transport ??= resolveTransport();
    return transport(...parts.slice(1));
  }

  return execFileSync(parts[0], parts.slice(1), {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
};

// The local ref the carry-forward check should treat as "the
// integration branch". Prefers the remote-tracking ref, since a checkout
// driving this script (CI or an agent session) may never have created a
// local branch by that name at all; falls back to a same-named local branch
// for a workspace that does have one checked out. Returns `null` — never
// throws — when neither resolves, so a checkout without the necessary
// history simply skips carry-forward rather than crashing `check` outright;
// `resolveCarryForward` already treats "nothing to compare against" as a
// refusal.
const resolveIntegrationRef = () => {
  for (const ref of [`origin/${config.integrationBranch}`, config.integrationBranch]) {
    try {
      realGit(["rev-parse", "--verify", `${ref}^{commit}`]);
      return ref;
    } catch {
      // Try the next candidate.
    }
  }
  return null;
};

/**
 * @param {string} message
 * @param {number} [code]
 * @returns {never}
 */
const fail = (message, code = 1) => {
  console.error(message);
  process.exit(code);
};

// Exit codes are a public interface: CI and the merge gate branch on them.
//
// `EXIT` is **derived, not declared**. The authority is
// `REVIEW_EXIT_CODES` in `lib/review-exit-codes.mjs`, which also carries each
// code's meaning and which subcommand owns it, and from which the coupling tests
// assert that `CHECK_MEANINGS` in `lib/report.mjs` and the prose tables in
// `docs/AGENT_LOOP.md` and `.rallypoint/roles/merger.md` all still agree with
// it. Declaring the numbers here as well would recreate the drift that module
// exists to close: a code that reaches the prose tables but no consumer, and a
// properly reviewed merge labelled unreviewed as a result.
//
// **Add a new code in `lib/review-exit-codes.mjs`, not here.** Its `key` becomes
// an `EXIT.<key>` automatically, and the unit suite will then name every
// consumer and document still owing it a decision.
//
// Codes 2, 3, 6, and 7 are all about identifying an author and are meaningless
// for a promotion or Dependabot pull request, which has none:
// `record` never reaches
// 2 or 3 for one (the identity checks are skipped outright), and `check` never
// reaches 6 or 7 (`resolvePromotionApproval` has no self-approval or
// unknown-author distinction to draw). 0, 1, 4, 5, 8, and 9 apply unchanged to
// both pull request shapes.
//
// (`EXIT` itself is imported at the top of the file, with the other imports.)

const usage = [
  "Usage:",
  "  review.mjs record --pr <n> --agent-id <id> --verdict approve|request-changes [--note <text>]... [--supersedes <issued>] [--dispatched-by <id>] [--dry-run]",
  "  review.mjs check  --pr <n> [--strip-stale] [--force]",
].join("\n");

const pullRequest = value("--pr");

if (!pullRequest || !["record", "check"].includes(command)) {
  fail(usage);
}

const pull = JSON.parse(
  run(
    "gh",
    "pr",
    "view",
    pullRequest,
    "--json",
    "number,headRefOid,headRefName,baseRefName,body,labels,author",
  ),
);
const head = pull.headRefOid;

// Read reviews through the REST API rather than `gh pr view --json reviews`:
// only the API reports `commit_id`, which is GitHub's own record of the
// revision a review was submitted against and the one field a recorder cannot
// forge.
const repository = JSON.parse(
  run("gh", "repo", "view", "--json", "nameWithOwner"),
).nameWithOwner;
const reviews = JSON.parse(
  run("gh", "api", "--paginate", `repos/${repository}/pulls/${pullRequest}/reviews`),
).map(
  (/** @type {{ body: string | null, submitted_at: string | null, commit_id: string | null }} */ review) => ({
    body: review.body,
    submittedAt: review.submitted_at,
    commitId: review.commit_id,
  }),
);
const labelled = pull.labels.some(
  (/** @type {{ name: string }} */ label) => label.name === config.labels.approved,
);
const flagged = pull.labels.some(
  (/** @type {{ name: string }} */ label) =>
    label.name === config.labels.changesRequested,
);

// A promotion pull request's head branch is the integration/promotion branch
// itself, not an individually claimed `agent/<issue>-slug` branch. See the
// PROMOTION PULL REQUESTS note above.
// A snapshot promotion head (`promotion/release-2026-08-09`) is recognised only
// once its head commit is shown to be contained in the branch it names — see
// the PROMOTION PULL REQUESTS note in `provenance.mjs`. GitHub's compare
// endpoint is the authority: `base...head` reports `identical` or `behind`
// exactly when `head` is already an ancestor of `base`. A compare this run
// cannot read is not evidence of containment, so it is treated as absent and
// the exemption is withheld.
/** @param {string} branch */
const headContainedIn = (branch) => {
  try {
    const comparison = JSON.parse(
      run("gh", "api", `repos/${repository}/compare/${branch}...${head}`),
    );

    return comparison.status === "identical" || comparison.status === "behind";
  } catch {
    return false;
  }
};

const promotion = isPromotionBranch(pull.headRefName, config, {
  baseRefName: pull.baseRefName ?? null,
  containedIn: headContainedIn,
});

// A Dependabot pull request has no authoring agent session either.
// Judged on the pull request's author, never on its `dependabot/` head branch
// — see the DEPENDABOT PULL REQUESTS note above.
const botAuthored = isDependabotAuthor(pull.author);

// The two shapes that legitimately have no individually claimed author, and so
// take the pull-request-bound path below: the verdict binds to the pull request
// number and head SHA rather than to a claimed issue, and the self-review guard
// is skipped because there is no worker identity for it to compare against.
// Everything else — head-SHA binding, the replay/nonce defence, the contested
// approve rule, stale-label handling — is unchanged for both.
const unclaimed = promotion || botAuthored;

// The linked issue carries the claim comment, which is the only record of which
// agent session produced the branch under review.
const linkedIssues = linkedIssuesOf(pull.body);
const branchIssue = branchIssueOf(pull.headRefName, config.branchPrefix);

// Every issue that could carry this branch's claim comment. A pull
// request closing several issues has several candidate claimants, and the
// self-review guard needs all of them: refusing the whole pull request as
// ambiguous left a completed review with nowhere to put its verdict, while
// picking one would compare the reviewer against only one of the sessions that
// might have authored the branch.
//
// The branch name is still the stronger signal — `claim.mjs` writes it at
// claim time and it cannot be edited afterwards, whereas the pull request body
// can — so it leads the list and a body pointing away from it is refused
// outright by `authorshipIssues`.
const authorship = authorshipIssues({ linkedIssues, branchIssue });
const authorIssues = authorship.ok ? authorship.issues : [];

// The issue `status:changes-requested` is reconciled against. `null` for a promotion or Dependabot pull request,
// which has no linked issue at all, and for a pull request whose authoring
// issue is unresolvable —
// `record` refuses that case outright below, so the fallback only matters to
// `check`, which never reconciles this label.
const flagIssue = (() => {
  if (unclaimed) return null;
  const recordable = recordableIssue({ linkedIssues, branchIssue });
  return recordable.ok ? recordable.issue : null;
})();

// The claimant of every candidate authoring issue, in branch-first order and
// keeping which issue each came from so a refusal can name it. Read once and
// reused by both subcommands: `record` refuses when the reviewer is anywhere
// in this list, and `check` treats an approve from anyone in it as
// self-approval.
/** @type {{ issue: string, agent: string }[] | null} */
let claimsCache = null;
const workerClaims = () =>
  (claimsCache ??= authorIssues.flatMap((issue) => {
    const agent = claimant(
      JSON.parse(run("gh", "issue", "view", issue, "--json", "comments"))
        .comments,
    );

    return agent ? [{ issue, agent }] : [];
  }));

const workerAgents = () => [
  ...new Set(workerClaims().map((claim) => claim.agent)),
];

/** @param {boolean} present */
const setLabel = (present) =>
  run(
    "gh",
    "pr",
    "edit",
    pullRequest,
    present ? "--add-label" : "--remove-label",
    config.labels.approved,
  );

// Reconciles `status:changes-requested` on the pull request and its authoring
// issue, in the same run that `setLabel` writes `review:approved`.
//
// Done here, in the reviewer's own run, rather than left to a CI workflow
// reacting to the review afterwards. `record` writes `review:approved` in
// seconds from the reviewer's machine; a workflow waiting on a shared runner
// can lag it by minutes, and in that window a pull request carries
// `review:approved` and `status:changes-requested` at once, so a merger reading
// labels rather than the reviews API cannot tell which is current.
//
// A repository that also runs a CI writer for this is not in conflict with
// this one: both derive the same answer from the same head-bound verdict and
// both are idempotent, so whichever runs second finds nothing to do. Such a
// workflow is still the only backstop for what `record` cannot see — a
// hand-submitted review, or a push with no accompanying review, which leaves
// the label lagging the head.
/** @param {boolean} present */
const setChangesRequested = (present) => {
  const label = config.labels.changesRequested;
  const edit = present ? "--add-label" : "--remove-label";

  if (present !== flagged) {
    run("gh", "pr", "edit", pullRequest, edit, label);
  }

  if (!flagIssue) return;

  // Read fresh rather than inferring from the pull request: the two carry the
  // label independently, and a claim release can move one without the other.
  const issueLabels = JSON.parse(
    run("gh", "issue", "view", flagIssue, "--json", "labels"),
  ).labels;

  const onIssue = (issueLabels ?? []).some(
    (/** @type {{ name: string }} */ entry) => entry.name === label,
  );

  if (present !== onIssue) {
    run("gh", "issue", "edit", flagIssue, edit, label);
  }
};

if (command === "record") {
  const agentId = value("--agent-id");
  const verdict = value("--verdict");
  const notes = values("--note");
  const supersedes = value("--supersedes");
  // self-declared by a reviewing subagent, naming the session that
  // dispatched it. Optional — a top-level session recording its own verdict
  // has nothing to name here — but when present it is checked against the
  // branch's author exactly like `agentId` is below, so a subagent dispatched
  // by the authoring session cannot stand in for an independent reviewer.
  const dispatchedBy = value("--dispatched-by");

  if (!agentId || !verdict || !VERDICTS.has(verdict)) {
    fail(usage);
  }

  // An id carrying a newline or a comment delimiter would truncate the value
  // recorded in the block, so the reviewer named in the verdict could differ
  // from the one the guard below checked.
  if (!SAFE_AGENT_ID.test(agentId)) {
    fail(
      `Agent id \`${agentId}\` must match ${SAFE_AGENT_ID}: letters, digits, ` +
        "dot, underscore, and hyphen only.",
    );
  }

  if (dispatchedBy !== undefined && !SAFE_AGENT_ID.test(dispatchedBy)) {
    fail(
      `--dispatched-by \`${dispatchedBy}\` must match ${SAFE_AGENT_ID}: letters, ` +
        "digits, dot, underscore, and hyphen only.",
    );
  }

  // refuse a fresh approve that would silently override another
  // reviewer's unaddressed request-changes at this exact head. Checked before
  // the self-review/identity guards below, since the contest is about two
  // reviewers disagreeing rather than about who authored the branch, and it
  // applies identically to promotion pull requests, which have no
  // worker identity but carry the same two-reviewers-at-one-head shape
  //.
  /**
   * @param {typeof reviews} candidateReviews
   * @returns {string | null}
   */
  const refuseIfContested = (candidateReviews) => {
    if (verdict !== "approve") return null;

    const contest = resolveContestedApprove({
      reviews: candidateReviews,
      head,
      pr: unclaimed ? pullRequest : undefined,
      agentId,
      supersedes,
      hasNote: notes.length > 0,
    });

    if (contest.status === "clear") return contest.supersedes;

    if (contest.status === "missing-note") {
      fail(
        "--supersedes requires at least one --note explaining why the named " +
          "dissent no longer applies.",
        EXIT.usage,
      );
    }

    if (contest.status === "unknown-supersede") {
      fail(
        `--supersedes ${supersedes} does not name an unsuperseded request-changes ` +
          `verdict from another reviewer at ${head}. Check the issued nonce and try again.`,
        EXIT.usage,
      );
    }

    const [dissent] = contest.dissents;
    fail(
      `Refusing to record an approve for #${pullRequest}: agent \`${dissent.reviewer}\` ` +
        `recorded request-changes at ${head} (issued \`${dissent.issued}\`) and it has not ` +
        "been superseded. Read that dissent, then re-run with " +
        `--supersedes ${dissent.issued} --note "<why it no longer applies>" to proceed over ` +
        "it, or stand down if it still stands.",
      EXIT.contested,
    );
  };

  const supersedeNonce = refuseIfContested(reviews);

  // Promotion and Dependabot pull requests have no linked issue
  // and no claim comment to read, and that is expected rather than an error —
  // skip straight to recording. There is no worker identity for a self-review
  // guard to compare the reviewer against, so there is nothing for it to guard.
  if (!unclaimed) {
    // The branch name alone is enough. A partial delivery that deliberately
    // says `Refs #N` rather than `Closes #N` is legitimate, and refusing to
    // review it only blocks the tool. Genuine ambiguity is still
    // refused.
    // Several referenced issues is no longer a refusal: the guard
    // below reads every one of their claims and refuses if the reviewer is
    // among them, which is the self-review guarantee stated exactly.
    if (!authorship.ok) {
      fail(
        {
          mismatch:
            `Branch \`${pull.headRefName}\` was claimed for issue #${branchIssue}, ` +
            `but the pull request body links ` +
            `${linkedIssues.map((issue) => `#${issue}`).join(", ")}. Refusing to ` +
            "record a verdict against a mismatched claim.",
          unidentifiable:
            `Pull request #${pullRequest} has no \`Closes #<issue>\` reference and ` +
            `its branch \`${pull.headRefName}\` does not name a claimed issue, so ` +
            "the authoring session cannot be identified and no verdict can be " +
            "recorded.",
        }[authorship.reason],
        EXIT.unidentifiable,
      );
    }

    const workers = workerAgents();

    if (workers.length === 0) {
      fail(
        `${authorIssues.map((issue) => `Issue #${issue}`).join(" and ")} ` +
          `${authorIssues.length > 1 ? "have" : "has"} no Rallypoint claim ` +
          "comment, so the authoring session cannot be identified and no " +
          "verdict can be recorded.",
        EXIT.unidentifiable,
      );
    }

    // The issue whose claim names this id, whichever of the referenced issues
    // it sits on.
    const claimedBy = (/** @type {string} */ id) =>
      workerClaims().find((claim) => claim.agent === id)?.issue;

    if (workers.includes(agentId)) {
      fail(
        `Refusing to record a verdict: agent \`${agentId}\` claimed issue ` +
          `#${claimedBy(agentId)} and authored this branch. Never review your ` +
          "own work.",
        EXIT.selfReview,
      );
    }

    // a subagent's own id is distinct by construction, so the check
    // above never catches a subagent dispatched by the authoring session to
    // perform its own review — which is exactly the failure this guard exists for. The
    // reviewing session declares its dispatching parent with
    // `--dispatched-by`, and when that parent is the branch's own author this
    // is self-review by another name, refused the same way and with the same
    // exit code.
    if (dispatchedBy && workers.includes(dispatchedBy)) {
      fail(
        `Refusing to record a verdict: agent \`${agentId}\` was dispatched by ` +
          `\`${dispatchedBy}\`, which claimed issue #${claimedBy(dispatchedBy)} and authored ` +
          "this branch. A subagent dispatched by the authoring session is not an " +
          "independent reviewer. Never review your own work.",
        EXIT.selfReview,
      );
    }
  }

  // A note containing comment delimiters would forge a second block in this
  // body, which the parser rejects wholesale. Escape them so a reviewer cannot
  // invalidate their own verdict by quoting one; both render as written.
  /** @param {string} note */
  const sanitise = (note) =>
    note.replaceAll("<!--", "&lt;!--").replaceAll("-->", "--&gt;");

  // A fresh nonce per recording. A replay copies the block verbatim, nonce
  // included, so it is detectable as a duplicate — while a reviewer genuinely
  // re-recording at the same head gets a new one and is not.
  const issued = `${new Date().toISOString()}-${randomUUID().slice(0, 8)}`;

  const body = [
    `<!-- ${MARKER}`,
    `verdict: ${verdict}`,
    `head: ${head}`,
    // Binds the verdict to this specific pull request in addition to the head
    // SHA, so it cannot be read as belonging to a different promotion pull
    // request that happens to share a head.
    ...(unclaimed ? [`pr: ${pullRequest}`] : []),
    // Present only when this approve was cleared through `--supersedes`
    //: names the `issued` nonce of the dissent it overrides, so
    // `check` can tell this apart from an uncontested approve.
    ...(supersedeNonce ? [`supersedes: ${supersedeNonce}`] : []),
    `reviewer: ${agentId}`,
    // Present whenever the reviewer declared one, regardless of
    // verdict — provenance the audit can read even off a request-changes,
    // not only an approve.
    ...(dispatchedBy ? [`dispatched-by: ${dispatchedBy}`] : []),
    `issued: ${issued}`,
    "-->",
    "",
    verdict === "approve"
      ? `**Approved** at \`${head.slice(0, 7)}\` by Rallypoint agent \`${agentId}\`.`
      : `**Changes requested** at \`${head.slice(0, 7)}\` by Rallypoint agent \`${agentId}\`.`,
    ...(supersedeNonce
      ? [
          "",
          `Supersedes the request-changes verdict issued \`${supersedeNonce}\` from ` +
            "another reviewer at this head.",
        ]
      : []),
    "",
    ...notes.map((note) => `- ${sanitise(note)}`),
    "",
    unclaimed
      ? `Recorded by \`review.mjs\` against a ${
          promotion
            ? "promotion pull request"
            : "Dependabot pull request"
        }, which ` +
        "has no individually claimed author. This verdict is bound to this " +
        "pull request and the head SHA above, and is invalidated by any new push."
      : "Recorded by `review.mjs`. GitHub cannot accept a formal review event here " +
        "because the reviewer and the author share one identity. This " +
        "verdict is bound to the head SHA above and is invalidated by any new push.",
  ].join("\n");

  if (flag("--dry-run")) {
    console.log(body);
    const target = flagIssue
      ? `#${pullRequest} and issue #${flagIssue}`
      : `#${pullRequest}`;

    console.log(
      `\n(dry run: would ${verdict === "approve" ? "add" : "remove"} ` +
        `\`${config.labels.approved}\` on #${pullRequest}, and ` +
        `${verdict === "approve" ? "remove" : "add"} ` +
        `\`${config.labels.changesRequested}\` on ${target})`,
    );
    process.exit(0);
  }

  // GitHub stamps a review with the head at the moment it posts. If the branch
  // moved since the body was composed, the recorded `head` and GitHub's
  // `commit_id` would disagree and the parser would silently drop the verdict
  // while this command reported success.
  const headNow = JSON.parse(
    run("gh", "pr", "view", pullRequest, "--json", "headRefOid"),
  ).headRefOid;

  if (headNow !== head) {
    fail(
      `#${pullRequest} moved from ${head} to ${headNow} while this verdict was ` +
        "being written. Nothing was recorded — re-review the new revision.",
      EXIT.raced,
    );
  }

  // re-checked against a fresh read of the reviews, immediately before
  // posting, alongside the head-race guard above. A dissent another reviewer
  // posted while this verdict was being composed must not slip through the
  // window between the check at the top of this command and the write below
  // — it fails the same way, having written nothing.
  if (verdict === "approve") {
    const freshReviews = JSON.parse(
      run(
        "gh",
        "api",
        "--paginate",
        `repos/${repository}/pulls/${pullRequest}/reviews`,
      ),
    ).map(
      (/** @type {{ body: string | null, submitted_at: string | null, commit_id: string | null }} */ review) => ({
        body: review.body,
        submittedAt: review.submitted_at,
        commitId: review.commit_id,
      }),
    );

    refuseIfContested(freshReviews);
  }

  run("gh", "pr", "review", pullRequest, "--comment", "--body", body);

  // Confirm GitHub recorded the verdict against the revision it names, rather
  // than trusting that the post landed where it was aimed.
  // Paginated: without it the just-posted review falls off the first page on a
  // pull request with thirty or more reviews, and this check would report a
  // failure for a verdict that landed correctly.
  const posted = JSON.parse(
    run(
      "gh",
      "api",
      "--paginate",
      `repos/${repository}/pulls/${pullRequest}/reviews`,
    ),
  ).findLast(
    (/** @type {{ body: string | null, commit_id: string | null }} */ review) =>
      (review.body ?? "").includes(issued),
  );

  if (!posted || posted.commit_id !== head) {
    fail(
      `Recorded a verdict on #${pullRequest}, but GitHub stamped it against ` +
        `${posted?.commit_id ?? "an unknown revision"} rather than ${head}. ` +
        "The verdict will not be honoured; re-review the current revision.",
      EXIT.raced,
    );
  }

  // Both label writes sit after the head-race guard and the `commit_id`
  // confirmation above: nothing is reconciled unless the verdict actually
  // posted against the revision it names.
  if (verdict === "approve") {
    if (!labelled) setLabel(true);
    setChangesRequested(false);
    console.log(`Recorded approve for #${pullRequest} at ${head}.`);
  } else {
    if (labelled) setLabel(false);
    setChangesRequested(true);
    console.log(`Recorded request-changes for #${pullRequest} at ${head}.`);
  }

  process.exit(0);
}

// `check` verifies; only `record` grants. The one mutation it may perform is
// removing a label that no longer has a verdict behind it, so no path through
// this command can produce an approval that a reviewer did not record.
//
// Promotion and Dependabot pull requests have no worker
// identity to check independence against, so they resolve through
// `resolvePromotionApproval` instead — despite the name it is the generic
// pull-request-bound reader: approved or not, with no
// self-approval/unknown-author distinction to draw. Everything downstream of
// that branch — the legacy-verdict guard, `--strip-stale`, and the exit codes
// for "stale" versus "no verdict" — is unchanged and applies identically to
// every pull request shape.
// Every claimant of every referenced issue. An approve from any of
// them is a self-approval; the first is what the messages below name, since a
// pull request closing several issues is still one branch with one author in
// the ordinary case.
const workers = unclaimed ? [] : workerAgents();
const worker = workers.at(0) ?? null;
let { approved, selfApproved, unidentifiedWorker, reviewer, supersedes: contestedSupersedes } =
  unclaimed
    ? {
        ...resolvePromotionApproval({ reviews, head, pr: pullRequest }),
        selfApproved: false,
        unidentifiedWorker: false,
      }
    : resolveApproval({ reviews, head, worker: workers });

// Carry-forward: only worth asking when nothing was recorded at this
// exact head at all. A verdict AT the head — approve or request-changes —
// stands on its own; there is no carry-forward question to ask, and asking
// it anyway would let a stale request-changes at some earlier SHA outrank a
// fresh one. Promotion pull requests are out of scope: their head branch IS
// the integration branch, so "the branch merged the integration branch in"
// is not a shape that arises for them the way it does for a claimed issue
// branch. Dependabot pull requests are out of scope for a different reason:
// the carry-forward approve path below requires an identified `worker` to
// clear its independence check, and a bot-authored pull request has none, so
// it could never reach an approve here anyway.
let carriedApprove = false;
let carriedRequestChanges = false;
/** @type {string | null} */
let carrySourceSha = null;

if (!unclaimed && !approved && !parseVerdicts(reviews).some((entry) => entry.sha === head)) {
  const integrationRef = resolveIntegrationRef();

  if (integrationRef) {
    const outcome = resolveCarryForward({
      reviews,
      head,
      integrationRef,
      git: realGit,
    });

    if (outcome.carried && outcome.verdict === "approve") {
      // The same independence guarantee a fresh approve gets: an unknown or
      // self-authored reviewer must not unlock a merge just because the
      // verdict arrived via carry-forward instead of directly. Reusing that
      // check here is what keeps this a genuine extension of the existing
      // guarantee rather than a second, weaker path to the same label. The subagent rule
      // extends it the same way `resolveApproval` was extended: a carried
      // verdict recorded by a subagent of the branch's author is no more
      // independent than one recorded by the author directly.
      const carriedSelfApproved =
        workers.length > 0 &&
        (workers.includes(/** @type {string} */ (outcome.reviewer)) ||
          (outcome.dispatchedBy != null &&
            workers.includes(outcome.dispatchedBy)));

      if (worker && !carriedSelfApproved) {
        approved = true;
        selfApproved = false;
        unidentifiedWorker = false;
        reviewer = outcome.reviewer;
        carriedApprove = true;
        carrySourceSha = outcome.sourceSha;
      } else {
        selfApproved = carriedSelfApproved;
        unidentifiedWorker = !worker;
        reviewer = outcome.reviewer;
      }
    } else if (outcome.carried && outcome.verdict === "request-changes") {
      carriedRequestChanges = true;
      carrySourceSha = outcome.sourceSha;
      reviewer = outcome.reviewer;
    }
  }
}

if (approved) {
  // `carriedApprove` is only ever set alongside `carrySourceSha`, but that
  // relationship lives across two variables, not in one's type, so it is
  // asserted here rather than narrowed automatically.
  const carriedFrom = /** @type {string} */ (carrySourceSha);
  // reporting only — a direct approve recorded with `--supersedes`
  // over another reviewer's dissent is still mergeable, exactly like a plain
  // approve, but distinct enough to be worth a merger or an orchestrator
  // survey seeing at a glance. Carry-forward is a separate mechanism with its
  // own pair of codes (10/11); a carried approve is reported as carried, not
  // as contested, even if the verdict it carries forward happened to
  // supersede something at its original head.
  const contested = !carriedApprove && Boolean(contestedSupersedes);
  console.log(
    carriedApprove
      ? `#${pullRequest} is approved: the approve verdict recorded at ` +
          `\`${carriedFrom.slice(0, 7)}\` by \`${reviewer}\` carries forward to the ` +
          `current head \`${head}\` because the branch's own contribution to ` +
          `${config.integrationBranch} is provably unchanged since (docs/AGENT_LOOP.md).`
      : contested
        ? `#${pullRequest} is approved at ${head} by \`${reviewer}\`, overriding a ` +
            `request-changes verdict (issued \`${contestedSupersedes}\`) it explicitly superseded.`
        : `#${pullRequest} is approved at ${head} by \`${reviewer}\`.`,
  );
  if (!labelled) {
    console.error(
      `Warning: \`${config.labels.approved}\` is missing despite a valid verdict. ` +
        "Re-run `record` to restore it.",
    );
  }
  process.exit(carriedApprove ? EXIT.carriedApprove : contested ? EXIT.contestedApprove : 0);
}

const [reason, code] = carriedRequestChanges
  ? [
      `the most recent verdict is request-changes, recorded at ` +
        `\`${/** @type {string} */ (carrySourceSha).slice(0, 7)}\` by \`${reviewer}\`, and ` +
        `the branch's own contribution to ${config.integrationBranch} is provably ` +
        "unchanged since — the requested changes are still outstanding, not unreviewed",
      EXIT.carriedRequestChanges,
    ]
  : selfApproved
    ? [
        // `reviewer` may itself differ from `worker` when this is a
        // lineage match rather than a direct one — the verdict was recorded
        // by a subagent `worker` dispatched, not by `worker` itself. Say so
        // precisely rather than implying the two ids were the same.
        // with several referenced issues there is a set of claimants
        // rather than one, so the match is membership rather than equality.
        reviewer != null && workers.includes(reviewer)
          ? `the approve verdict at ${head} came from \`${reviewer}\`, who authored the branch`
          : `the approve verdict at ${head} came from \`${reviewer}\`, dispatched by a ` +
            `session that authored the branch (one of ${workers.map((id) => `\`${id}\``).join(", ")}) ` +
            "— not an independent review",
        EXIT.selfApproved,
      ]
    : unidentifiedWorker
      ? [
          `the branch author cannot be identified, so the approve verdict at ${head} ` +
            "cannot be shown to be independent",
          EXIT.unknownAuthor,
        ]
      : [`no approve verdict exists at ${head}`, EXIT.noVerdict];

// A review this script cannot read is not evidence of absence. Hand-recorded
// verdicts from before the script existed look exactly like this, and clearing
// the label would destroy a real approval rather than a stale one.
if (labelled && !flag("--force") && legacyVerdictAtHead(reviews, head)) {
  console.error(
    `#${pullRequest} carries \`${config.labels.approved}\` and has a review at ` +
      `${head} that this script cannot read — most likely a verdict recorded ` +
      "before `review.mjs` existed. Refusing to clear the label automatically. " +
      "Read the review, then either re-record the verdict with `record`, or " +
      "rerun with --force to clear it anyway.",
  );
  process.exit(EXIT.unreadable);
}

if (labelled) {
  if (flag("--strip-stale")) {
    setLabel(false);
    console.error(
      `Removed a stale \`${config.labels.approved}\` label from #${pullRequest}: ${reason}.`,
    );
  } else {
    console.error(
      `#${pullRequest} carries \`${config.labels.approved}\` but ${reason}. ` +
        "Re-run with --strip-stale to clear it.",
    );
    process.exit(EXIT.staleLabel);
  }
}

console.error(`#${pullRequest} is not approved: ${reason}.`);
process.exit(code);
