# Rallypoint Swarm

Rallypoint Swarm is the next tier of Rallypoint. It is a protocol that lets a
swarm of agents take on hard tasks no single agent finishes alone. It works
the way a good engineering team does. A planner breaks the goal into issues.
Each worker claims exactly one issue and delivers one pull request. A
referee measures the result, and a separate agent reviews it, because no
agent approves its own work. Every session writes a retro, and an improver
turns those retros into changes to the protocol itself.

The swarm gets further than any one session because it **learns across
attempts**. Progress notes, retros, buried ideas with their numbers, and
concepts that carried from one target to another all live in shared memory,
and every new session starts from them.

## What Swarm adds to vanilla Rallypoint

Vanilla (`AGENTIC_LOOP.md`) still governs the work: claims, branches, pull
requests, labels, reviews, merges. Swarm adds:

| | Vanilla | Swarm |
| --- | --- | --- |
| Memory | GitHub history | Your own Supabase project: sessions, progress, retros, messages, results, versions, buried ideas, concepts |
| Role choice | The orchestrator names the next role; each session takes one | `swarm next` picks it, finish-first: merger → fixer → reviewer → improver → worker → planner → janitor |
| Quality gate | Independent review | A referee first (`score`, `checks` or `review` mode), then independent review |
| Learning | Improver on delivery metrics | Plus a retro from every session, buried ideas, and concepts ported across targets |
| Talking | None | Public messages in memory: questions, proposals, hand-offs. No private channels |
| Running a fleet | The orchestrator dispatches one session per role | The orchestrator runs as the conductor `/loop`: one session per role and target, with memory, concurrency, budget and escalation |
| Watching it | GitHub | Optional swarm UI: a route scaffold your project grows into its own frontend |

## Files

| Path | What it is | Improver may edit |
| --- | --- | --- |
| `.rallypoint/swarm.json` | goal, measure, targets, UI words, conductor settings | no (frozen) |
| `.rallypoint/swarm/swarm.mjs`, `lib/` | the runtime (`npx rallypoint swarm …`) | no (frozen) |
| `.rallypoint/swarm/schema.sql` | the memory schema for your Supabase project | no (frozen) |
| `.rallypoint/swarm/skills/` | agent, conductor, strategist, steward, genesis, concepts | yes |
| `.rallypoint/swarm/playbooks/` | one per target: what works, what failed, why | yes |
| `.claude/skills/swarm-*/SKILL.md` | pointers so Claude Code finds the skills | no |

## Set up

1. Install vanilla first, then Swarm:

   ```bash
   npx rallypoint@latest add loop && npx rallypoint@latest init
   npx rallypoint@latest add swarm
   ```

2. Create a Supabase project, or use one you have. Apply
   `.rallypoint/swarm/schema.sql` in its SQL editor.

3. Connect it. This asks for the project URL, the publishable (anon) key,
   the service-role key (hidden, used once, never saved) and the swarm
   secret (hidden, 16+ characters, or leave it empty to generate one):

   ```bash
   npx rallypoint@latest swarm connect
   ```

   It sets the secret in the database, checks that it works, and writes
   gitignored env files: `.rallypoint/swarm/.env.local` for agents and the
   dashboard's `.env.local` (URL and publishable key only). Variables already
   in the environment win over the files, so agents elsewhere can still use:

   ```bash
   export RALLYPOINT_SUPABASE_URL=https://<project>.supabase.co
   export RALLYPOINT_SUPABASE_KEY=<publishable (anon) key>
   export RALLYPOINT_SWARM_SECRET=<the swarm secret>
   ```

4. Check everything: `npx rallypoint@latest swarm doctor`.
5. **Genesis.** Paste into a coding agent on the repository:

   > Run swarm genesis. Follow .claude/skills/swarm-genesis/SKILL.md. Pitch: <your pitch>.

   It first interviews you with interview-me (https://interviewme.at) until
   you confirm a brief, then initializes Impeccable (https://impeccable.style)
   so `PRODUCT.md` and `DESIGN.md` come from that brief. Then it opens one pull
   request with the brief, your targets, measure, referee, playbooks, UI
   config and first plan. Have it reviewed and merged by someone else.
6. `npx rallypoint@latest swarm init`, then
   `npx rallypoint@latest swarm plan plan.json`.
7. Start working. Either one session at a time:

   > Run a swarm agent. Follow .claude/skills/swarm-agent/SKILL.md exactly.

   or leave it running in Claude Code with `/loop /swarm-conductor`.

Optional: a UI. `npx rallypoint@latest add swarm-ui` adds the route scaffold
into an existing Next.js app, where the UI is the product.
`npx rallypoint@latest add swarm-dashboard` creates a standalone `swarm-ui/`
app instead. Both read your memory and GitHub and never write.

## Measure modes

Not every swarm has a reward function.

- `score`: a command prints a number, and a change must beat the
  integration branch by `margin`. Swarm Arena uses Elo.
- `checks`: named commands must all pass, such as build, tests, e2e, or a
  performance or accessibility budget. This fits a website or product.
- `review`: nothing automated, so independent review against the
  acceptance criteria is the gate, as in vanilla.

A change that loses is not merged. It is **buried** with its numbers and its
lesson, so nobody retries it blindly.

## Rules that do not bend

1. One issue, one branch, one pull request. Nobody pushes to the integration
   branch.
2. Claims are atomic: `claim.mjs` reserves the issue before anything else
   changes.
3. Never review or approve your own work. Verdicts go through `review.mjs`
   only.
4. Each role runs as its own session. Subagents help inside one role and never
   write to GitHub or memory.
5. Every change with a measure is refereed. Losing changes are buried, never
   merged.
6. The improver may change only `tunablePaths`. The referee, the scripts, the
   schema and everything that judges are frozen.
7. GitHub owns the work and memory owns the learning. Nothing calls
   Rallypoint, and there is no Rallypoint server.
8. `RALLYPOINT_SWARM_SECRET` lives only in agents' environments: never in a
   commit, an issue, a message, a log or a browser.
