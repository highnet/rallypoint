# The Rallypoint Agent Loop

GitHub is the shared campaign board. Every participant follows the same loop:

```text
read repository state
  → claim one claimable issue
  → create one issue branch
  → implement and verify
  → open one pull request
  → independent review
  → merge, then reconcile the claim
```

## Prerequisites

Every script here shells out to the GitHub CLI. A missing or unauthenticated
`gh` exits `69` — deliberately outside every exit table below, so no caller can
mistake an absent prerequisite for a real verdict.

```bash
gh auth login
```

A checkout whose copy of the protocol is older than the integration branch's
exits `75`, also outside every table. Both codes mean "this could not run", not
"this is the answer".

## Coordination state

GitHub issues are the queue. Labels are state, and their names are configurable
in `.rallypoint/config.json` — the defaults are:

| Label | Config key | Meaning |
| --- | --- | --- |
| `status:claimed` | `claimed` | Reserved by one worker right now |
| `status:blocked` | `blocked` | Waiting on another **issue**, named in a `Blocked-By:` trailer |
| `status:deferred` | `deferred` | A deliberate hold that will not clear on its own |
| `needs:human` | `human` | Requires an owner decision or a protected action |
| `review:approved` | `approved` | Reviewer verdict on a pull request |
| `status:changes-requested` | `changesRequested` | A reviewer asked for changes and they are outstanding |
| `merged:unreviewed` | `mergedUnreviewed` | Merged without an approve verdict at its head |

Priority is a separate `prio:p<n>` label, `p0` through `p9`. `claim.mjs` orders
the claimable pool by that number and nothing else, so it is not decoration.

### There is no readiness label

**An open issue is claimable unless something holds it back.** The claimable
pool is every open issue that carries no assignee and none of `status:claimed`,
`status:blocked`, `status:deferred`, or `needs:human`.

This is the opposite of an opt-in queue, and the consequence is worth stating
plainly: **filing an issue makes it claimable.** A planner filing a stub to
flesh out later must apply `status:deferred` in the same breath, or a worker may
claim it within the hour. In exchange, there is no second label anybody can
forget to add, and no issue sits scoped-but-invisible because a step was missed.

Every hold label is therefore load-bearing. A missing `labels.deferred` in the
config does not narrow the pool — it silently widens it to include work somebody
deliberately postponed.

### Blocked means blocked on an issue

`status:blocked` is only for a dependency on another GitHub issue, and it must
be accompanied by one visible, flush-left trailer in the issue body:

```text
Blocked-By: #41, #57
```

That trailer is the only thing that brings the issue back automatically.
`close-referenced-issues.mjs` removes the label when the last named issue
closes, and `janitor-pass.mjs` backstops a blocker that closed some other way.
The rule is all-or-nothing: an issue behind two dependencies is not queued the
moment the first lands. `needs:human` vetoes the automatic removal — that is a
judgement no automated writer may overrule — but the comment is still posted,
because an operator wanting to know the trailer cleared is exactly who the veto
is holding the issue for.

For anything that is *not* an issue dependency — an operator action, an external
condition, an indefinite scheduling decision — do **not** use `status:blocked`
and do not invent a `Blocked-By:` issue. Use `needs:human`, `status:deferred`,
or both.

## Roles

Every session adopts exactly one role. The orchestrator decides which role a new
session should adopt by reading repository state; every other role then works
within its own boundary alone.

| Role | Claims issues? | Reviews? | Responsibility |
| --- | --- | --- | --- |
| Orchestrator | No | No | Reads repository state and recommends what to run next. |
| Planner | No | No | Keeps an ordered, well-scoped backlog. |
| Worker | Exactly one | Never own work | Ships one issue as one pull request. |
| Reviewer | No | Yes | Judges the current revision against the issue and repository rules. |
| Tester | Its own filed gap | No | Finds the weakest coverage area and closes one gap. |
| Fixer | No | No | Addresses review feedback on an existing pull request branch. |
| Janitor | No | No | Repairs GitHub coordination state: stale claims, orphaned refs, leases. |
| Merger | No | No | Verifies CI and the verdict, merges, and reconciles the claim. |

## Atomic claims

Several agent sessions may share one GitHub identity, so assignment is not a
lock. Rallypoint creates `refs/heads/rallypoint-claims/issue-<N>` as an atomic
reservation **before** changing any issue state. Only one caller can create the
ref, and that ordering is the whole atomicity guarantee.

```bash
node .rallypoint/scripts/claim.mjs \
  --agent-id "<unique-session-id>" \
  --plan "first step" \
  --plan "second step"
```

The script takes the highest-priority claimable issue. Pass `--issue <N>` only
when an operator names a specific one — and pass it as a flag, never as a bare
number, which is refused outright rather than silently claiming something else.

`claim.mjs` also publishes the branch it prescribes (`CLAIM_BRANCH`) to the
remote, pointing at the integration branch tip, so the claim is visible to a
janitor on any host from its first minute. Check that branch out rather than
inventing a name.

### Releasing a claim

A worker that cannot finish releases its own reservation immediately:

```bash
node .rallypoint/scripts/release-claim.mjs --issue <N> --agent-id <your-id>
```

Passing the same agent id that claimed proves this is your own claim, so it is
not gated on `staleClaimHours` the way a janitor's release is.

| Code | Meaning |
| --- | --- |
| `0` | Released |
| `1` | Usage error |
| `2` | Closed, or neither a live claim nor a stale assignee exists |
| `3` | Proven live: an open pull request, a recent push, or unpushed local work |
| `4` | The claim is younger than `staleClaimHours` |
| `5` | Eligibility could not be established, so nothing was done |
| `6` | The reservation was not confirmed gone; no issue mutation |
| `7` | Reservation gone, issue restore failed; still reads claimed |

**Unreadable is never abandoned.** Every lookup in this protocol distinguishes
an established answer from one that could not be established, and refuses on the
latter. A full page of results cannot prove absence; an error is not an empty
set.

## Review

GitHub rejects APPROVE and REQUEST_CHANGES from a pull request's own author, and
agent sessions sharing one identity are all "the author". Verdicts are therefore
recorded as COMMENTED reviews carrying a machine-readable block, and
`review.mjs` is the only thing that may apply or remove `review:approved`.

```bash
node .rallypoint/scripts/review.mjs record \
  --pr <N> --agent-id <your-session-id> \
  --verdict approve|request-changes \
  --note "<one actionable point>"
```

A verdict binds to the head SHA it was recorded against, so any push invalidates
it. Before opening a pull request, a worker runs `preflight.mjs` to confirm
`record` will be able to resolve an authoring session at all:

```bash
node .rallypoint/scripts/preflight.mjs --body "<prepared body>" --base "<base>"
```

| Code | Command | Meaning |
| --- | --- | --- |
| `0` | both | Success; for `check`, an independent approve at the current head |
| `1` | both | Usage error |
| `2` | record | No `Closes #<issue>` resolving an authoring session, or no claim comment on one |
| `3` | record | Refused: the reviewer claimed the linked issue |
| `4` | check | Stale `review:approved` left in place; rerun with `--strip-stale` |
| `5` | check | No approve verdict at the current head |
| `6` | check | The approve came from the branch author, or a subagent it dispatched |
| `7` | check | Author unidentifiable, so independence cannot be established |
| `8` | check | Hand-recorded verdict at the head this script cannot read |
| `9` | record | The branch moved while the verdict was being written; nothing kept |
| `10` | check | Carried: no verdict at the head, but an approve carries forward |
| `11` | check | Carried: no verdict at the head, but a request-changes carries forward |
| `12` | record | Refused: an unsuperseded request-changes from a different reviewer sits at this head |
| `13` | check | Approved, but the winning approve explicitly superseded a dissent |

`lib/review-exit-codes.mjs` is the single authority for this table. Add a code
there and its assertion helpers will name every consumer and document still
owing it a decision.

### Carried verdicts

A verdict is bound to a head SHA on purpose: a new revision deserves a new
review. But a head also moves when the integration branch is merged in and the
branch's *own* contribution has not changed at all, and those two look identical
from the SHA alone. `carry-forward.mjs` answers the question the SHA cannot, and
`10` / `11` are the result — an earlier verdict that provably still applies.

`11` matters as much as `10`: it says the feedback was seen and never addressed,
which is a different thing from "nobody has reviewed this" (`5`).

### Contested verdicts

Two reviewers can legitimately disagree at the same head. If `record` exits `12`,
an unsuperseded request-changes from a *different* reviewer is already there.
Read that dissent first. If it still applies, leave your own request-changes. If
you have concrete reason it no longer does, record over it explicitly:

```bash
node .rallypoint/scripts/review.mjs record --pr <N> --agent-id <id> \
  --verdict approve --supersedes <issued-nonce> --note "<why>"
```

That is what `13` reports afterwards: approved, over a dissent, on the record.

### Reviewer leases

An orchestrator surveying an unchanged board twice recommends the same session
twice, because a pull request awaiting a verdict looks identical to one already
being reviewed. Leases close that interval:

```bash
node .rallypoint/scripts/lease.mjs --role reviewer --pr <N> --agent-id <id>
node .rallypoint/scripts/lease.mjs --release --role reviewer --pr <N> --agent-id <id>
```

They are exclusive, head-bound, and TTL-bounded. Exit `2` means somebody else
holds it: stand down rather than reviewing alongside them.

### Recovering an unreviewable pull request

If `record` exits `2` because the linked issue has no claim comment — a pull
request opened outside the claim flow — do not hand-edit issue state:

```bash
node .rallypoint/scripts/reconcile.mjs --issue <N> --agent-id <authoring-id>
```

It refuses if the issue already has a claim comment, or if more than one open
pull request references it. `--pull <n>` resolves the issue for you when the
issue number is exactly what is missing.

## Maintenance

A janitor runs one pass rather than remembering four commands:

```bash
node .rallypoint/scripts/janitor-pass.mjs --agent-id <id> [--dry-run]
```

It surveys, releases claims the evidence says are over, cleans closed-issue
reservations, clears stale status labels, and sweeps expired leases — reporting
each step's exit code so a partial pass cannot be mistaken for a clean one.

The read-only survey behind it stands alone, and mutates nothing:

```bash
node .rallypoint/scripts/report.mjs
```

**Local work outranks every GitHub signal.** A claim's age and the absence of a
pull request cannot see a worker that has committed locally and not pushed.
`report.mjs` and `release-claim.mjs` both ask `git` whether a worktree **on this
machine** holds unpushed commits for the issue, and refuse the release when one
does. That guard binds only on the host it runs from — which is why the beacon
push exists, and why the report says which answer it actually got.

### Closing and cleanup

After a merge:

```bash
node .rallypoint/scripts/close-referenced-issues.mjs <merge-sha>
```

It reads the closing keyword from the pull request body **and** the merged
commit's message, because GitHub does. `Closes #N` closes the issue and releases
the claim; `Refs #N` releases the claim and deliberately leaves the issue open.

For a closed issue's leftover reservation, and for a stale label on a closed
issue:

```bash
node .rallypoint/scripts/cleanup.mjs --issue <N>
node .rallypoint/scripts/clear-status-labels.mjs --issue <N> [--dry-run]
```

`cleanup.mjs` refuses to delete a reservation for an open issue by design.

### Deleting the branch after a merge

```bash
node .rallypoint/scripts/delete-merged-branch.mjs --pr <N>
```

Use this rather than `gh pr merge --delete-branch`, which couples the local and
remote deletes, attempts the local one first, and abandons the remote delete
when the authoring worktree is still checked out on the branch.

## Two-tier repositories

`integrationBranch` is where agents merge. Set `promotionBranch` as well if that
branch later promotes into another, and `promotionSnapshotPrefix` for the
immutable snapshot branches a promotion is cut from. Both are optional; a
single-tier repository leaves them unset and nothing changes.

Promote a snapshot, never the integration branch itself. An integration branch
head moves on every agent merge, so a green CI run and an approved verdict can
both be stale by the time the merge happens, with nothing reporting it.

`promotionSnapshotPrefix` must not overlap `branchPrefix` in either direction —
the config validator rejects it — because a snapshot head is the one shape that
skips the self-review guard, and containment is what makes that unforgeable.

## Shared identity

Where several agent sessions authenticate as one GitHub account, set
`sharedIdentity` to that login. It is what lets a janitor tell a protocol-owned
assignment from a person's when clearing the assignee left behind by an ended
claim. Left unset, that repair declines rather than guessing.

## Working agreement

- One issue, one branch, one pull request.
- Branch from the configured integration branch.
- Push often enough that a janitor can distinguish live work from abandoned work.
- Keep changes scoped to the claimed issue.
- Tests accompany behavior changes.
- Never review or approve your own work — including through a subagent this
  session dispatched, which is not a loophole.
- When product intent is genuinely ambiguous, comment the smallest reasonable
  interpretation, or apply the hold label that names the reason.
