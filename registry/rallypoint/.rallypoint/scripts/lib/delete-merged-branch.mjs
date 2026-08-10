// Deleting a merged issue branch from origin, with every call to `gh` and
// `git` injected.
//
// This exists because **no merge in this repository has ever cleaned up after
// itself**: 421 of the 461 `agent/*` branches on origin were merged and
// still there. Three findings, each measured on a live merge, shape every
// decision below.
//
// 1. **`gh pr merge --delete-branch` couples the two deletes, and the local one
//    fails first.** A merger runs minutes after its worker, so the worker's
//    worktree is by definition still checked out on the branch:
//    `git branch -d` answers "cannot delete branch … used by worktree at …",
//    `gh pr merge` exits 1 there, and **never attempts the remote delete** —
//    which has no worktree dependency and would have succeeded. So the two
//    deletes are sequenced independently here, remote first, and the local one
//    is reported rather than fatal.
// 2. **`git push origin --delete` is not a usable fallback.** Any `git push`
//    fires this repository's `pre-push` hook, which is `pnpm run check` — lint,
//    typecheck, the full unit suite and a production build. Measured blowing
//    past two minutes without ever reaching the network. `pre-push` cannot
//    distinguish "pushing code" from "deleting a ref", so it taxes routine ref
//    maintenance at the price of a full build.
// 3. **The GitHub API ref delete works.** No hook, no worktree dependency, no
//    local state consulted. That is the mechanism used here.
//
// Two safety properties are load-bearing and each has its own test:
//
// - **Merge containment is judged only after `git fetch`.** A genuinely merged
//   branch reads as unmerged against stale remote-tracking refs, which is how
//   the caretaker gathering #1288's evidence was misled. The fetch is not an
//   optimisation; without it this refuses correct deletions.
// - **Only a branch carrying the configured branch prefix is ever deletable.**
//   `main`, `staging`, `release`, and every `rallypoint-claims/*` and
//   `rallypoint-sessions/*` ref fail that test by construction, so no argument,
//   typo, or surprising pull request payload can aim this at one.
//
// Everything below judges **the SHA the ref listing just returned**, never a
// ref *name*. A name is a level of indirection this script cannot afford:
//
// - `state === "MERGED"` is authoritative about the commit the pull request
//   merged, and about nothing else. A push to the branch after the merge — a
//   still-live worker session, a reopened follow-up, an older pull request
//   re-run — leaves commits on the ref that no merge ever contained. So the
//   `--pr` path compares `headRefOid` against the live ref's `object.sha` and
//   falls back to a containment check whenever they differ.
// - `origin/<branch>` is a remote-tracking ref, and a `git fetch` that exits 0
//   has not necessarily updated it (a non-default refspec, an odd remote
//   config). Judging containment against that name can read a stale ancestor as
//   `merged` while the live ref carries newer work — the one direction the
//   fetch note above calls dangerous. So containment is judged against the SHA.

import { matchingRefs } from "./release-claim.mjs";

// Exit codes are a public interface, as they are for `cleanup.mjs` and
// `review.mjs`. Keep them in sync with the table in docs/AGENT_LOOP.md.
export const EXIT = {
  ok: 0,
  usage: 1,
  refused: 2, // not an issue branch, or not merged; nothing was deleted
  inconclusive: 3, // remote presence could not be established; no delete tried
  deleteFailed: 4, // ref was confirmed present but the delete failed
};

/**
 * The first informative line of a failure. `execFileSync` puts the useful part
 * on `stderr` and leaves `message` as the command line.
 *
 * @param {unknown} error
 */
export const describeError = (error) => {
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
  /** @param {string} flag */
  const value = (flag) => {
    const index = argv.indexOf(flag);
    return index === -1 ? undefined : argv[index + 1];
  };

  return { pr: value("--pr"), branch: value("--branch") };
};

/**
 * Whether a ref name is one this script is allowed to delete.
 *
 * Deliberately an allowlist on the configured branch prefix rather than a
 * denylist of protected names: a denylist has to anticipate every ref worth
 * protecting, and the reservation and session refs already outnumber the
 * branches it would have named.
 *
 * @param {string} branch
 * @param {{ branchPrefix: string }} config
 */
export const isDeletableBranch = (branch, config) =>
  typeof branch === "string" &&
  branch.startsWith(config.branchPrefix) &&
  branch.length > config.branchPrefix.length &&
  !branch.includes("..") &&
  !branch.endsWith("/");

/**
 * Whether the commit `sha` — the tip the ref listing reported for `branch` on
 * origin — is contained in the integration branch on origin.
 *
 * **Fetches first, always.** See the header: containment judged against stale
 * remote-tracking refs is wrong in the direction that refuses correct
 * deletions, and would be wrong in the dangerous direction if the test were
 * ever inverted.
 *
 * **Judged on `sha`, not on the name `origin/<branch>`**, for the reason the
 * header gives: a `git fetch` can exit 0 without moving the remote-tracking
 * ref, and then the name resolves to an older commit that reads `merged` while
 * the live ref carries unmerged work. A `sha` the fetch did not bring in is an
 * unknown revision, so `--is-ancestor` fails with a status other than 1 and
 * this answers `unknown` — the safe direction.
 *
 * @param {{
 *   git: (args: string[]) => string,
 *   branch: string,
 *   sha: string,
 *   integrationBranch: string,
 * }} input
 * @returns {{ kind: "merged" } | { kind: "unmerged" } | { kind: "unknown", reason: string }}
 */
export const mergeContainment = ({ git, branch, sha, integrationBranch }) => {
  if (typeof sha !== "string" || !/^[0-9a-f]{40}$/.test(sha)) {
    return {
      kind: "unknown",
      reason: `the ref listing reported no usable commit for \`${branch}\``,
    };
  }

  try {
    git(["fetch", "--quiet", "origin", branch, integrationBranch]);
  } catch (error) {
    // A branch already gone from origin cannot be fetched. That is not a
    // failure to establish containment — it is the desired end state, and the
    // caller's presence check reports it as already clean.
    return { kind: "unknown", reason: describeError(error) };
  }

  try {
    git(["merge-base", "--is-ancestor", sha, `origin/${integrationBranch}`]);
    return { kind: "merged" };
  } catch (error) {
    const detail = /** @type {{ status?: number }} */ (error ?? {});
    // `--is-ancestor` exits 1 for "no" and something else for "could not
    // answer". Conflating the two would let a broken repository read as a
    // clean refusal.
    if (detail.status === 1) return { kind: "unmerged" };
    return { kind: "unknown", reason: describeError(error) };
  }
};

/**
 * The tip commit of `branch` on origin, or that it is absent.
 *
 * Presence is established by listing, never inferred from a delete's failure —
 * a branch-scoped credential answers 403 whether or not the ref is there
 *, and an already-absent ref is a success, not a crash.
 *
 * Returns the SHA as well as the verdict, because every containment judgement
 * below is made against that SHA rather than against a ref name.
 *
 * @param {(...args: string[]) => string} gh
 * @param {string} repository
 * @param {string} branch
 * @returns {{ kind: "present", sha: string } | { kind: "absent" } | { kind: "unknown", reason: string }}
 */
export const remoteBranchTip = (gh, repository, branch) => {
  const refs = matchingRefs(gh, repository, branch);

  if (!refs.ok) return { kind: "unknown", reason: refs.reason };

  // `matching-refs` matches on prefix: asking for `agent/128-x` also returns
  // `agent/128-x-extra`. Only an exact hit is this branch, and taking a prefix
  // neighbour for one would delete somebody else's ref.
  const hit = refs.items.find((ref) => ref.ref === `refs/heads/${branch}`);

  if (!hit) return { kind: "absent" };

  return { kind: "present", sha: String(hit.object?.sha ?? "") };
};

/**
 * The branch a pull request merged, if it merged one, and the commit GitHub
 * recorded as its head.
 *
 * `headRefOid` is what makes the `--pr` path safe: `state === "MERGED"` says
 * the pull request's head at merge time went in, so it is evidence about that
 * commit and about no later one. Comparing it to the ref's live tip is how the
 * caller finds out whether it is still talking about the same commit.
 *
 * @param {(...args: string[]) => string} gh
 * @param {string} pr
 * @returns {{ ok: true, branch: string, merged: boolean, headSha: string } | { ok: false, reason: string }}
 */
export const pullRequestBranch = (gh, pr) => {
  try {
    // `state` and `mergedAt`, never a `merged` field: `gh pr view` rejects that
    // name outright ("Unknown JSON field") and the refusal arrives as an
    // unreadable pull request rather than as the usage error it is.
    const view = JSON.parse(
      gh("pr", "view", pr, "--json", "headRefName,headRefOid,state,mergedAt"),
    );
    return {
      ok: true,
      branch: String(view.headRefName ?? ""),
      merged: view.state === "MERGED" || Boolean(view.mergedAt),
      headSha: String(view.headRefOid ?? ""),
    };
  } catch (error) {
    return { ok: false, reason: describeError(error) };
  }
};

/**
 * Deletes the local branch if it exists, and reports what happened.
 *
 * **Never fatal, and deliberately runs after the remote delete.** A local
 * worktree still holding a just-merged branch is the normal state minutes after
 * a merge, not an error condition, and letting it decide the exit code is the
 * exact defect #1288 records.
 *
 * **`force` is exactly "this run proved the branch merged".** Where it did —
 * the remote ref was present and contained — `-D` is right, because `-d` judges
 * containment against this checkout's own possibly-stale `release` and would
 * refuse a branch already proved merged against origin.
 *
 * Where it did not, `-d` is the only safe verb. A remote ref that was already
 * absent proves nothing: `agent/<typo>` reads as absent, and so does a branch
 * whose work was never pushed anywhere at all. `-D` there destroys unmerged
 * commits on a lookup that never examined them, so this path asks git to make
 * its own containment judgement and accepts a refusal.
 *
 * @param {{ git: (args: string[]) => string, branch: string, force: boolean }} input
 * @returns {{ kind: "deleted" | "absent" | "retained", detail?: string }}
 */
export const deleteLocalBranch = ({ git, branch, force }) => {
  try {
    git(["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`]);
  } catch {
    return { kind: "absent" };
  }

  try {
    git(["branch", force ? "-D" : "-d", branch]);
    return { kind: "deleted" };
  } catch (error) {
    return { kind: "retained", detail: describeError(error) };
  }
};

/**
 * @param {{
 *   argv: string[],
 *   config: { branchPrefix: string, integrationBranch: string },
 *   gh: (...args: string[]) => string,
 *   git: (args: string[]) => string,
 *   stdout?: (line: string) => void,
 *   stderr?: (line: string) => void,
 * }} input
 * @returns {number} Process exit code.
 */
export const deleteMergedBranch = ({
  argv,
  config,
  gh,
  git,
  stdout = console.log,
  stderr = console.error,
}) => {
  const { pr, branch: branchFlag } = parseArgs(argv);

  if (!pr === !branchFlag) {
    stderr(
      "Usage: delete-merged-branch.mjs (--pr <merged-pull-request> | --branch <agent-branch>)",
    );
    return EXIT.usage;
  }

  /** @type {string} */
  let branch;
  // The commit a merged pull request vouches for, and only that commit. Empty
  // on the `--branch` path, where nothing vouches for anything yet.
  let mergedSha = "";

  if (pr) {
    const head = pullRequestBranch(gh, pr);
    if (!head.ok) {
      stderr(`Pull request #${pr} could not be read (${head.reason}).`);
      return EXIT.inconclusive;
    }
    if (!head.merged) {
      stderr(`Pull request #${pr} is not merged; \`${head.branch}\` retained.`);
      return EXIT.refused;
    }
    branch = head.branch;
    mergedSha = head.headSha;
  } else {
    branch = /** @type {string} */ (branchFlag);
  }

  if (!isDeletableBranch(branch, config)) {
    stderr(
      `\`${branch}\` does not carry the \`${config.branchPrefix}\` issue-branch prefix; refusing to delete it.`,
    );
    return EXIT.refused;
  }

  // Wrapped like every other `gh` call. Unwrapped, a transport or parse
  // failure threw out of this function and the process exited 1 — which the
  // exit-code table in docs/AGENT_LOOP.md publishes as "usage error", telling
  // the caller to fix its arguments about a problem in the network.
  /** @type {unknown} */
  let repository;

  try {
    repository = JSON.parse(gh("repo", "view", "--json", "nameWithOwner"))
      .nameWithOwner;
  } catch (error) {
    stderr(
      `The repository could not be identified (${describeError(error)}). No delete was attempted.`,
    );
    return EXIT.inconclusive;
  }

  if (typeof repository !== "string" || repository === "") {
    stderr(
      "The repository could not be identified (`gh repo view` reported no `nameWithOwner`). No delete was attempted.",
    );
    return EXIT.inconclusive;
  }

  const refPath = `refs/heads/${branch}`;

  const presence = remoteBranchTip(gh, repository, branch);

  if (presence.kind === "unknown") {
    stderr(
      `Whether \`${refPath}\` exists on origin could not be established (${presence.reason}). No delete was attempted.`,
    );
    return EXIT.inconclusive;
  }

  let exit = EXIT.ok;
  // Only a containment proof made in *this* run licenses `git branch -D`.
  let provedMerged = false;

  if (presence.kind === "absent") {
    // Checked before containment on purpose: a branch already gone from origin
    // is the end state this script exists to reach, and `git fetch` cannot
    // fetch it to prove anything about it. It is also why `provedMerged` stays
    // false here — absence is not evidence, and `agent/<typo>` is absent too.
    stdout(`\`${branch}\` is already absent from origin.`);
  } else {
    // The pull request vouches for one commit. Where the live ref still points
    // at it, that is the whole answer and the fetch buys nothing. Where it does
    // not — a push after the merge, a force-push, an older pull request re-run
    // — the pull request is evidence about a commit that is no longer there,
    // and the ref has to earn its own verdict.
    const vouchedFor = mergedSha !== "" && presence.sha === mergedSha;

    if (vouchedFor) {
      provedMerged = true;
    } else {
      if (mergedSha !== "") {
        stdout(
          `\`${branch}\` has moved since pull request #${pr} merged (${mergedSha.slice(0, 7)} → ${(presence.sha || "unknown").slice(0, 7)}); judging the live tip on its own.`,
        );
      }

      const containment = mergeContainment({
        git,
        branch,
        sha: presence.sha,
        integrationBranch: config.integrationBranch,
      });

      if (containment.kind === "unknown") {
        stderr(
          `Whether \`${branch}\` is merged into \`${config.integrationBranch}\` could not be established (${containment.reason}). No delete was attempted.`,
        );
        return EXIT.inconclusive;
      }

      if (containment.kind === "unmerged") {
        stderr(
          `\`${branch}\` is not contained in \`${config.integrationBranch}\`; refusing to delete it.`,
        );
        return EXIT.refused;
      }

      provedMerged = true;
    }

    try {
      // The mechanism, and the reason this script exists. Not
      // `git push --delete`: that fires `pre-push`, which is `pnpm run check`.
      gh("api", "--method", "DELETE", `repos/${repository}/git/${refPath}`);
      stdout(`Deleted \`${branch}\` from origin.`);
    } catch (error) {
      stderr(
        `\`${refPath}\` could not be deleted from origin (${describeError(error)}).`,
      );
      exit = EXIT.deleteFailed;
    }
  }

  // Strictly after the remote delete, and strictly non-fatal.
  const local = deleteLocalBranch({ git, branch, force: provedMerged });

  if (local.kind === "deleted") stdout(`Deleted local \`${branch}\`.`);
  if (local.kind === "retained") {
    stdout(
      provedMerged
        ? `Local \`${branch}\` retained (${local.detail}). Expected while a worktree still holds it; the remote is what matters.`
        : `Local \`${branch}\` retained (${local.detail}). Nothing on origin proved it merged, so it was offered to \`git branch -d\` rather than force-deleted.`,
    );
  }

  return exit;
};

export default deleteMergedBranch;
