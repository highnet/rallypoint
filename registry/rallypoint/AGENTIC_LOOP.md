# Rallypoint Agent Protocol

This repository coordinates humans and coding agents exclusively through GitHub issues, branches, pull requests, labels, and reviews.

## Start every session

1. Read `docs/AGENT_LOOP.md`.
2. Select exactly one role from `.rallypoint/roles/`.
3. Read that role prompt completely.
4. Follow the repository's existing product, architecture, testing, and contribution documentation.

## Hard rules

- One issue, one branch, one pull request.
- Workers claim exactly one claimable issue before writing code. An open issue is claimable unless it carries `status:claimed`, `status:blocked`, `status:deferred`, `needs:human`, or an assignee — there is no readiness label to wait for.
- Claims are made only through `node .rallypoint/scripts/claim.mjs`, which creates the reservation ref before touching issue state. That ordering is the atomicity guarantee.
- Branch from the configured integration branch as `agent/<issue>-<slug>`, using the branch `claim.mjs` prescribes rather than one you invent.
- Never push directly to protected branches.
- Never review or approve your own work — including through a subagent this session dispatched. A subagent's id differs from its dispatcher's by construction, so it is not a loophole; declare lineage with `--dispatched-by`.
- Verdicts are recorded only through `node .rallypoint/scripts/review.mjs record`. Never apply or remove `review:approved` by hand.
- Never invent scope. Record ambiguity on the issue, and use the hold label that names the reason.
- No secrets, credentials, tokens, or local environment files in commits.
- Keep the repository green. The worker owns failures introduced by its pull request.
- Only the top-level agent mutates GitHub; subagents may research and verify inside the same claimed issue.

## Delivery

Run `node .rallypoint/scripts/preflight.mjs --body "<prepared body>" --base "<base>"` before opening anything: it is read-only and tells you whether a reviewer will be able to record a verdict at all.

Then open a ready-for-review pull request targeting the configured integration branch. Include `Closes #<issue>` — or `Refs #<issue>` for a deliberate partial delivery, which releases the claim and leaves the issue open — and the local validation results.

A verdict binds to the head SHA it was recorded against, so a new push invalidates it unless the branch's own contribution is provably unchanged.
