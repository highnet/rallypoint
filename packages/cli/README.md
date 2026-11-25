# Rallypoint CLI

Install a repository-native operating protocol for coordinating planners,
workers, reviewers, testers, fixers, janitors, and an orchestrator that
dispatches them.

```bash
npx rallypoint@latest view loop
npx rallypoint@latest add loop --dry-run
npx rallypoint@latest add loop
npx rallypoint@latest init
```

The CLI is dependency-free. It ships with Rallypoint’s own checksummed registry,
refuses conflicting writes by default, and never requires the source repository
to be public.

Use `--force` only after reviewing conflicts. Use `--cwd <path>` to target a
repository other than the current directory.

### `AGENTS.md` is the one exception

Every other conflicting file stops the entire install — nothing is written
until you resolve it or pass `--force`. A pre-existing `AGENTS.md` is
different: it's usually owned by the repository or another tool, so `add`
leaves it untouched, installs everything else (including `AGENTIC_LOOP.md`,
which carries the actual protocol), and prints the one-line fix:

```
AGENTS.md already exists and was left unchanged. Add this line so agents pick up the loop:
  @AGENTIC_LOOP.md
```

## `init`

Run `init` after `add loop`. It requires the GitHub CLI (`gh`) installed and
authenticated, and it talks to the live repository, so it's a separate step
from the purely local, checksum-verified file writes `add` performs. It:

- confirms `gh` is installed and authenticated
- syncs `.rallypoint/config.json`'s `integrationBranch` to the repository's
  actual default branch
- creates the labels the loop depends on (`task`, `status:ready`,
  `status:claimed`, `status:blocked`, `needs:human`, `review:approved`,
  `prio:p0`, `prio:p1`, `prio:p2`) if they don't already exist
- reports whether the default branch has protection rules, without changing
  repository settings

`init` is idempotent and supports `--dry-run` and `--cwd <path>`, same as
`add`.

## Rallypoint Swarm

Swarm is the next tier, installed on top of `loop`. It adds shared memory in
your own Supabase project, a referee (`score`, `checks` or `review` mode),
self-picking roles, retros, buried ideas, concepts, a genesis skill that
turns a one-line pitch into this project's starting point, and a conductor
loop. More setup, more capability:

```bash
npx rallypoint@latest add swarm
npx rallypoint@latest swarm doctor
npx rallypoint@latest swarm init
```

`rallypoint swarm <command>` forwards to the installed runtime
(`.rallypoint/swarm/swarm.mjs`). Try `rallypoint swarm help`. The installed
`SWARM.md` has the full setup, including the schema and the environment
variables.

Optional UI: a route scaffold your project grows into its own frontend.

```bash
npx rallypoint@latest add swarm-ui          # into an existing Next.js app
npx rallypoint@latest add swarm-dashboard   # a standalone swarm-ui/ app
```

Both generate a project-owned `swarm.config.ts` from `.rallypoint/swarm.json`
the first time, and never overwrite it.

## Publishing

Releases are automated via [release-please](https://github.com/googleapis/release-please),
driven by [Conventional Commits](https://www.conventionalcommits.org/) on
commits touching this package (enforced locally by a Husky `commit-msg` hook).
release-please maintains a standing release pull request that bumps `version`
in `package.json` and the matching `VERSION` const in `bin/rallypoint.mjs`.
Merging that PR is the entire release step — `.github/workflows/publish-cli.yml`
then runs the CLI test gate and publishes to npm. No manual `npm publish` or
version bump is required.
