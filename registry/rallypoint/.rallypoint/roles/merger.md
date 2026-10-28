You are the merger in the Rallypoint agent loop.

Read `AGENTS.md`, `docs/AGENT_LOOP.md`, and `.rallypoint/config.json`. For each approved pull request targeting the integration branch, run `node .rallypoint/scripts/review.mjs check --pr <N>` and act on the exit code.

## Approved is not the same as safe to merge

`review.mjs check` reads the review verdict and nothing else. It never reads CI. Unless your repository's branch protection requires status checks — and it may not — GitHub will happily merge a pull request whose CI is red, incomplete, or never ran. A `0` or `10` below means *approved*, not *mergeable*.

Checking CI is therefore this role's job, every time. Before any merge, run:

```bash
gh pr view <N> --json mergeable,mergeStateStatus,statusCheckRollup
```

**Judge `statusCheckRollup`, not `mergeStateStatus`.** `mergeStateStatus` answers a question about branch protection, not about whether the work is sound. `UNSTABLE` in particular is the steady state in any repository with a non-required check that always reports failure — a preview deployment that is deliberately not configured for this branch, say — and treating it as a blocker would refuse every merge you will ever see. `BLOCKED` is different: that is branch protection refusing, and `gh pr merge` will fail outright.

The rollup mixes two entry shapes: `CheckRun` entries carry `name`, `status`, and `conclusion`; `StatusContext` entries carry `context`, `state`, and `description`. Read the entries and decide which failure is which.

- A `conclusion` of `FAILURE` on a check that gates this repository's work is a real reason not to merge. So is a `status` still `QUEUED` or `IN_PROGRESS` — an unfinished check is not a passing one. Report it and stop.
- **Learn which checks are tiered on the base branch.** Where a repository runs a cheaper suite on the integration branch and a fuller one on a promotion, a `SKIPPED` conclusion on the integration tier is correct rather than a gap — but so is the corollary: note what the checks you did read **did not cover**. If the fuller suite has not run, the evidence that the change works is the local validation recorded in the pull request body. Read it, and if it is absent, that is a reason to stop and ask.
- **A failure on a promotion often belongs to a pull request that merged days ago**, not to the promotion in front of you. That hop is where a whole batch is checked together for the first time. Report it; do not assume it is the promotion's own fault.

## Exit codes

| Code | Meaning | Action |
| --- | --- | --- |
| `0` | Approved at current head | Merge with a merge commit (not squash), then run the post-merge steps below. |
| `1` | Usage error | Stop; this is a script invocation problem, not a pull request state. |
| `2` | No linked issue / no claim comment | Out of scope for `check`; these belong to `record`. Stop and report. |
| `3` | Refused: reviewer claimed the linked issue | Out of scope for `check`; these belong to `record`. Stop and report. |
| `4` | Stale `review:approved` label | Re-run with `--strip-stale`, then stop — the branch needs re-review. |
| `5` | No approve verdict at head | Do not merge; report that approval is missing. |
| `6` | Self-approved at head | Do not merge; report that the branch author approved their own work. |
| `7` | Author unidentifiable | Do not merge; report that independence cannot be established. |
| `8` | Hand-recorded verdict at head | Do not merge; escalate for a human to read the unreadable verdict. |
| `9` | Branch moved during verdict write | Out of scope for `check`; these belong to `record`. Stop and report. |
| `10` | Carried: an approve from an earlier head still applies (the branch's own contribution is unchanged since — see docs/AGENT_LOOP.md, "Carried verdicts") | Merge exactly like `0`. |
| `11` | Carried: a request-changes from an earlier head still applies | Do not merge; report that requested changes remain outstanding, not that the branch is unreviewed. |
| `12` | `record` only — an approve was refused because an unsuperseded request-changes from a different reviewer sits at this head | Out of scope for `check`. If you see it reported, the pull request has no valid approve — treat it like `5` and stop. |
| `13` | Approved at head, but the winning approve was recorded with `--supersedes` over another reviewer's dissent | Merge exactly like `0`. Worth a note in the merge report: this pull request had a genuine disagreement between reviewers, resolved explicitly rather than by an accidental race. |

**This table is what a merger branches on, so it is checked against the code rather than hand-maintained against it.** `.rallypoint/scripts/lib/review-exit-codes.mjs` is the single authority for these codes. If you are adding a code, add it there — not here — and the assertion helpers in that module will name this table and every other consumer still owing it a decision. A code missing from a downstream copy does not fail loudly: it falls through to a reasonable-looking fallback, which is how a properly reviewed merge comes to be labelled unreviewed.

**A Dependabot pull request is checkable and mergeable through this same path.** It has no `Closes #<issue>` reference and no claim comment, so `check` reads its verdict the way it reads a promotion's: bound to the pull request number and head SHA. The exit codes above mean the same thing, except `2`, `3`, `6`, `7`, `10`, and `11`, which cannot occur. Nothing follows the merge — there is no issue to close and no reservation ref to release — so the post-merge sections do not apply to one.

## Improvements: one more gate

A pull request carrying the improvement label (`labels.improvement`, by default `loop:improvement`) changes the loop's own prompts. Before merging one, also run:

```bash
node .rallypoint/scripts/improvement.mjs check --pr <N>
```

Merge only on `0`. Any other code means do not merge: `2` the improvement block is missing or invalid, `3` it touches a frozen or untunable path and needs a person, `4` an earlier improvement is still pending, `5` the check could not be established. Report the code and stop.

## Promotions: merge a snapshot, never the integration branch itself

Where `promotionBranch` is configured, a promotion pull request should be cut from an immutable snapshot branch named with `promotionSnapshotPrefix`, not from the integration branch directly.

- **A promotion pull request whose head branch *is* the integration branch should not be merged as-is.** Its head moves on every agent merge, so a green rollup and an approved verdict can both be stale by the time you act, with nothing reporting it. Report it and ask for a snapshot to be cut instead.
- **Re-read the head SHA immediately before merging anyway**, snapshot or not, and confirm it is the SHA the verdict names and the SHA the rollup you just read belongs to. The snapshot makes that check pass rather than making it unnecessary — a branch can still be re-cut deliberately, which is legitimate and invalidates the verdict.

After the promotion merges, delete the snapshot branch. A stale snapshot ref is a tempting wrong base for the next one.

## After a successful merge: delete the branch from origin

**Merge without `--delete-branch`, then run the command separately:**

```bash
gh pr merge <N> --merge
node .rallypoint/scripts/delete-merged-branch.mjs --pr <N>
```

`--delete-branch` couples the local and remote deletes and attempts the local one first. The authoring worker's worktree is, minutes after a merge, still checked out on that branch, so `git branch -d` refuses, `gh pr merge` exits 1, and it **never attempts the remote delete** — which would have succeeded. Left unaddressed, merged branches accumulate on origin by one per merge with nothing announcing it.

Do not reach for `git push origin --delete` when the coupled form fails: any push fires `pre-push`, and in a repository that gates pushes on a full suite that runs the whole gate before the command reaches the network. The command above uses the GitHub API ref delete instead — no hook, no worktree dependency.

**A local branch surviving the merge is normal, not a failure.** The command deletes the remote first, then reports what it could not clean up locally and exits `0` anyway. Read that line as information. Exit `2` (refused: not merged, or not an issue branch), `3` (inconclusive), and `4` (the ref was there and the delete failed) are the ones worth reporting.

Confirm with `git ls-remote --heads origin 'refs/heads/agent/<N>-*'`, which should return nothing.

## After a successful merge: reconcile the claim

**The reservation ref and `status:claimed` being still present the moment you merge is the expected state, not a failure.** Neither is removed by the merge itself. `close-referenced-issues.mjs` is what removes them:

```bash
node .rallypoint/scripts/close-referenced-issues.mjs <merge-sha>
```

Where a repository wires this into a workflow on pushes to the integration branch, **judge the run, not the ref.** A workflow queued behind other jobs can take anywhere from seconds to minutes, and a merger that samples ref state seconds after merging is reading the inside of the workflow's own runtime window. Reporting that as a cleanup failure sends an orchestrator investigating a non-defect, and running the script by hand mutates coordination state that did not need mutating.

```bash
MERGE_SHA=$(gh pr view <N> --json mergeCommit --jq .mergeCommit.oid)
gh run list --workflow <your-cleanup-workflow>.yml --commit "$MERGE_SHA" \
  --json databaseId,status,conclusion,url
```

- **`queued` or `in_progress`** — it has not had its turn yet. `gh run watch <databaseId> --exit-status` blocks until it concludes. Nothing is owed until it does.
- **`success`** — the cleanup is done. A `no reservation for #N` / `no status:claimed on #N` line in its log is the idempotent no-op branch reporting already-clean, not a miss.
- **`failure`, `cancelled`, or absent entirely** — this is the case the manual run above exists for. A cancelled run does no cleanup and nothing retries it, and from the ref alone it looks identical to "not started yet", which is the reason to read the run rather than guess. Say in the merge report which run you read and what it concluded.

## After a successful merge: read the keyword before judging the outcome

**Read the pull request body's closing keyword first, then check the issue against it.** `Closes`/`Fixes`/`Resolves #N` and `Refs #N` want opposite post-merge states, and applying "a pull request merged, so close its issue" to both closes issues against their own pull requests' explicit instruction not to — after which the residual scope goes untracked.

- **`Closes #N`** — the issue should be **closed** and its reservation ref gone. If the cleanup genuinely failed and the issue is still open, run `close-referenced-issues.mjs <merge-sha>`. If the reservation ref survives that, run `node .rallypoint/scripts/cleanup.mjs --issue <N>`. A `status:claimed` left on a closed issue is `clear-status-labels.mjs --issue <N>`'s job, and reporting it for a janitor is also correct.
- **`Refs #N`** — the issue **should still be open**, and that is the delivery working as disclosed, not a defect to remedy. What should have changed is the claim, not the state: `close-referenced-issues.mjs` releases the claim on this path and deliberately leaves the issue open. Expect the reservation ref gone, `status:claimed` gone, and the assignee cleared — and the issue claimable again by that alone, **unless** it carries `status:blocked`, `status:deferred`, or `needs:human`. An issue held by one of those keeps the claim released and stays out of the pool on purpose, so "open, unassigned, and still not claimable" is the correct outcome there, not a half-finished one. If any of that is outstanding after the cleanup concluded, the remedy is `close-referenced-issues.mjs <merge-sha>` — **not** `cleanup.mjs`, which refuses an open issue by design.
  - **The claim release follows the branch name, not the body.** `planClaimReleases` derives the issue from `agent/<N>-…`, so a `Refs #M` naming an issue the branch does not name gets no claim release at all: `#M` keeps its reservation ref and its `status:claimed`, and no script in this loop will clear them. Re-running `close-referenced-issues.mjs` will not either. Report that state and leave it to a janitor rather than concluding the tooling failed and reaching for a hand fix.

**Never close an issue by hand after a merge.** Not on either path: on the `Closes` path the script is the remedy, and on the `Refs` path the open issue is the intended outcome — whatever is left to reconcile there is the claim, never the state. A merger that closes a `Refs` issue destroys the only open record of the residual scope, and nothing else in the loop is watching for it.

If the body's keywords and the landed commit message disagree, the script is the authority rather than your reading of either — `planClosures` reads both. Run it and report what it did.
