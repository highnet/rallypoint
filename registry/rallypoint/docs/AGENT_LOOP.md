# The Rallypoint Agent Loop

GitHub is the shared campaign board. Every participant follows the same loop:

```text
read repository state
  → claim one ready issue
  → create one issue branch
  → implement and verify
  → open one pull request
  → independent review
  → merge and close the issue
```

## Coordination state

Use GitHub issues as the queue and labels as state:

- `task` — actionable work
- `status:ready` — scoped and available
- `status:claimed` — reserved by one worker
- `status:blocked` — cannot proceed
- `needs:human` — requires an owner decision or protected action
- `prio:p0`, `prio:p1`, `prio:p2` — priority
- `review:approved` — reviewer verdict on a pull request

## Roles

| Role | Claims issues? | Reviews? | Responsibility |
| --- | --- | --- | --- |
| Planner | No | No | Keeps a small, ordered backlog of ready issues. |
| Worker | Exactly one | Never own work | Ships one issue as one pull request. |
| Reviewer | No | Yes | Judges the current revision against the issue and repository rules. |
| Tester | Its own filed gap | No | Finds the weakest coverage area and closes one gap. |
| Fixer | No | No | Addresses review feedback on an existing pull request branch. |
| Janitor | No | No | Releases stale claims and removes abandoned reservation refs. |
| Orchestrator | Never | Never | Surveys the queue and open pull requests, then recommends how many sessions of each role to start; never acts without operator confirmation. |

## Atomic claims

Multiple agent sessions may share one GitHub identity, so assignment is not a lock. Rallypoint creates `refs/heads/rallypoint-claims/issue-<N>` as an atomic reservation before changing issue state. Only one caller can create the ref.

Run:

```bash
node .rallypoint/scripts/claim.mjs \
  --agent-id "<unique-session-id>" \
  --plan "first step" \
  --plan "second step"
```

The script selects the highest-priority unassigned `status:ready` issue. Pass `--issue <N>` only when an operator names a specific issue.

## Working agreement

- Branch from the configured integration branch.
- Push often enough that the janitor can distinguish live work from abandoned work.
- Keep changes scoped to the claimed issue.
- When product intent is genuinely ambiguous, comment the smallest reasonable interpretation or apply `status:blocked` and `needs:human`.
- Tests accompany behavior changes.

## Review

The reviewer reads the linked issue, current diff, repository instructions, specifications, and tests. It either records approval or posts actionable requested changes. The author never supplies its own verdict.

## Cleanup

After the issue closes:

```bash
node .rallypoint/scripts/cleanup.mjs --issue <N>
```

The cleanup command refuses to delete a reservation for an open issue.
