# Rallypoint

A portable, GitHub-native operating protocol for coordinating coding agents.

Rallypoint turns a repository into the shared coordination surface for planners,
workers, reviewers, testers, fixers, janitors, and an orchestrator that dispatches
them. It adds explicit role prompts, an atomic issue-claim protocol, branch and
pull-request rules, and stale-state cleanup without requiring a backend or
agent-specific runtime.

## Install

Inspect the first-party registry item:

```bash
npx rallypoint@latest view loop
```

Install it:

```bash
npx rallypoint@latest add loop
```

The zero-dependency CLI ships with Rallypoint’s own registry manifest. It
verifies file checksums, refuses conflicting writes, supports `--dry-run`, and
does not require this source repository to be public.

Then bring the GitHub side of the repository up to date with the installed
protocol — requires the GitHub CLI (`gh`) installed and authenticated:

```bash
npx rallypoint@latest init
```

`init` syncs the configured integration branch to the repository's actual
default branch, creates the `status:ready`/`prio:*`/etc. labels the loop reads
and writes, and reports (without changing) whether the default branch has
protection rules.

## Website

The marketing and documentation site is a Next.js App Router project using
TypeScript, Tailwind CSS, customized shadcn-style primitives, Zustand, and
class-based light and dark themes.

```bash
npm install
npm run dev
```

## Registry development

Source files live under `registry/rallypoint/` and are declared in
`registry/manifest.json`.

```bash
npm run registry:build
```

This writes the distributable item to `public/registry/loop.json` and bundles
the same payload into `packages/cli/registry/`.

Test the unpublished CLI locally:

```bash
node packages/cli/bin/rallypoint.mjs view loop
node packages/cli/bin/rallypoint.mjs add loop --dry-run
```

## Publishing the CLI

The website package at the repository root is intentionally private and must
never be published. The CLI package publishes to npm automatically.

`.github/workflows/publish-cli.yml` runs on every push to `main` that touches
`packages/cli/package.json`. It runs `npm run cli:test`, compares the local
version against what's already on npm, and publishes only when they differ —
so bumping the version and merging to `main` is the entire release process.
A run that finds nothing new to publish exits cleanly rather than failing.

To cut a release: bump `version` in `packages/cli/package.json` (and the
matching `VERSION` const in `packages/cli/bin/rallypoint.mjs`), then merge to
`main`. No manual `npm publish` step is needed.

For a local dry run before merging:

```bash
npm ci
npm run cli:test
npm pack ./packages/cli --dry-run
```

The CLI package’s `prepublishOnly` hook rebuilds the checksummed registry before
npm creates the release tarball, in both the local and automated flows.

## Protocol origin

Rallypoint distills the autonomous agent loop used in
[`highnet/codewright`](https://github.com/highnet/codewright): GitHub-backed
coordination, atomic issue reservations, one-issue branches, independent
review, focused fixer passes, and maintenance of stale coordination state.
