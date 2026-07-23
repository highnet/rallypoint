# Rallypoint

A portable, GitHub-native operating protocol for coordinating coding agents.

Rallypoint turns a repository into the shared coordination surface for planners,
workers, reviewers, testers, fixers, and janitors. It adds explicit role prompts,
an atomic issue-claim protocol, branch and pull-request rules, and stale-state
cleanup without requiring a backend or agent-specific runtime.

## Install

Inspect the registry item:

```bash
npx shadcn@latest view highnet/highnet-agentic-loop/loop
```

Install it:

```bash
npx shadcn@latest add highnet/highnet-agentic-loop/loop
```

The repository must be public for anonymous GitHub-registry installation. The
hosted registry endpoint can be used independently when the website is public.

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
`registry.json`.

```bash
npx shadcn@latest build
```

This writes the distributable item to `public/r/loop.json`.

## Protocol origin

Rallypoint distills the autonomous agent loop used in
[`highnet/codewright`](https://github.com/highnet/codewright): GitHub-backed
coordination, atomic issue reservations, one-issue branches, independent
review, focused fixer passes, and maintenance of stale coordination state.
