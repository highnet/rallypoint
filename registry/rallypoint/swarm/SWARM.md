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
| `.rallypoint/swarm/realtime.sql` | turns on live dashboard updates for a project on an older schema | no (frozen) |
| `.rallypoint/swarm/skills/` | agent, conductor, strategist, steward, genesis, concepts | yes |
| `.rallypoint/swarm/playbooks/` | one per target: what works, what failed, why | yes |
| `.agents/skills/swarm-*/SKILL.md` | native skill entry points for Codex | no |
| `.claude/skills/swarm-*/SKILL.md` | native skill entry points for Claude Code | no |

## Set up

1. Install vanilla first, then Swarm:

   ```bash
   npx rallypoint@latest add loop && npx rallypoint@latest init
   npx rallypoint@latest add swarm
   ```

2. Create a Supabase project, or use one you have. Apply
   `.rallypoint/swarm/schema.sql` in its SQL editor. It also adds the memory
   tables to Supabase Realtime, so the dashboard updates live (RLS still
   decides who hears a change). Applied an older `schema.sql`? Re-apply it,
   or run just `.rallypoint/swarm/realtime.sql`; `swarm doctor` says when.

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

   > Run the native swarm-genesis skill. Pitch: <your pitch>.

   It first interviews you with interview-me (https://interviewme.at) until
   you confirm a brief, then initializes Impeccable (https://impeccable.style)
   so `PRODUCT.md` and `DESIGN.md` come from that brief. Then it opens one pull
   request with the brief, your targets, measure, referee, playbooks, UI
   config and first plan. Have it reviewed and merged by someone else.
6. `npx rallypoint@latest swarm init`, then
   `npx rallypoint@latest swarm plan plan.json`.
7. Start working. Either one session at a time:

   > Run a swarm agent. Use the native swarm-agent skill and follow its shared Rallypoint instructions.

   or leave it running in Claude Code with `/loop /swarm-conductor`.

New installs register both sets of skills. For an existing install, review
the new `loop` and `swarm` items with `rallypoint view`, then run
`rallypoint add loop --force` and `rallypoint add swarm --force` to replace
older installed runtime files. The swarm install preserves the existing
`.rallypoint/swarm.json`.

Start a fresh session in the project
root after installation. Invoke `$swarm-genesis`, `$swarm-agent`, `$swarm-conductor`,
`$swarm-steward`, or `$swarm-strategist` in Codex. In Claude Code, use a
leading slash instead of a dollar sign. Both use the same instructions under
`.rallypoint/swarm/skills/`.

For Codex Cloud, bind these in the environment before dispatching:
- Allow HTTPS to `api.github.com`, `github.com`, `registry.npmjs.org`, and the
  host named by `RALLYPOINT_SUPABASE_URL`.
- Set `RALLYPOINT_SUPABASE_URL`, and bind `RALLYPOINT_SUPABASE_KEY` and
  `RALLYPOINT_SWARM_SECRET` as secrets. Keep credentials out of prompts.
- Bind a GitHub credential for the checkout's repository with the permissions
  the role needs. The GitHub CLI reads `GH_TOKEN`. REST accepts
  `GH_TOKEN` or `GITHUB_TOKEN`. Set `RALLYPOINT_TRANSPORT=rest` for a known
  REST-only proxy. Otherwise automatic mode tries REST if GraphQL is denied.
- In the running checkout, run `npx rallypoint swarm doctor`. An API-host
  denial points to the network policy. An authentication error points to
  the bound GitHub credential.

If the hosted shell uses an HTTPS proxy, enable Node's environment proxy
support in that shell. Configure it in the Cloud environment as well if
its hosted workers use an HTTPS proxy.

```bash
export NODE_USE_ENV_PROXY=1
node .rallypoint/swarm/swarm.mjs doctor
```

When both the `schema` and `secret` checks report `fetch failed`, retry with the
proxy enabled before applying schema changes. Continue when doctor reports
`Ready.`.

### Claude Code local

Install Claude Code, run `claude auth login`, then run
`npx rallypoint swarm doctor --runtime claude-local` in the checkout. Use
`swarm dispatch --runtime claude-local --prompt "<role prompt>"` to run one
foreground `claude -p --permission-mode bypassPermissions` process with the
role prompt on stdin. This allows an unattended worker to edit files and
run tools such as Git and npm without permission prompts. Use it in a
trusted, isolated checkout with only the credentials the role needs.

### Validate one exact job

Run the read-only check before acquiring a claim or lease. Use `--issue` for
a worker and `--pr` for a reviewer, fixer, or merger. The selected runtime
determines which native entry point the check requires.

```bash
npx rallypoint swarm dispatch --runtime claude-local --role worker --issue 12 --agent vienna-worker-12 --dry-run
npx rallypoint swarm dispatch --runtime codex-local --role reviewer --pr 34 --agent vienna-reviewer-34 --dry-run
```

The check reads the named GitHub item, verifies it fits the role, and lists
the instruction files it found. It neither starts a client nor reserves
work. Acquire any role lease through `lease.mjs`, then run the same command
without `--dry-run`. A worker claims its named issue from inside its role.
After the foreground client exits, check the reported session with
`swarm retros --session <session-id> --limit 1 --json` before dispatching again.

### Claude Code cloud

Use Claude Code's remote-session tools to start one separate remote session
per role. Set up GitHub access and Rallypoint memory in the remote checkout.
Run `swarm doctor` there before using the environment for roles.

### Codex local

Install the Codex CLI, run `codex login`, and run
`npx rallypoint swarm doctor --runtime codex-local`. Read
`.rallypoint/swarm/skills/swarm-conductor.md` in the conductor session.
Use `swarm dispatch --runtime codex-local --prompt "<role prompt>"` to run
one foreground `codex exec` process from the repository root. The launcher
uses Codex's workspace-write sandbox and enables network access for GitHub
and Swarm memory.

Both local runtimes inherit your environment and stream output. The command
reports the role process's exit code and returns `0` on success or `1` for
any nonzero child exit. With `--json`, stdout contains `{ runtime, childStatus }`
and role output streams to stderr. The default wait is two hours.
Override it with `--max-wait-seconds`. After a timeout, inspect the role's
checkout, pull request and retro before retrying. After a normal exit, check
the role's retro before reusing its slot.

### Codex cloud

The CLI may see no environments created under Settings → Codex Cloud
([openai/codex#50182](https://github.com/openai/codex/issues/50182)). If it
cannot see yours, start each role as a separate task in the Codex Cloud UI
with the same role prompt. Keep its slot occupied until the task finishes
and verify its retro before starting another role.

Choose a Codex Cloud environment for this repository that the submitting
Codex CLI account can access. Configure GitHub access and the Rallypoint
Supabase settings in that environment. Hosted workers use the environment's
own checkout, network policy, and credentials. Keep credentials out of the
dispatch prompt. Run `swarm doctor` from a task in that environment before
using it for dispatches.

```bash
export RALLYPOINT_CODEX_CLOUD_ENV='<environment ID or name>'
node .rallypoint/swarm/swarm.mjs dispatch --runtime codex-cloud --branch main --prompt \
  'Read .rallypoint/swarm/skills/swarm-agent.md and follow it. Take one CMS worker role with swarm next cms --only worker. Log progress and leave a retro.'
```

The command uses the experimental `codex cloud exec` and `codex cloud status`
commands, with one attempt per task. The submitting CLI needs a Codex login
that can see the environment. Polling waits up to two hours by default
(`--max-wait-seconds` overrides this) and retries failed status checks twice.
If polling stops before confirming a terminal state, keep the slot reserved
and check the printed task URL before dispatching another worker.

A Cloud task marked `READY` has finished. A worker must still push its branch
and open its PR from inside the hosted task. Configure a GitHub credential in
the Cloud environment with permission to push branches and open PRs for the
repository. The conductor still selects and guards the job and verifies its
retro.

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
