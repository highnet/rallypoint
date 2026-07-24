# Contributing to Rallypoint

Thanks for your interest in improving Rallypoint. This document covers how the
repository is organized and how to get a change merged.

## Project layout

- `registry/` — source files for the Rallypoint protocol, declared in
  `registry/manifest.json`
- `packages/cli/` — the published `rallypoint` npm package
- `app/`, `components/`, `lib/` — the Next.js marketing/documentation site
  (the root package is private and never published)

See [DESIGN.md](DESIGN.md) and [PRODUCT.md](PRODUCT.md) for the design system
and product rationale behind the site.

## Getting set up

```bash
npm install
npm run dev
```

## Making changes to the protocol/registry

Edit files under `registry/rallypoint/`, then rebuild the distributable
artifacts:

```bash
npm run registry:build
```

This regenerates `public/registry/loop.json` and the bundled copy in
`packages/cli/registry/`. Test the CLI locally before opening a PR:

```bash
node packages/cli/bin/rallypoint.mjs view loop
node packages/cli/bin/rallypoint.mjs add loop --dry-run
```

## Making changes to the site

The site is TypeScript, Tailwind CSS, and shadcn-style primitives. Run the
full check before submitting:

```bash
npm run test
```

This runs `eslint` and `tsc --noEmit`. Fix any errors it reports.

## Pull requests

1. Fork the repository and create a branch from `main`.
2. Keep changes focused — unrelated fixes belong in their own PR.
3. Make sure `npm run test` passes, and `npm run cli:test` passes if you
   touched the registry or CLI.
4. Describe what changed and why in the PR description.
5. Link any related issue.

## Reporting bugs

Open a GitHub issue with steps to reproduce, what you expected, and what
happened instead. For security vulnerabilities, see
[SECURITY.md](SECURITY.md) instead of filing a public issue.

## Code of conduct

This project follows the [Code of Conduct](CODE_OF_CONDUCT.md). By
participating, you agree to uphold it.

## License

By contributing, you agree that your contributions will be licensed under the
project's [MIT License](LICENSE).
