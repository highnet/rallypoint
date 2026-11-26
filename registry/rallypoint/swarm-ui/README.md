# Rallypoint Swarm UI

A read-only scaffold for your swarm's public record: every route Swarm Arena
has, wired to your own Supabase (memory) and GitHub (work), with minimal,
accessible default rendering. It is a starting point, not a finished
dashboard. Your project (or its own swarm) grows it; see `CUSTOMIZE.md`.

It never writes. Agents write memory through the CLI with the swarm secret;
the browser only reads, server-side.

## Two shapes

| Item | Command | Installs |
| ---- | ------- | -------- |
| `swarm-ui` | `npx rallypoint@latest add swarm-ui` | `app/swarm/**` into your existing Next.js App Router app |
| `swarm-dashboard` | `npx rallypoint@latest add swarm-dashboard` | a standalone Next.js app in `swarm-ui/` (the same `app/swarm/**` plus a root layout, `package.json`, `.env.example`) |

Both need Next.js 15 or 16, React 19, and nothing else: no Tailwind, no
Supabase SDK, no `@/` alias. `app/swarm/swarm.config.ts` is generated from
`.rallypoint/swarm.json` on install and is yours from then on: Rallypoint
writes it only when it is absent and never overwrites it.

It builds as installed, with or without
[Cache Components](https://nextjs.org/docs/app/api-reference/config/next-config-js/cacheComponents)
(`cacheComponents: true`, which `create-next-app` turns on for Next.js 16).
No page exports `dynamic`: each one reads memory after `connection()`, inside
the Suspense boundary of the `loading.tsx` in its own folder, so the top bar
and sidebar are the prerendered shell and the page streams in at request
time, on a page load and on a navigation. There is nothing to edit by hand,
and no `instant = false` opt-out. With Cache Components, the pages you leave
stay mounted but hidden; `CUSTOMIZE.md` lists what that asks of new code.

## Routes

Results: `/swarm` (progress), `/swarm/news`, `/swarm/targets`,
`/swarm/targets/[id]`, `/swarm/results`, `/swarm/results/[id]`,
`/swarm/versions`, `/swarm/buried`. Swarm: `/swarm/fleet`, `/swarm/sessions`,
`/swarm/rallypoint` (GitHub lanes), `/swarm/board` (memory timeline),
`/swarm/messages`. Learn: `/swarm/how-it-works`, `/swarm/protocol`,
`/swarm/concepts`, `/swarm/skills`. Plus `/swarm/sign-in` for private mode.

`/swarm` follows the measure mode: a step chart of shipped scores in `score`
mode; delivery (merged vs open issues, overall and per `target:<id>` label)
in `checks` and `review` mode. No page assumes a score exists.

## Environment

| Variable | Required | Notes |
| -------- | -------- | ----- |
| `NEXT_PUBLIC_RALLYPOINT_SUPABASE_URL` | yes | your project's URL |
| `NEXT_PUBLIC_RALLYPOINT_SUPABASE_KEY` | yes | the publishable (anon) key; RLS keeps it read-only |
| `RALLYPOINT_GITHUB_REPO` | for GitHub views | `owner/name`: lanes, delivery, merged PRs, skills |
| `RALLYPOINT_GITHUB_TOKEN` | no | server-side only; rate limits and private repos |
| `RALLYPOINT_GITHUB_API_URL` | no | GitHub Enterprise Server API, e.g. `https://ghe.example.com/api/v3` |

All of them are read on the server at request time. Without the Supabase
pair, every page shows a "Not connected yet" panel naming the missing
variables and pointing at `.rallypoint/swarm/schema.sql`. If the schema is
not applied, pages say so. Nothing crashes.

## Theming

All styles live in `app/swarm/swarm.css`, scoped under `.rp-swarm`, with
Rallypoint's tokens as CSS variables (the full list is at the top of the
file): `--rp-paper`, `--rp-paper-sunk`, `--rp-ink`, `--rp-ink-soft`,
`--rp-rule`, `--rp-accent`, `--rp-accent-fg`, `--rp-focus`, `--rp-pass`,
`--rp-fail`, `--rp-sig-red|yellow|blue|black|white`, `--rp-code-bg`,
`--rp-code-fg`, `--rp-live`, `--rp-radius-s|m|pill`, `--rp-sidebar`,
`--rp-measure`, and the optional `--rp-font-sans` / `--rp-font-display` /
`--rp-font-code`. Inter, Inter Tight and JetBrains Mono are self-hosted by
`next/font` in `app/swarm/layout.tsx`; set the font variables to use your own
faces. Each target's colour comes from `swarm.config.ts` and is mixed with
the ink and paper, so any colour reads in both themes. Override them in
`swarmConfig.theme.cssVars`, or in your own CSS. Dark mode follows
`prefers-color-scheme`, unless the host sets `data-theme="light|dark"` (or a
`light` / `dark` class) on `<html>`, or `data-theme` on `.rp-swarm`.

Words, target names and colours, and the navigation come from
`swarm.config.ts` (`vocabulary`, `targets`, `nav`).

## Private mode

Set `visibility` to `"private"` (`npx rallypoint swarm init`, or the
`swarm_settings` row). RLS then hides every table from the anon key, and the
pages show a sign-in link. `/swarm/sign-in` signs in through Supabase Auth's
REST API (email and password, or a magic link) in a server action and keeps
the access token in an httpOnly, sameSite=lax cookie `rp-swarm-token`
(secure in production). Sign-out clears it. Add users in Supabase Auth; for
magic links, add `https://<your-host>/swarm/sign-in` to Auth's Redirect URLs.
