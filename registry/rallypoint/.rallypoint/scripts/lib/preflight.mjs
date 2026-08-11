// Whether a pull request the worker is about to open would be reviewable.
//
// `review.mjs record` resolves a pull request to its authoring session through
// `recordableIssue({ linkedIssues, branchIssue })`, and exits 2 when neither the
// branch name nor a closing keyword resolves one — see provenance.mjs. That
// discovery is expensive after the fact: a branch name cannot change once a
// pull request is open without closing and reopening it, and until this
// command existed the defect surfaced only when a reviewer spent a pass on the
// diff and then found the verdict could not be written down.
//
// This module runs the same resolution `record` would, against the branch and
// body the worker is about to use, before either is fixed in place. It imports
// `provenance.mjs` rather than reimplementing the rules: a second parser would
// drift from the one a reviewer actually runs, and would then issue confident
// passes for pull requests `record` refuses.

import {
  authorshipIssues,
  branchIssue as branchIssueOf,
  claimant,
  isPromotionBranch,
  linkedIssues as linkedIssuesOf,
} from "../provenance.mjs";
import {
  closingReferenceDivergence,
  closureDrift,
  closureDriftMessage,
} from "./closing-references.mjs";

export const EXIT = {
  ok: 0,
  usage: 1,
  // Matches `review.mjs record`'s EXIT.unidentifiable: it also exits 2 for both
  // an unresolved authoring issue and a resolved issue with no claim comment.
  refused: 2,
  // Distinct from `refused`: the pull request would be reviewable, but it
  // would land against the wrong branch entirely. Nothing about the body or
  // branch issue resolution is at fault, so conflating this with `refused`
  // would send the reader looking in the wrong place.
  wrongBase: 3,
  // Distinct from `refused` for the same reason `wrongBase` is: on a detached
  // HEAD there is no branch name to judge at all, so reporting the
  // `unidentifiable` message would send the reader to fix a branch name that
  // is very likely already correct.
  detached: 4,
  // GitHub's closing-keyword parser would close an issue the pull request does
  // not declare. Distinct from every code above because nothing about the
  // branch, base, or authorship resolution is wrong — the pull request would be
  // perfectly reviewable, and would silently close an issue nobody asked it to.
  // Its own exit code so a caller can tell "unreviewable" from "reviewable and
  // destructive", which want different remedies from different people.
  closureDrift: 5,
};

// What `git rev-parse --abbrev-ref HEAD` prints when HEAD is detached. It is
// indistinguishable from a branch literally named `HEAD`, which git refuses to
// create, so treating it as the detached signal is unambiguous.
const DETACHED = "HEAD";

/**
 * The branch name a ref belongs to, or `undefined` for a ref that names none.
 * Remote-tracking refs are normalised to the branch they track, so a detached
 * checkout of a branch that exists only on the remote — the shape a session
 * that pushed with an explicit refspec is left in — resolves the same as a
 * local one.
 *
 * @param {string} ref
 */
const branchNameOf = (ref) => {
  if (ref.startsWith("refs/heads/")) return ref.slice("refs/heads/".length);
  if (!ref.startsWith("refs/remotes/")) return undefined;
  const withoutRemote = ref.slice("refs/remotes/".length).split("/");
  withoutRemote.shift();
  const branch = withoutRemote.join("/");
  // `refs/remotes/<remote>/HEAD` is the remote's default-branch symlink, not a
  // branch anybody works on.
  return branch && branch !== DETACHED ? branch : undefined;
};

/**
 * The branch a detached HEAD belongs to, inferred from the refs pointing at
 * the current commit.
 *
 * Anything short of exactly one candidate refuses rather than guessing, and a
 * lookup that threw refuses too — an error is not evidence that no branch
 * points here, the same rule `release-claim.mjs` and `report.mjs` state.
 *
 * @param {(...args: string[]) => string} git
 * @returns {{ ok: true, branch: string }
 *   | { ok: false, reason: "none" | "ambiguous" | "unreadable", candidates: string[] }}
 */
export const detachedBranch = (git) => {
  /** @type {string} */
  let output;

  try {
    output = git(
      "for-each-ref",
      "--format=%(refname)",
      "--points-at",
      "HEAD",
      "refs/heads",
      "refs/remotes",
    );
  } catch {
    return { ok: false, reason: "unreadable", candidates: [] };
  }

  const candidates = [
    ...new Set(
      output
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map(branchNameOf)
        .filter(
          /** @returns {branch is string} */ (branch) => branch !== undefined,
        ),
    ),
  ].sort();

  if (candidates.length === 1) return { ok: true, branch: candidates[0] };
  return {
    ok: false,
    reason: candidates.length ? "ambiguous" : "none",
    candidates,
  };
};

// Record and field separators for `git log --format`. ASCII 0x1e/0x1f cannot
// appear in a commit message written by any tool in this repository, and a
// newline-delimited format cannot work here because the messages themselves are
// multi-line — the narrated closure that caused this check was in a commit
// body, not a subject.
const RECORD = "\u001e";
const FIELD = "\u001f";

/**
 * The commits this pull request would contain: everything on the branch that
 * the base does not already have. That is exactly the set GitHub scans for
 * closing keywords, so a commit merged in *from* the base — somebody else's
 * message, which this session cannot reword and is not responsible for — is
 * excluded by construction rather than by a filter.
 *
 * `origin/<base>` is preferred over a local `<base>`: a session's worktree is
 * cut fresh and its local copy of the base branch, if it has one at all, is
 * whatever the clone happened to bring. A range that cannot be resolved returns
 * `null` and the caller reports the check as not run — an unreadable lookup is
 * not evidence that no commit closes anything, the rule `release-claim.mjs` and
 * `report.mjs` already state for their own lookups.
 *
 * @param {(...args: string[]) => string} git
 * @param {string} base
 * @returns {{ commits: { sha: string, message: string }[], range: string } | null}
 */
export const branchCommits = (git, base) => {
  for (const ref of [`origin/${base}`, base]) {
    /** @type {string} */
    let output;

    try {
      output = git(
        "log",
        `--format=%H${FIELD}%B${RECORD}`,
        `${ref}..HEAD`,
      );
    } catch {
      continue;
    }

    return {
      range: `${ref}..HEAD`,
      commits: output
        .split(RECORD)
        .map((record) => record.trim())
        .filter(Boolean)
        .map((record) => {
          const separator = record.indexOf(FIELD);
          return {
            sha: record.slice(0, separator),
            message: record.slice(separator + 1).trim(),
          };
        }),
    };
  }

  return null;
};

/**
 * What GitHub says an already-open pull request from this branch closes.
 *
 * `null` for the ordinary case — no pull request exists yet, which is when this
 * command is meant to be run — and `null` again for any failure, because the
 * caller only ever prints this and a failed lookup must not turn into a verdict.
 *
 * @param {(...args: string[]) => string} gh
 * @param {string} branch
 * @returns {{ number: number, issues: string[] } | null}
 */
export const githubClosingReferences = (gh, branch) => {
  try {
    const pull = JSON.parse(
      gh("pr", "view", branch, "--json", "number,closingIssuesReferences"),
    );

    if (typeof pull?.number !== "number") return null;

    /** @type {{ number?: unknown }[]} */
    const references = Array.isArray(pull.closingIssuesReferences)
      ? pull.closingIssuesReferences
      : [];

    return {
      number: pull.number,
      issues: references.flatMap((reference) =>
        typeof reference?.number === "number" ? [String(reference.number)] : [],
      ),
    };
  } catch {
    return null;
  }
};

/** @param {string[]} argv */
export const parseArgs = (argv) => {
  const bodyIndex = argv.indexOf("--body");
  const baseIndex = argv.indexOf("--base");
  return {
    body: bodyIndex === -1 ? undefined : argv[bodyIndex + 1],
    base: baseIndex === -1 ? undefined : argv[baseIndex + 1],
  };
};

/**
 * @param {{
 *   argv: string[],
 *   config: { branchPrefix: string, integrationBranch: string, promotionBranch?: string },
 *   git: (...args: string[]) => string,
 *   gh: (...args: string[]) => string,
 *   stdout?: (line: string) => void,
 *   stderr?: (line: string) => void,
 * }} input
 * @returns {number} Process exit code.
 */
export const preflight = ({
  argv,
  config,
  git,
  gh,
  stdout = console.log,
  stderr = console.error,
}) => {
  const { body, base } = parseArgs(argv);

  if (body === undefined || base === undefined) {
    stderr(
      'Usage: preflight.mjs --body "<prepared pull request body>" --base <intended base branch>',
    );
    return EXIT.usage;
  }

  // `rev-parse --abbrev-ref HEAD` prints the literal `HEAD` on a detached
  // checkout, and every rule below reads a branch *name*: `branchIssue` finds
  // no issue in it and `isPromotionBranch` is false for it, so an unguarded
  // run reports `unidentifiable` — a verdict about a branch that does not
  // exist, issued precisely in the situation that caused the detachment.
  // Detachment is routine here: every session gets its own worktree, and a
  // worktree that cannot check out the branch it needs has no other way
  // forward.
  const checkedOut = git("rev-parse", "--abbrev-ref", "HEAD");
  let branch = checkedOut;

  if (checkedOut === DETACHED) {
    const resolved = detachedBranch(git);

    if (!resolved.ok) {
      stderr(
        "HEAD is detached, so there is no checked-out branch to judge. " +
          {
            none: "No local or remote-tracking branch points at the current commit, so the branch this work belongs to cannot be inferred. Push it (`git push origin HEAD:refs/heads/<branch>`) or check it out, then run this again.",
            ambiguous: `Several branches point at the current commit (${resolved.candidates.map((candidate) => `\`${candidate}\``).join(", ")}), so which one this pull request would be opened from cannot be inferred. Check the intended branch out, then run this again.`,
            unreadable:
              "The refs pointing at the current commit could not be read, so the branch this work belongs to cannot be inferred. An unreadable lookup is not evidence that no branch points here.",
          }[resolved.reason],
      );
      return EXIT.detached;
    }

    branch = resolved.branch;
    stdout(
      `HEAD is detached; inferred branch \`${branch}\` from the refs pointing ` +
        "at the current commit.",
    );
  }

  const branchIssue = branchIssueOf(branch, config.branchPrefix);
  const linked = linkedIssuesOf(body);

  // Evidence for the snapshot promotion head shape. `merge-base
  // --is-ancestor` exits non-zero — so `git` throws — when HEAD is not
  // contained in the snapshotted branch, and it throws too when the
  // remote-tracking ref is missing. Both are "not shown to be contained",
  // which withholds the exemption rather than granting it on a name.
  const promotionEvidence = {
    baseRefName: base,
    /** @param {string} snapshotted */
    containedIn: (snapshotted) => {
      try {
        git(
          "merge-base",
          "--is-ancestor",
          "HEAD",
          `refs/remotes/origin/${snapshotted}`,
        );
        return true;
      } catch {
        return false;
      }
    },
  };

  stdout(`Branch: ${branch}`);
  stdout(`Branch issue: ${branchIssue ? `#${branchIssue}` : "(none)"}`);
  stdout(
    `Body links: ${linked.length ? linked.map((issue) => `#${issue}`).join(", ") : "(none)"}`,
  );
  // Read from config, not `gh repo view --json defaultBranchRef` and not a
  // hardcoded name: every pull request in this protocol targets the
  // integration branch, which the default branch is not guaranteed to be.
  stdout(`Base branch: ${config.integrationBranch}`);
  stdout(`Intended base: ${base}`);

  // Every pull request targets `integrationBranch`, except the two documented
  // promotion shapes (`release` -> `staging`, `staging` -> `main`), which
  // `review.mjs` recognises by head branch alone, not by base — a promotion's
  // base varies (`promotionBranch`, or whatever sits above it) while its head
  // is always `integrationBranch` or `promotionBranch`. Match that rule
  // exactly rather than reimplementing it, so this refuses precisely what
  // `review.mjs` would treat as a non-promotion pull request against the
  // wrong branch.
  if (
    base !== config.integrationBranch &&
    !isPromotionBranch(branch, config, promotionEvidence)
  ) {
    stderr(
      `This pull request would target \`${base}\`, but the configured ` +
        `integration branch is \`${config.integrationBranch}\`. Open it ` +
        `against \`${config.integrationBranch}\` instead, or, if this is a ` +
        `promotion, open it from \`${config.integrationBranch}\`` +
        (config.promotionBranch ? ` or \`${config.promotionBranch}\`` : "") +
        " so it is exempt.",
    );
    return EXIT.wrongBase;
  }

  // Everything below resolves an *authoring issue*, and a promotion pull
  // request has none: nobody runs `claim.mjs` against one, so it carries no
  // closing keyword and its head branch names no issue. `review.mjs record`
  // detects that from the head branch and binds the verdict to the pull
  // request number and head SHA instead, so it "never reaches `2` or `3`" for
  // a promotion (docs/AGENT_LOOP.md, "Promotion pull requests"). Running the
  // resolution anyway sent every promotion down the `unidentifiable` branch
  // and refused it with exit 2 — a refusal whose own message tells the reader
  // to add `Closes #<issue>`, which is exactly wrong here: a promotion closes
  // nothing, and a spurious closing keyword would make the `Close referenced
  // issues` workflow release the claim reservation of an unrelated issue.
  if (isPromotionBranch(branch, config, promotionEvidence)) {
    stdout(
      `Branch \`${branch}\` is a promotion branch, so this pull request is a ` +
        `promotion into \`${base}\`. It resolves to no authoring issue and ` +
        "needs none: `review.mjs record` binds a promotion's verdict to the " +
        "pull request number and head SHA. This pull request would be " +
        "reviewable.",
    );
    return EXIT.ok;
  }

  // `record` has a second authorless shape — a pull request whose
  // *author* is the Dependabot bot — and deliberately does not add one here.
  // This command judges a branch a session is about to open a pull request
  // from, and that session is never Dependabot: the bot opens its own pull
  // requests directly and runs nothing in this repository. So the author of
  // anything reaching this code is human or agent, `record` will not grant the
  // bypass to it, and the resolution below is exactly the answer `record`
  // gives. A `dependabot/`-prefixed branch checked out by a session therefore
  // falls through to `unidentifiable` here and to `EXIT.unidentifiable` there
  // — the two agree, which is the point. Recognising the prefix here would be
  // the one thing the Dependabot path rules out: a confident pass for a pull request
  // `record` would refuse.
  //
  // Several closing keywords is no longer a refusal in `record`, so it
  // must not be one here either — a preflight stricter than the thing it
  // predicts issues confident refusals for pull requests that would in fact
  // record fine, which is the same wasted pass in the other direction.
  const authorship = authorshipIssues({ linkedIssues: linked, branchIssue });

  if (!authorship.ok) {
    stderr(
      {
        mismatch: `Branch \`${branch}\` names issue #${branchIssue}, but the body links ${linked.map((issue) => `#${issue}`).join(", ")} and not #${branchIssue}. \`review.mjs record\` refuses a mismatch between the two.`,
        unidentifiable: `Branch \`${branch}\` does not name a claimed issue (expected \`${config.branchPrefix}<issue>-...\`), and the body has no \`Closes\`/\`Fixes\`/\`Resolves #<issue>\` reference either, so \`review.mjs record\` has nothing to resolve to.`,
      }[authorship.reason],
    );
    return EXIT.refused;
  }

  const claims = authorship.issues.flatMap((issue) => {
    const worker = claimant(
      JSON.parse(gh("issue", "view", issue, "--json", "comments")).comments,
    );

    return worker ? [{ issue, worker }] : [];
  });

  if (claims.length === 0) {
    stderr(
      `${authorship.issues.map((issue) => `#${issue}`).join(" and ")} ` +
        `${authorship.issues.length > 1 ? "resolve" : "resolves"}, but ` +
        `${authorship.issues.length > 1 ? "none carries" : "it carries no"} ` +
        "Rallypoint claim comment, so `review.mjs record` will still refuse " +
        "this pull request.",
    );
    return EXIT.refused;
  }

  stdout(
    `Resolves to ${claims
      .map((claim) => `issue #${claim.issue}, claimed by \`${claim.worker}\``)
      .join("; ")}. This pull request would be reviewable.`,
  );

  // Reviewable is not the same as correct. Everything above asks whether a
  // verdict could be written down for this pull request; this asks what merging
  // it would actually do to the board.
  //
  // It runs last because it is the only check here that can pass a pull request
  // the author must still change: the three above are about a pull request that
  // cannot be reviewed, and reporting "your branch is unresolvable" and "your
  // commit message closes a stranger's issue" in one breath buries the second.
  //
  // Placed in `preflight.mjs` rather than in a CI job because the commit-message
  // half has exactly one moment where it is cheap. A body can be edited after
  // the pull request is open; a message on a pushed branch takes a rebase and a
  // force-push, and once the pull request has merged the issue is already
  // closed and the remedy is a hand repair by an operator.
  const range = branchCommits(git, base);

  if (range === null) {
    stdout(
      `Commit messages: not checked — neither \`origin/${base}\` nor ` +
        `\`${base}\` could be resolved, so the commits this pull request would ` +
        "contain are unknown. GitHub reads them for closing keywords whether " +
        "or not this command could.",
    );
  } else {
    stdout(
      `Commit messages: ${range.commits.length} commit${range.commits.length === 1 ? "" : "s"} in \`${range.range}\``,
    );
  }

  // The already-open case (this command is normally run before the pull request
  // exists). Printed, never a refusal: GitHub is answering about the body
  // already on the pull request, while `--body` is the body about to replace it,
  // so the two differ by exactly the edit in progress.
  const open = githubClosingReferences(gh, branch);

  if (open !== null) {
    const { extra, missing } = closingReferenceDivergence({
      declared: linked,
      github: open.issues,
    });

    stdout(
      `GitHub says pull request #${open.number}, already open from this ` +
        `branch, closes ${open.issues.length ? open.issues.map((issue) => `#${issue}`).join(", ") : "(nothing)"}.`,
    );

    if (extra.length > 0 || missing.length > 0) {
      stdout(
        "  That differs from the prepared body" +
          (extra.length
            ? `; GitHub also closes ${extra.map((issue) => `#${issue}`).join(", ")}`
            : "") +
          (missing.length
            ? `; GitHub does not close ${missing.map((issue) => `#${issue}`).join(", ")}`
            : "") +
          ". If the prepared body is the one being posted, this resolves when " +
          "it is; if it is not, the difference is real and worth a look.",
      );
    }
  }

  const drift = closureDrift({
    body,
    declared: linked,
    commits: range?.commits ?? [],
  });

  if (drift.length > 0) {
    stderr(closureDriftMessage(drift, { declared: linked }));
    return EXIT.closureDrift;
  }

  stdout(
    "No closure drift: GitHub's parser would close nothing this pull request " +
      "does not declare.",
  );
  return EXIT.ok;
};

export default preflight;
