// Local, unpushed evidence that a claimed issue still has a session behind it.
//
// ## Why this exists
//
// Every other liveness signal in this protocol is read from GitHub: the claim
// comment's age, an open pull request, the last push on `agent/<issue>-*`. All
// three are blind to the state that actually dominates a session's lifetime
// here — commits sitting in a local worktree that has not pushed yet. Workers
// on this repository run `pnpm run check` in `pre-push`, which on a loaded
// machine takes many minutes, so "claimed a while ago, nothing on the remote"
// is the *normal* signature of a healthy worker mid-session, not of an
// abandoned claim.
//
// #1308 is the measurement. A janitor pass at 2026-08-08T06:48Z found 3 of 3
// `janitorCandidate` claims were live work, and `release-claim.mjs`'s own dry
// run agreed with the report on all three:
//
// | Issue | Worktree                                  | Unpushed commits |
// | ----- | ----------------------------------------- | ---------------- |
// | #767  | `.claude/worktrees/agent-aa765a2808033c44a` | 8 (newest 06:47) |
// | #1282 | `.claude/worktrees/agent-ab63852b81280f090` | 2 (newest 06:48) |
// | #1275 | `.claude/worktrees/agent-abce6cb31d38f894f` | 1 (newest 06:48) |
//
// All three later pushed and opened pull requests.
// Unpushed commits are the one artefact in this repository with no second
// copy, so releasing a claim on top of them is the most expensive mistake the
// janitor can make.
//
// ## What this covers, and what it does not
//
// **This binds on one machine only.** `git worktree list` enumerates the
// worktrees of *this* checkout's repository, so the guard fires exactly when
// the janitor and the worker share a box. That is the case that occurred and
// the case this repository runs in today — orchestrator, janitor, and every
// worker are dispatched onto one host. A janitor on a different host reads no
// worktrees at all, gets a successful empty answer, and is left with the same
// GitHub-only evidence it had before; nothing here makes that observer safer.
// `docs/AGENT_LOOP.md` and `.rallypoint/roles/janitor.md` state the same limit
// where a janitor will read it.
//
// It is therefore a *guard*, not a fix for the signal. The general answer is a
// worker pushing early, which makes the evidence visible to every observer.
//
// ## What counts as evidence
//
// Two things, and both are about work that exists nowhere else:
//
// - **Commits the remote does not have.** Measured against the branch's own
//   remote-tracking ref when it has one, and against the integration branch
//   when it does not — a branch that was never pushed has no upstream, which is
//   precisely the state under investigation.
// - **Uncommitted changes.** A dirty tree is unrecoverable in a different way:
//   nothing in git holds it at all.
//
// Neither is aged. A worktree is not a timestamp, and treating an old commit as
// dead work would reintroduce the same guess this module exists to replace —
// the file is either there or it is not. The cost is that an abandoned worktree
// left behind on the box keeps refusing releases for its issue forever; that is
// deliberate, and the refusal names the path so an operator can delete it, or
// the holder can release its own claim with `--agent-id` (which skips every
// check here, per `isSelfRelease`).
//
// Following `lib/release-claim.mjs`'s rule exactly: a lookup that could not be
// established is never folded into "no local work". `git` failing is `ok:
// false`, which resolves to `unknown` and refuses the release.

/**
 * @template T
 * @typedef {{ ok: true, items: T[] } | { ok: false, reason: string }} Lookup
 */

/**
 * @typedef {{
 *   path: string,
 *   branch: string,
 *   unpushedCommits: number,
 *   comparedAgainst: string,
 *   uncommittedChanges: boolean,
 * }} LocalWork
 */

/**
 * `git worktree list --porcelain` emits one blank-line-separated block per
 * worktree, each opening with `worktree <path>` and carrying either
 * `branch refs/heads/<name>` or a bare `detached`. A detached worktree is
 * skipped: it names no issue, so nothing here can attribute its contents.
 *
 * @param {string} output
 * @returns {{ path: string, branch: string | null }[]}
 */
export const parseWorktrees = (output) => {
  /** @type {{ path: string, branch: string | null }[]} */
  const worktrees = [];
  /** @type {{ path: string, branch: string | null } | null} */
  let current = null;

  for (const raw of output.split("\n")) {
    const line = raw.trim();

    if (line.startsWith("worktree ")) {
      if (current) worktrees.push(current);
      current = { path: line.slice("worktree ".length), branch: null };
      continue;
    }

    if (current && line.startsWith("branch ")) {
      current.branch = line.slice("branch ".length).replace(/^refs\/heads\//, "");
    }
  }

  if (current) worktrees.push(current);
  return worktrees;
};

/**
 * The issue number a worktree's branch names, or `null`. Deliberately not
 * `provenance.branchIssue`: this reads a *local* branch name, which is
 * `claim.mjs`'s deterministic `agent/<issue>-<slug>` shape, and importing the
 * pull-request-facing helper here would tie a local check to a remote naming
 * rule that can move independently.
 *
 * @param {string | null} branch
 * @param {string} branchPrefix
 */
export const worktreeIssue = (branch, branchPrefix) => {
  if (!branch) return null;
  const escaped = branchPrefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return branch.match(new RegExp(`^${escaped}(\\d+)-`))?.[1] ?? null;
};

/**
 * @param {(args: string[], options?: { cwd?: string }) => string} git
 * @param {string} cwd
 * @param {string} ref
 */
const refExists = (git, cwd, ref) => {
  try {
    git(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], { cwd });
    return true;
  } catch {
    return false;
  }
};

/**
 * @param {unknown} error
 */
const describeError = (error) => {
  const detail = /** @type {{ stderr?: unknown, message?: unknown }} */ (
    error ?? {}
  );
  return (
    String(detail.stderr ?? detail.message ?? error ?? "")
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line !== "")
      ?.slice(0, 200) ?? "no detail reported"
  );
};

/**
 * Every local worktree holding work for `issue` that the remote does not have.
 *
 * An empty `items` from a successful read is proof this machine holds no such
 * work — which on a machine with no worktrees at all is the honest answer, and
 * is exactly why this guard is machine-local. Anything that could not be read
 * is `ok: false`.
 *
 * @param {{
 *   git: (args: string[], options?: { cwd?: string }) => string,
 *   issue: string,
 *   branchPrefix: string,
 *   integrationBranch: string,
 *   remote?: string,
 *   cwd?: string,
 * }} input
 * @returns {Lookup<LocalWork>}
 */
export const localIssueWork = ({
  git,
  issue,
  branchPrefix,
  integrationBranch,
  remote = "origin",
  cwd,
}) => {
  /** @type {{ path: string, branch: string | null }[]} */
  let worktrees;

  try {
    worktrees = parseWorktrees(git(["worktree", "list", "--porcelain"], { cwd }));
  } catch (error) {
    return {
      ok: false,
      reason: `local worktrees could not be listed (${describeError(error)}), so whether this machine holds unpushed work for #${issue} was not established`,
    };
  }

  /** @type {LocalWork[]} */
  const items = [];

  for (const worktree of worktrees) {
    if (worktreeIssue(worktree.branch, branchPrefix) !== issue) continue;

    const branch = /** @type {string} */ (worktree.branch);

    try {
      const tracking = `${remote}/${branch}`;
      // A branch that was never pushed has no remote-tracking ref, which is the
      // state under investigation rather than an error. The integration branch
      // is the right fallback: commits it does not contain are commits that
      // exist only here.
      const comparedAgainst = refExists(git, worktree.path, tracking)
        ? tracking
        : `${remote}/${integrationBranch}`;

      if (!refExists(git, worktree.path, comparedAgainst)) {
        return {
          ok: false,
          reason: `neither \`${tracking}\` nor \`${remote}/${integrationBranch}\` could be resolved in \`${worktree.path}\`, so the unpushed commits on \`${branch}\` were not established`,
        };
      }

      const counted = git(
        ["rev-list", "--count", `${comparedAgainst}..HEAD`],
        { cwd: worktree.path },
      );
      const unpushedCommits = Number.parseInt(counted.trim(), 10);

      if (!Number.isFinite(unpushedCommits)) {
        return {
          ok: false,
          reason: `the commit count for \`${branch}\` in \`${worktree.path}\` was unreadable (${counted})`,
        };
      }

      const uncommittedChanges =
        git(["status", "--porcelain"], { cwd: worktree.path }) !== "";

      if (unpushedCommits === 0 && !uncommittedChanges) continue;

      items.push({
        path: worktree.path,
        branch,
        unpushedCommits,
        comparedAgainst,
        uncommittedChanges,
      });
    } catch (error) {
      return {
        ok: false,
        reason: `\`${worktree.path}\` could not be inspected (${describeError(error)}), so whether it holds unpushed work for #${issue} was not established`,
      };
    }
  }

  return { ok: true, items };
};

/**
 * One sentence naming what was found and where, for a refusal a human has to
 * audit. The path is the point: it is what an operator needs to either wait for
 * the session, or delete the worktree and try again.
 *
 * @param {LocalWork[]} items
 * @param {string} issue
 */
export const describeLocalWork = (items, issue) =>
  items
    .map((item) => {
      const parts = [];
      if (item.unpushedCommits > 0) {
        parts.push(
          `${item.unpushedCommits} commit(s) not on \`${item.comparedAgainst}\``,
        );
      }
      if (item.uncommittedChanges) parts.push("uncommitted changes");
      return `\`${item.path}\` is on \`${item.branch}\` with ${parts.join(" and ")}`;
    })
    .join("; ")
    .concat(
      `. That work exists only on this machine, so releasing #${issue} would orphan it`,
    );

export default localIssueWork;
