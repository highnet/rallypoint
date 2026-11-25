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
  commit_sha text, baseline_sha text, candidate_score double precision,
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

RPCs (execute granted to `anon, authenticated`; all check the secret first):
- `swarm_write(p_secret text, p_table text, p_row jsonb) returns jsonb`:
  inserts into a whitelisted table and returns the row.
- `swarm_update(p_secret text, p_table text, p_id text, p_patch jsonb) returns
  jsonb`: whitelisted tables and columns.
- `swarm_set_setting(p_secret text, p_key text, p_value jsonb) returns jsonb`
- `swarm_check(p_secret text) returns jsonb`: `{ok, schema_version}`, used by
  `doctor`.

Admin only (no grant to anon or authenticated):
- `swarm_set_secret(p_secret text)`: run once in the SQL editor.

`swarm_schema_version()` returns `1` and is granted to everyone.

## Runtime CLI (`.rallypoint/swarm/swarm.mjs`)

Zero dependencies, Node ≥ 20. `npx rallypoint swarm <cmd>` forwards to it.
Every command accepts `--json`. Exit codes: `0` ok, `1` error, `2` misuse,
`3` referee failed, `4` nothing to do.

| Command | What it does |
| ------- | ------------ |
| `doctor` | checks env, `gh`, git, the config, Supabase reachability, the schema version and the secret |
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

The measure command must print a number on its last stdout line, or JSON
`{"score": n}`.

## Config (`.rallypoint/swarm.json`)

```json
{
  "goal": { "title": "", "statement": "" },
  "measure": { "command": "", "direction": "higher", "margin": 0, "unit": "", "timeoutSeconds": 1800 },
  "targets": [],
  "visibility": "public",
  "protocolVersion": "p1",
  "roleOrder": ["merger","fixer","reviewer","improver","worker","planner","janitor"],
  "improverRetroThreshold": 3,
  "conductor": { "concurrency": 4, "budget": null, "focus": "balanced", "pace": "self" },
  "tunablePaths": [".rallypoint/roles/", ".rallypoint/swarm/skills/", ".rallypoint/swarm/playbooks/"],
  "frozenPaths": [".rallypoint/scripts/", ".rallypoint/swarm/swarm.mjs", ".rallypoint/swarm/lib/", ".rallypoint/swarm/schema.sql", ".rallypoint/swarm.json", ".rallypoint/roles/reviewer.md", ".rallypoint/roles/merger.md", ".rallypoint/roles/improver.md"]
}
```

## UI routes (inside `app/swarm/`)

`/swarm` (progress) · `/swarm/fleet` · `/swarm/sessions` · `/swarm/board` ·
`/swarm/messages` · `/swarm/buried` · `/swarm/concepts` · `/swarm/protocol` ·
`/swarm/sign-in` (private mode only). Private folders: `app/swarm/_lib`,
`app/swarm/_components`. Styling: `app/swarm/swarm.css`, scoped under
`.rp-swarm`, Rallypoint tokens as CSS variables. No Tailwind dependency and
no `@/` alias: relative imports only.
