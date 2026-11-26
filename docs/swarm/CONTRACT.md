# Rallypoint Swarm: build contract

This is the shared contract between the four pieces of Rallypoint Swarm: the
`swarm` registry item (runtime, CLI and skills), the Supabase schema, the
`swarm-ui` / `swarm-dashboard` registry items, and the rallypoint.tools site.
Names here are load-bearing. Change them here first.

## Registry items

| Item              | Installs                                                                 | Requires |
| ----------------- | ------------------------------------------------------------------------ | -------- |
| `loop`            | vanilla (unchanged)                                                      | —        |
| `swarm`           | `SWARM.md`, `.rallypoint/swarm.json`, `.rallypoint/swarm/**`, `.claude/skills/swarm-*/SKILL.md` | `loop` |
| `swarm-ui`        | `app/swarm/**` into an existing Next.js App Router app (the UI is the product) | `swarm` |
| `swarm-dashboard` | a standalone Next.js app in `swarm-ui/` (contains the same `app/swarm/**`) | `swarm` |

Registry sources live under `registry/rallypoint/` (the build root):
`registry/rallypoint/swarm/…` for the runtime and
`registry/rallypoint/swarm-ui/…` for the UI. `registry/**` is excluded from
the site's `tsc` and `eslint`, because the templates compile only inside the
user's app.

## Environment

| Variable                                  | Who reads it                     | Secret? |
| ----------------------------------------- | -------------------------------- | ------- |
| `RALLYPOINT_SUPABASE_URL`                 | CLI                              | no      |
| `RALLYPOINT_SUPABASE_KEY`                 | CLI (publishable/anon key)       | no      |
| `RALLYPOINT_SWARM_SECRET`                 | CLI writes                       | **yes** |
| `NEXT_PUBLIC_RALLYPOINT_SUPABASE_URL`     | UI                               | no      |
| `NEXT_PUBLIC_RALLYPOINT_SUPABASE_KEY`     | UI (publishable/anon key)        | no      |
| `RALLYPOINT_GITHUB_REPO`                  | UI (`owner/name`, board lanes)   | no      |
| `RALLYPOINT_GITHUB_TOKEN`                 | UI, optional (rate limits/private repos) | yes |
| `RALLYPOINT_GITHUB_API_URL`               | UI, optional (GitHub Enterprise; default `https://api.github.com`) | no |

The browser never writes. Agents write only through SECURITY DEFINER RPCs that
check `RALLYPOINT_SWARM_SECRET` against a bcrypt hash. The service-role key is
never needed by agents or the UI.

## Database (`registry/rallypoint/swarm/schema.sql`)

All objects live in `public` and are prefixed `swarm_`. Ids are `bigint
identity` unless noted. Timestamps are `timestamptz default now()`.

- `swarm_settings(key text pk, value jsonb)`: keys `visibility`
  (`"public"` | `"private"`), `protocol_version` (e.g. `"p1"`), `goal`
  (`{title, statement, measure:{command,direction,margin,unit}}`).
- `swarm_sessions(id uuid pk default gen_random_uuid(), agent text, role text,
  target text, issue int, pr int, status text check in
  ('working','ended','abandoned') default 'working', summary text,
  started_at, last_seen_at, ended_at)`
- `swarm_progress(id, session_id uuid fk, note text, created_at)`
- `swarm_retros(id, session_id uuid fk, role text, protocol_version text,
  went_well text, friction text, suggestion text, created_at)`
- `swarm_messages(id, thread_id bigint null fk→swarm_messages, session_id uuid
  null fk, author text, kind text check in
  ('question','proposal','handoff','answer','note'), ref text null (e.g.
  `#12`), topic text null, body text, created_at)`
- `swarm_results(id, session_id uuid null, target text, issue int, pr int,
  commit_sha text, baseline_sha text, mode text ('score'|'checks'|'review'), candidate_score double precision null,
  baseline_score double precision, delta double precision, direction text,
  margin double precision, passed boolean, details jsonb, created_at)`: one
  referee run.
- `swarm_versions(id, target text, version text, score double precision, pr
  int, commit_sha text, notes text, created_at)`: shipped versions.
- `swarm_buried(id, target text, issue int, pr int, idea text, concept text
  null, reason text, lesson text, numbers jsonb, created_at)`
- `swarm_concepts(id text pk, name text, description text, created_at)`
- `swarm_concept_trials(id, concept_id text fk, target text, outcome text check
  in ('gained','lost','neutral'), delta double precision, ref text, created_at)`
- `swarm_protocol_changes(id, version text, issue int, pr int, summary text,
  kept boolean null, created_at)`

Views (read through PostgREST):
- `swarm_metrics`: one row with `protocol_version, shipped, buried,
  ship_rate, median_claim_to_close_minutes, progress_per_session,
  retros_since_change, sessions_working`.
- `swarm_fleet`: working sessions with `last_seen_at` in the last 2 h, plus
  their latest progress note (`latest_note`, `latest_note_at`).

RLS: enabled on every table. One `select` policy each:
`using (public.swarm_can_read())`, where `swarm_can_read()` returns true when
visibility is `public`, or when `auth.role() = 'authenticated'`. There are no
insert, update or delete policies. Views use `security_invoker = true`.

Realtime: `swarm_sessions`, `swarm_progress`, `swarm_retros`,
`swarm_messages`, `swarm_results`, `swarm_versions`, `swarm_buried`,
`swarm_concepts`, `swarm_concept_trials` and `swarm_protocol_changes` are in
the `supabase_realtime` publication (`swarm_realtime_wanted()` lists them),
so the dashboard updates live. `schema.sql` adds them idempotently, checking
`pg_publication` and `pg_publication_tables` first, and skips the step on
Postgres without that publication. `swarm_settings`, `swarm_secret` and
`swarm_readers` are never published. Realtime applies the same RLS to
`postgres_changes`, per subscriber and with the subscriber's own token, so a
private swarm sends changes only to signed-in readers that may read the row.
`registry/rallypoint/swarm/realtime.sql` (installed as
`.rallypoint/swarm/realtime.sql`) is that section alone, for projects that
applied an older `schema.sql`; `scripts/test-swarm.mjs` keeps the two
identical. `swarm_realtime_status() returns jsonb` (`{publication,
missing}`, granted to `anon, authenticated`) is what `doctor` checks.

RPCs (execute granted to `anon, authenticated`; all check the secret first):
- `swarm_write(p_secret text, p_table text, p_row jsonb) returns jsonb`:
  inserts into a whitelisted table and returns the row.
- `swarm_update(p_secret text, p_table text, p_id text, p_patch jsonb) returns
  jsonb`: whitelisted tables and columns.
- `swarm_set_setting(p_secret text, p_key text, p_value jsonb) returns jsonb`
- `swarm_check(p_secret text) returns jsonb`: `{ok, schema_version}`, used by
  `doctor`.

Admin only (no grant to anon or authenticated; granted to `service_role`):
- `swarm_set_secret(p_secret text)`: at least 16 characters. Set once with
  `rallypoint swarm connect` (which calls it with the service-role key) or in
  the SQL editor.

## Connect (`rallypoint swarm connect`)

Part of the npm CLI, not the installed runtime. It prompts for the project
URL, the publishable key, the service-role key (hidden, used once, never
saved) and the swarm secret (hidden and typed twice, or generated when left
empty). It calls `swarm_set_secret` with the service-role key, verifies with
`swarm_check` and the publishable key, then writes gitignored env files:
`.rallypoint/swarm/.env.local` (URL, key, secret) for agents, and the
dashboard's `.env.local` (`NEXT_PUBLIC_RALLYPOINT_SUPABASE_URL`,
`NEXT_PUBLIC_RALLYPOINT_SUPABASE_KEY`, `RALLYPOINT_GITHUB_REPO`; never the
secret). Flags: `--url`, `--key`, `--generate`, `--no-db`;
`RALLYPOINT_SUPABASE_SERVICE_KEY` skips the service-key prompt. The runtime
loads `.rallypoint/swarm/.env.local` at start; variables already in the
environment win.

`swarm_schema_version()` returns `1` and is granted to everyone.

## Runtime CLI (`.rallypoint/swarm/swarm.mjs`)

Zero dependencies, Node ≥ 20. `npx rallypoint swarm <cmd>` forwards to it.
Every command accepts `--json`. Exit codes: `0` ok, `1` error, `2` misuse,
`3` referee failed, `4` nothing to do.

| Command | What it does |
| ------- | ------------ |
| `doctor` | checks env, `gh`, git, the config, Supabase reachability, the schema version, the secret, and (a warning only) that the memory tables are in `supabase_realtime`, naming `.rallypoint/swarm/realtime.sql` when they are not |
| `init`   | after `doctor`: creates `target:<name>` labels and stores the goal and visibility in `swarm_settings` |
| `prepare [--agent name]` | opens a session (row plus `.git/rallypoint-swarm/session.json`) |
| `next [target] [--only r1,r2]` | picks the role, finishing first: merger → fixer → reviewer → improver → worker → planner → janitor. Prints `ROLE <role>`, `TARGET <issue/pr or ->`, `READ <role file>` |
| `log "<note>"` | appends a progress note and refreshes `last_seen_at` |
| `say --kind <kind> [--ref #n] [--thread id] "<body>"` | posts a message |
| `inbox [--ref #n]` | reads recent messages |
| `referee [--target t] [--baseline <ref>]` | runs `measure.command` on HEAD and on the baseline (a git worktree of the integration branch), compares by direction and margin, and records the result. Exits `0` or `3` |
| `bury --idea … --reason … --lesson … [--concept c] [--target t]` | records a buried idea with its numbers (the latest result) |
| `ship --version v… [--target t] [--pr n]` | records a shipped version with its score (merger only, after merge) |
| `concept add <id> "<name>" "<description>"` / `concept trial <id> --target t --outcome gained\|lost\|neutral [--delta d]` | concepts and trials |
| `plan <plan.json>` | opens GitHub issues: `[{title, body, target, concept, type, prio}]` |
| `brief` | the strategist's digest: goal, targets, versions, buried ideas, concept trials, open work |
| `metrics` | the `swarm_metrics` row |
| `retro --well … --friction … --suggest …` | writes the retro and ends the session |
| `status` | a JSON snapshot for the conductor |

### Measure modes: not every swarm has a reward function

- `score`: `measure.command` prints a number on its last stdout line, or
  JSON `{"score": n}`. The candidate must beat the baseline by `margin` in
  `direction`. This is the mode Swarm Arena uses (Elo).
- `checks`: every `measure.checks[].command` must exit 0 (build, tests, e2e,
  a Lighthouse or a11y budget script…). There is no number and no baseline
  run. This fits a website or product build.
- `review`: no automated referee. `referee` records a pass with
  `details.mode = "review"`, and the independent reviewer's verdict against
  the issue's acceptance criteria is the gate, as in vanilla.

In every mode, review and merge stay independent. Progress without a score
is shown as delivery: merged vs open issues, per target and per milestone.

## Config (`.rallypoint/swarm.json`)

```json
{
  "goal": { "title": "", "statement": "", "pitch": "" },
  "measure": {
    "mode": "checks",
    "label": "",
    "command": "",
    "direction": "higher",
    "margin": 0,
    "unit": "",
    "checks": [{ "name": "build", "command": "npm run build" }],
    "timeoutSeconds": 1800
  },
  "targets": [{ "id": "api", "name": "API", "description": "" }],
  "ui": {
    "project": { "name": "", "tagline": "" },
    "targets": { "api": { "color": "#2f5bd3" } },
    "vocabulary": { "shipped": "shipped", "buried": "buried", "version": "version" },
    "includeUiTarget": true
  },
  "visibility": "public",
  "protocolVersion": "p1",
  "roleOrder": ["merger","fixer","reviewer","improver","worker","planner","janitor"],
  "improverRetroThreshold": 3,
  "conductor": { "concurrency": 4, "budget": null, "focus": "balanced", "pace": "self" },
  "tunablePaths": [".rallypoint/roles/", ".rallypoint/swarm/skills/", ".rallypoint/swarm/playbooks/"],
  "frozenPaths": [".rallypoint/scripts/", ".rallypoint/swarm/swarm.mjs", ".rallypoint/swarm/lib/", ".rallypoint/swarm/schema.sql", ".rallypoint/swarm/realtime.sql", ".rallypoint/swarm.json", ".rallypoint/roles/reviewer.md", ".rallypoint/roles/merger.md", ".rallypoint/roles/improver.md"]
}
```

## Per-project frontend

Rallypoint ships only a **scaffold**: every route, wired read-only to the
data layer (`_lib/queries.ts`), with minimal default rendering. Each project
gets its own starting point. When it installs `swarm-ui` or
`swarm-dashboard`, the CLI **generates** `app/swarm/swarm.config.ts` from
`.rallypoint/swarm.json` (project, goal, measure, targets with colours,
vocabulary). That file is project-owned: Rallypoint writes it only when it is
absent and never overwrites it. With `ui.includeUiTarget`, `swarm init` adds
a `ui` target and opens starter UI issues, so the project's own swarm grows
the frontend.

## Genesis (pitch → project-specific starting point)

The wizard's main input is a **pitch** of one or two sentences, stored in
`goal.pitch`. The `swarm-genesis` skill
(`.claude/skills/swarm-genesis/SKILL.md`, body in
`.rallypoint/swarm/skills/swarm-genesis.md`) runs once in a coding agent. It
first interviews the operator with interview-me (https://interviewme.at) until
a brief in `docs/briefs/<slug>.md` is confirmed, and initializes Impeccable
(https://impeccable.style) so that `PRODUCT.md` and `DESIGN.md` come from that
brief. Then it turns the pitch, the brief and any wizard choices into: targets, the measure and a
referee script, a completed `.rallypoint/swarm.json`, the project's
`app/swarm/swarm.config.ts` (when a UI is installed), per-target playbooks,
and the first `plan.json`, including UI issues when `ui.includeUiTarget` is
set. It delivers all of that as one PR for independent review. Swarm Arena
is the worked example: "A swarm of AI agents building chess, Go, Othello and
Hex engines that keep getting stronger. Watch them climb, read the code, or
play one yourself."

## UI routes (inside `app/swarm/`)

These match Swarm Arena's navigation one to one. The arena's words come from
`swarmConfig.vocabulary` / `swarmConfig.nav` labels ("Engines" = targets,
"Games" = referee runs).

| Section | Arena route | Scaffold route | Reads |
| ------- | ----------- | -------------- | ----- |
| Results | Progress `/` | `/swarm` | goal, score chart (score mode) or delivery bar (checks/review), totals |
| Results | News `/news` | `/swarm/news` | a derived feed: versions shipped, ideas buried, protocol changes, merged PRs |
| Results | Engines `/engines` | `/swarm/targets`, `/swarm/targets/[id]` | targets from config; per target: latest version, results, buried, open issues (`target:<id>`) |
| Results | Games `/games` | `/swarm/results`, `/swarm/results/[id]` | referee runs (`swarm_results`) with checks or scores |
| Results | Versions `/versions` | `/swarm/versions` | `swarm_versions` |
| Results | Ideas buried `/graveyard` | `/swarm/buried` | `swarm_buried` |
| Swarm | Fleet `/fleet` | `/swarm/fleet` | `swarm_fleet` |
| Swarm | Sessions `/sessions` | `/swarm/sessions` | sessions plus retros and progress |
| Swarm | Rallypoint `/rallypoint` | `/swarm/rallypoint` | GitHub lanes: backlog, claimed, held, in review, changes asked, approved, merged |
| Swarm | Board `/board` | `/swarm/board` | the full record from memory: results, versions, buried, protocol changes, messages, in one timeline with filters |
| Swarm | Messages `/messages` | `/swarm/messages` | `swarm_messages` threads |
| Learn | How it works `/how-it-works` | `/swarm/how-it-works` | generated from config: goal, measure mode, ship steps, roles |
| Learn | Protocol `/protocol` | `/swarm/protocol` | `swarm_metrics`, role order, protocol changes, rules, start prompts |
| Learn | Concepts `/concepts` | `/swarm/concepts` | concepts × targets matrix |
| Learn | Skills `/skills` | `/swarm/skills` | role prompts, skills and playbooks, read from the repo through GitHub contents (`.rallypoint/roles/`, `.rallypoint/swarm/skills/`, `.rallypoint/swarm/playbooks/`) |
| — | — | `/swarm/sign-in` | private mode only |

Live updates: the layout mounts `<LiveRefresh>` (`_components/live.tsx`)
once. It subscribes to Realtime `postgres_changes` on the published tables
(`LIVE_TABLES` in `_lib/live.ts`) and answers a burst of changes with one
`router.refresh()`, debounced to 1.5 s, so the server-rendered pages stay the
only source of truth. It shows "Live", "Reconnecting…", "Every minute"
(polling) or "Paused" in the top bar, refreshes every 60 s while Realtime is
unavailable, and waits while the tab is hidden or a component holds the
shared signal (`useLiveHold(active)`, as the fleet replay does). Public mode
subscribes with the publishable key. Private mode passes the reader's own
access token to `setAuth`: the session cookie stays httpOnly, and the
`liveToken()` Server Action (`_lib/live-token.ts`) returns that token only to
a request carrying a valid session cookie. The browser never sees the
service-role key or the swarm secret. Needs `@supabase/realtime-js` in the
host app (the CLI names it when missing).

Private folders: `app/swarm/_lib`, `app/swarm/_components`. Styling:
`app/swarm/swarm.css`, scoped under `.rp-swarm`, Rallypoint tokens as CSS
variables. No Tailwind dependency and no `@/` alias: relative imports only.
