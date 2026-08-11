// Whether a review verdict recorded against an earlier head can still be
// treated as current after the head moved only because the integration
// branch was merged in — not because the branch's own work changed.
//
// `verdicts.mjs` binds a verdict to the exact head SHA it was recorded
// against, on purpose: any new push invalidates it. That is correct for a
// revision and wrong for a no-op merge, and the two look identical from the
// SHA alone. This module answers the question the SHA cannot: did the
// branch's *own* contribution — its diff against the integration branch —
// actually change between the reviewed head and the current one?
//
// Kept free of `gh` and of `process` state, like `verdicts.mjs`; `git` is
// injected so the decision is testable against real fixture repositories
// (see carry-forward.test.mjs) without a live checkout.
//
// FAIL CLOSED, deliberately harder than the rest of this file: every branch
// below that cannot positively prove "unchanged" returns `carried: false`.
// A wrong refusal costs a reviewer a redundant look. A wrong carry hands out
// an approval nobody gave to content nobody reviewed — the issue is explicit
// that the second is worse than the current over-strict behaviour.

import { parseVerdicts } from "./verdicts.mjs";

/**
 * @typedef {{
 *   body?: string | null,
 *   commitId?: string | null,
 *   submittedAt?: string | null,
 * }} Review
 */

/** @typedef {(args: string[], options?: { input?: string, cwd?: string }) => string} GitRunner */

// A non-empty diff whose `patch-id` still could not be read. `null` rather
// than an empty string or any other value that might accidentally equal
// itself across two independent "unreadable" results — `fingerprintsMatch`
// below treats `null` as never matching, including against another `null`.
export const UNREADABLE = null;

// The reviewed head contributed nothing beyond the integration branch at
// all — an empty diff is its own valid, comparable state, distinct from
// "unreadable".
export const EMPTY_CONTRIBUTION = "rallypoint:empty-contribution";

/**
 * A content fingerprint for what `head` has contributed beyond `base`
 * (ordinarily the merge-base between the branch and the integration branch).
 *
 * Deliberately NOT derived from the commit range `base..head` — `git log`
 * or `git rev-list` over that range depends on how the branch's history is
 * shaped, so reordering commits, folding in an empty commit, or reaching the
 * same content through a different sequence of merges would change that
 * output without changing what the branch actually contributed. A tree-level
 * `git diff base head` is a pure function of the two trees being compared —
 * it depends on nothing about the commit graph in between, so it cannot be
 * fooled by reordering or by an empty commit by construction, not merely by
 * this function's care.
 *
 * Piped through `git patch-id --stable` rather than compared as raw text,
 * because `base` itself moves every time the branch merges a newer
 * integration tip in. `git diff` renders hunks with surrounding context
 * lines and line numbers, so an unrelated integration change near a line the
 * branch touched shifts hunk boundaries between the reviewed diff and the
 * current one even when the branch's own edit is byte-identical. `patch-id`
 * strips line numbers and hashes each file's changed lines (plus a slice of
 * surrounding context) independently, then combines those hashes in an
 * order that does not depend on file order in the diff — normalising for
 * "the same patch, rebased onto a different base" while still changing the
 * moment the *content* differs.
 *
 * That last property is exactly the strictness this mechanism needs: it
 * means any integration-branch change that touches the same lines, the same
 * file near the branch's own hunks, or a conflict resolution that alters so
 * much as one changed line, changes the fingerprint — refusing the carry —
 * without this function having to separately detect "was there a conflict".
 * The failure mode it does not catch — a manual resolution that happens to
 * reproduce byte-identical hunks to the original — cannot be told apart from
 * "truly unchanged" by any content fingerprint, machine or human; it is the
 * same collision class any hash-equality check carries, and is accepted here
 * because ruling it out would require semantic diffing this script cannot
 * do.
 *
 * @param {{ git: GitRunner, base: string, head: string, cwd?: string }} input
 * @returns {string | typeof UNREADABLE}
 */
export const contributionFingerprint = ({ git, base, head, cwd }) => {
  let diff;
  try {
    diff = git(["diff", "--binary", `${base}`, `${head}`], { cwd });
  } catch {
    return UNREADABLE;
  }

  if (diff.trim() === "") return EMPTY_CONTRIBUTION;

  let patchId;
  try {
    patchId = git(["patch-id", "--stable"], { input: diff, cwd });
  } catch {
    return UNREADABLE;
  }

  // `git patch-id` prints "<id> <commit-or-zeros>" per patch. The diff we
  // feed it carries no commit metadata, so the second column is always the
  // all-zero placeholder; only the first token is the content hash. No
  // output at all for a non-empty diff is not a state this function trusts
  // itself to interpret, so it is unreadable rather than "changed" — the
  // caller-level comparison below refuses either way, so the distinction
  // only matters for callers that want to say why.
  const [id] = patchId.trim().split(/\s+/);
  return id || UNREADABLE;
};

/**
 * @param {string | typeof UNREADABLE} a
 * @param {string | typeof UNREADABLE} b
 */
const fingerprintsMatch = (a, b) => a !== UNREADABLE && b !== UNREADABLE && a === b;

/**
 * The set of files that differ between two trees. Used to prove the
 * acceptance criterion directly rather than leaving it to `patch-id`'s
 * context-sensitivity as a side effect: `git diff` renders only a few lines
 * of context around each hunk (three, by default), so two edits to the same
 * file that land far enough apart never appear in each other's context and
 * would not move the patch-id at all. A change the branch's own diff never
 * saw landing in a file it also touched is exactly the case the acceptance
 * criteria calls out by name ("the incoming merge touches files the branch
 * also touches"), so it is checked for explicitly and unconditionally below,
 * not inferred from a fingerprint mismatch that might not occur.
 *
 * This also subsumes "the merge required conflict resolution": a textual
 * merge conflict is only possible when both sides changed the same file (an
 * add/add, modify/modify, or modify/delete on it), so any topology that
 * needed manual resolution is, by construction, one this file-overlap check
 * already refuses — it does not need to be detected separately by
 * inspecting merge commit metadata that `--no-edit` or a bot-authored merge
 * commonly discards anyway.
 *
 * @param {{ git: GitRunner, base: string, head: string, cwd?: string }} input
 * @returns {Set<string> | null} `null` when the listing itself could not be
 *   established, so the caller can refuse rather than treat "empty" and
 *   "unknown" as the same thing.
 */
const touchedFiles = ({ git, base, head, cwd }) => {
  try {
    const output = git(["diff", "--name-only", `${base}`, `${head}`], { cwd });
    return new Set(output.split("\n").filter((line) => line.length > 0));
  } catch {
    return null;
  }
};

/** @param {{ git: GitRunner, ancestor: string, descendant: string, cwd?: string }} input */
const isAncestor = ({ git, ancestor, descendant, cwd }) => {
  try {
    git(["merge-base", "--is-ancestor", ancestor, descendant], { cwd });
    return true;
  } catch {
    // `merge-base --is-ancestor` exits non-zero both when it is false and
    // when a revision is unknown locally. Either way there is nothing to
    // carry forward against, so both collapse to the same refusal.
    return false;
  }
};

/** @param {{ git: GitRunner, a: string, b: string, cwd?: string }} input */
const mergeBase = ({ git, a, b, cwd }) => {
  try {
    return git(["merge-base", a, b], { cwd });
  } catch {
    return null;
  }
};

// The most recent verdict recorded anywhere on the pull request, restricted
// to the case where nothing was recorded at the exact current head. If there
// IS a verdict at head — approve or request-changes — it stands on its own
// merits and there is no carry-forward question to ask; that path is left to
// the ordinary `resolveApproval` logic in `verdicts.mjs`, unchanged.
/**
 * @param {{ reviews: Review[], head: string }} input
 */
export const priorVerdict = ({ reviews, head }) => {
  const all = parseVerdicts(reviews);
  if (all.some((entry) => entry.sha === head)) return null;
  return all.at(-1) ?? null;
};

/**
 * @typedef {(
 *   | { carried: false, reason: "none" | "not-ancestor" | "merge-base-unavailable" | "overlapping-files" | "contribution-changed" }
 *   | { carried: true, verdict: string, reviewer: string, sourceSha: string, dispatchedBy?: string }
 * )} CarryForwardOutcome
 */

/**
 * Decides whether the most recent verdict recorded on the pull request — at
 * some earlier head than the current one — carries forward to the current
 * head, because the branch's own contribution to `integrationRef` has
 * provably not changed since.
 *
 * Every refusal reason is deliberately generic rather than diagnosing
 * "overlapping file" versus "conflict resolution" versus "unrelated
 * revision" separately: the acceptance criteria this exists to satisfy asks
 * for refusal in all three, and telling them apart would need semantic
 * information (which lines conflicted, whether a merge driver ran) that a
 * content fingerprint does not carry and should not guess at.
 *
 * @param {{
 *   reviews: Review[],
 *   head: string,
 *   integrationRef: string,
 *   git: GitRunner,
 *   cwd?: string,
 * }} input
 * @returns {CarryForwardOutcome}
 */
export const resolveCarryForward = ({ reviews, head, integrationRef, git, cwd }) => {
  const candidate = priorVerdict({ reviews, head });

  if (!candidate) return { carried: false, reason: "none" };

  // Sanity-checked ahead of the content comparison: a carry-forward only
  // makes sense for a head that is a genuine descendant of the reviewed one.
  // Belt-and-suspenders alongside the fingerprint check below, not a
  // substitute for it — an unrelated history could coincidentally still be
  // fingerprint-identical (an empty branch diff on both sides, say), and this
  // catches that even though the fingerprint check alone would not.
  if (!isAncestor({ git, ancestor: candidate.sha, descendant: head, cwd })) {
    return { carried: false, reason: "not-ancestor" };
  }

  const reviewedBase = mergeBase({ git, a: candidate.sha, b: integrationRef, cwd });
  const currentBase = mergeBase({ git, a: head, b: integrationRef, cwd });

  if (!reviewedBase || !currentBase) {
    return { carried: false, reason: "merge-base-unavailable" };
  }

  // Files the branch itself changed, versus files the integration branch
  // changed while the branch was away. Any overlap means the merged tree
  // contains an interaction between the two that no reviewer saw — see the
  // comment on `touchedFiles` for why this also covers conflict resolution
  // without inspecting merge metadata directly.
  const branchFiles = touchedFiles({ git, base: reviewedBase, head: candidate.sha, cwd });
  const integrationAdvanceFiles = touchedFiles({
    git,
    base: reviewedBase,
    head: currentBase,
    cwd,
  });

  if (!branchFiles || !integrationAdvanceFiles) {
    return { carried: false, reason: "merge-base-unavailable" };
  }

  for (const file of branchFiles) {
    if (integrationAdvanceFiles.has(file)) {
      return { carried: false, reason: "overlapping-files" };
    }
  }

  const reviewedFingerprint = contributionFingerprint({
    git,
    base: reviewedBase,
    head: candidate.sha,
    cwd,
  });
  const currentFingerprint = contributionFingerprint({
    git,
    base: currentBase,
    head,
    cwd,
  });

  if (!fingerprintsMatch(reviewedFingerprint, currentFingerprint)) {
    return { carried: false, reason: "contribution-changed" };
  }

  return {
    carried: true,
    verdict: candidate.verdict,
    reviewer: candidate.reviewer,
    sourceSha: candidate.sha,
    // Threaded through so a caller's independence check (`review.mjs`'s
    // carry-forward branch) can catch a carried verdict that was recorded by
    // a subagent of the branch's author, the same as it already catches the
    // reviewer id matching directly.
    ...(candidate.dispatchedBy ? { dispatchedBy: candidate.dispatchedBy } : {}),
  };
};
