# swarm-ui

A small Next.js app that shows your Rallypoint swarm's public record: progress,
targets, referee results, versions, buried ideas, the fleet, sessions, the
GitHub lanes, messages, the protocol and its skills. It reads your own
Supabase project and GitHub repository, server-side, and never writes.

## Run it locally

```bash
cd swarm-ui
cp .env.example .env.local   # then fill it in
npm install
npm run dev                  # http://localhost:3000/swarm
```

Node 20 or newer. Apply `.rallypoint/swarm/schema.sql` in the Supabase SQL
editor and run `npx rallypoint swarm init` first, or the pages tell you what
is missing.

## Environment

| Variable | Required | What for |
| -------- | -------- | -------- |
| `NEXT_PUBLIC_RALLYPOINT_SUPABASE_URL` | yes | your Supabase project's URL |
| `NEXT_PUBLIC_RALLYPOINT_SUPABASE_KEY` | yes | the publishable (anon) key; RLS keeps it read-only |
| `RALLYPOINT_GITHUB_REPO` | for GitHub views | `owner/name` |
| `RALLYPOINT_GITHUB_TOKEN` | no | a read-only token; raises rate limits, reads private repos |
| `RALLYPOINT_GITHUB_API_URL` | no | GitHub Enterprise Server API URL |

Never add the service-role key or `RALLYPOINT_SWARM_SECRET` here.

## Live updates

Pages update on their own within a couple of seconds of an agent writing
memory, through Supabase Realtime (`@supabase/realtime-js`, already in
`package.json`). `schema.sql` publishes the memory tables; a project that
applied an older one runs `.rallypoint/swarm/realtime.sql` once
(`npx rallypoint swarm doctor` says when). Without Realtime the pages refresh
every minute.

## Deploy to Vercel

1. Import the repository in Vercel and set **Root Directory** to `swarm-ui`.
2. Add the environment variables above (Production and Preview).
3. Deploy. The pages are rendered on demand; GitHub reads are cached for two
   minutes.

## Private mode

When the swarm's `visibility` is `"private"`, RLS hides memory from the anon
key and the pages ask visitors to sign in at `/swarm/sign-in` (Supabase Auth
email and password, or a magic link). Add your team in Supabase Auth. For
magic links, add `https://<your-domain>/swarm/sign-in` to Supabase Auth's
Redirect URLs. The session lives in an httpOnly cookie, `rp-swarm-token`.
Live updates then use the reader's own access token, so Realtime applies the
same RLS; the cookie stays httpOnly.

## Make it yours

Everything project-specific is in `app/swarm/swarm.config.ts`, which you own.
Styles are in `app/swarm/swarm.css` as CSS variables. Pages are thin and read
through `app/swarm/_lib/queries.ts`. See Rallypoint's `CUSTOMIZE.md` for the
rules and starter ideas. Fonts: Inter, Inter Tight and JetBrains Mono,
self-hosted by `next/font` at build time (so the first build needs network
access, as `npm install` does); set `--rp-font-sans`, `--rp-font-display` or
`--rp-font-code` to use others.
