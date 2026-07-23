# Rallypoint Agent Protocol

This repository coordinates humans and coding agents exclusively through GitHub issues, branches, pull requests, labels, and reviews.

## Start every session

1. Read `docs/AGENT_LOOP.md`.
2. Select exactly one role from `.rallypoint/roles/`.
3. Read that role prompt completely.
4. Follow the repository's existing product, architecture, testing, and contribution documentation.

## Hard rules

- One issue, one branch, one pull request.
- Workers claim exactly one `status:ready` issue before writing code.
- Claims are made only through `node .rallypoint/scripts/claim.mjs`.
- Branch from the configured integration branch as `agent/<issue>-<slug>`.
- Never push directly to protected branches.
- Never review or approve your own work.
- Never invent scope. Record ambiguity on the issue.
- No secrets, credentials, tokens, or local environment files in commits.
- Keep the repository green. The worker owns failures introduced by its pull request.
- Only the top-level agent mutates GitHub; subagents may research and verify inside the same claimed issue.

## Delivery

Open a ready-for-review pull request targeting the configured integration branch. Include `Closes #<issue>` and the local validation results. A new push invalidates any previous reviewer verdict.
