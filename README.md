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

## Releasing the CLI

The website package at the repository root is intentionally private and must
never be published. The CLI package (`packages/cli`, published as `rallypoint`)
releases via [release-please](https://github.com/googleapis/release-please) —
there's no manual version bump.

Commit messages must follow [Conventional Commits](https://www.conventionalcommits.org/)
(`fix:`, `feat:`, `feat!:`/`BREAKING CHANGE:`, `chore:`, etc.) — a Husky
`commit-msg` hook enforces this locally via commitlint. release-please reads
those messages to decide the next semver bump and keeps a standing "Release
packages/cli x.y.z" pull request up to date with the version bump (in both
`package.json` and the `VERSION` const in `bin/rallypoint.mjs`) and changelog.

Merging that release PR is the entire release process:
`.github/workflows/publish-cli.yml` runs release-please on every push to
`main`; when it detects the release PR was just merged, it runs
`npm run cli:test` and publishes the new version to npm. Authentication uses
npm's [Trusted Publisher](https://docs.npmjs.com/trusted-publishers) OIDC
flow, scoped to this exact repo and workflow filename — there's no
`NPM_TOKEN` secret to rotate or leak.

For a local dry run before merging a release PR:

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
