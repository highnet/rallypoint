# Brief: Rallypoint Swarm

_Interview: 2026-11-25. Status: confirmed ("LGTM, start building"). Built in this rally; see `docs/swarm/CONTRACT.md` for the exact names._

## Core

Rallypoint Swarm is the next tier of Rallypoint. It is a protocol that lets a
swarm of agents take on hard tasks that no single agent finishes alone. It gets
there by **learning across attempts**: every session leaves a retro, every
failed idea is buried with its numbers, and every concept that worked is ported
to the next target. The improver turns all of that into changes to the
protocol itself.

It works the way a good engineering team does. A planner breaks the goal into
issues. Each worker claims exactly one issue and delivers one pull request. A
referee measures the result, and a separate agent reviews it, because no agent
approves its own work.

## The real challenge

Vanilla Rallypoint coordinates agents well on a known backlog. A hard goal has
no backlog and no finish line. The swarm has to plan, try, measure, fail, and
remember why, across many sessions that never share a context window. **The
missing piece is shared memory**, and that is the thing Swarm adds.

## Vanilla vs Swarm

|                     | Rallypoint (vanilla)                                   | Rallypoint Swarm                                                                 |
| ------------------- | ------------------------------------------------------ | -------------------------------------------------------------------------------- |
| Coordination        | GitHub only: issues, claim refs, labels, PRs           | Same; GitHub still owns the work                                                 |
| Memory              | None beyond GitHub history                             | Bring-your-own Supabase: sessions, progress logs, retros, messages, results, buried ideas, concepts |
| Role choice         | The orchestrator names the next role                   | Session picks its own role, finishing first: merger → fixer → reviewer → improver → worker → planner → janitor |
| Quality gate        | Independent review bound to head SHA                   | + a **referee** that measures every change; it ships only if it wins, otherwise it is buried with its numbers |
| Learning            | Improver on before/after delivery metrics              | + a retro from every session, buried ideas, concepts ported across targets, metrics (ship rate, claim→close) |
| Agent communication | Agents never message each other                        | Agents ask, propose and hand off in board threads, stored in memory and visible to all |
| Running a fleet     | The orchestrator dispatches one session per role       | The orchestrator runs as the conductor `/loop`: one session per role and target (memory, concurrency, budget, focus, escalation) |
| Visibility          | GitHub views                                           | Fleet, Sessions, Board, Messages, Progress, Ideas buried, Concepts views         |
| Setup               | `npx rallypoint@latest add loop` + `init`              | More setup: a Supabase project, the CLI, the wizard that picks the goal and the measure |
| Live proof          | UTON OS (1,328 PRs opened, 1,256 merged in 8 weeks)    | Swarm Arena (swarm-arena-race.vercel.app): chess, Go 9×9, Othello and Hex engines written from scratch, each version measured against Stockfish, GNU Go, Edax and an MCTS ladder |

## Picture

A developer opens rallypoint.tools and sees two tiers at once. **Rallypoint**
runs on GitHub alone with zero setup. **Rallypoint Swarm** adds memory, a
referee and a conductor: more setup, more capability. Swarm Arena is shown as
the live example. They open the wizard, browse the 100-goal gallery for
inspiration, then write their own goal and say how progress gets measured. The
wizard gives them the commands to run against their own repository and their
own Supabase project.

## References

- Swarm Arena, the running implementation of everything above, including the
  protocol page's prompts, roles and "rules that do not bend".
- The 100-goal list, used as the inspiration gallery in the wizard. It is not
  a catalog of verified recipes.

## Edges (what it must not be)

- **Not a hosted service.** No Rallypoint servers, accounts or telemetry. The
  user owns their GitHub repository and their Supabase project. Nothing calls home.
- **Not breaking vanilla.** `add loop`, `init` and the current promises keep
  working. Swarm is additive, a branch built on vanilla.
- **Not game-specific.** No chess, Go or Elo in the generic install. The arena
  is one example.
- **Not self-grading.** The referee, review, merge and the scripts stay frozen
  and out of the improver's reach.

## Success

Within ten seconds on rallypoint.tools, a visitor sees a **clear two-tier
choice** (Rallypoint vs Rallypoint Swarm, what each costs and gives), Swarm
Arena as proof, and a working path to start either one.

## Scope of v1 (built in this rally)

1. **Site:** a two-tier chooser under the homepage hero, a `#swarm` band
   (the comparison table, the mechanism, Swarm Arena as proof), the `/swarm`
   product page (requirements and setup), and the **pitch-first wizard** at
   `/swarm/wizard`.
2. **Registry item `swarm`** (requires `loop`): `SWARM.md`,
   `.rallypoint/swarm.json`, the runtime (`npx rallypoint swarm …`), the
   memory schema, and the skills (agent, conductor, strategist, steward,
   genesis, concepts) plus playbooks.
3. **Supabase schema:** the user applies it to their own project. Reads go
   through RLS: public, or signed-in with an optional email allow-list.
   Writes happen only through RPCs that check a bcrypt-hashed secret.
4. **Registry items `swarm-ui` and `swarm-dashboard`:** the route scaffold,
   installed into the user's Next.js app, or as a standalone `swarm-ui/`
   app.

## Decisions made after confirmation

- **Not every swarm has a reward function.** `measure.mode` is `score` (a
  number that must beat main, as in Swarm Arena's Elo), `checks` (named
  commands must pass, for a website or product), or `review` (independent
  review is the gate, as in vanilla). Without a score, progress is shown as
  delivery: merged vs open issues.
- **The wizard starts from a pitch.** One or two sentences, with Swarm Arena
  as the worked example: "A swarm of AI agents building chess, Go, Othello
  and Hex engines that keep getting stronger. Watch them climb, read the
  code, or play one yourself." The 100 goals are inspiration only. Every
  other choice is optional.
- **Genesis** (`swarm-genesis` skill) turns the pitch into this project's
  starting point: targets, measure and referee, playbooks, concepts, UI
  config and the first plan. It delivers all of that as one pull request for
  independent review.
- **The frontend is custom per project.** Rallypoint ships only a scaffold
  of every Swarm Arena route. Each project gets a generated, project-owned
  `swarm.config.ts` (names, colours, vocabulary such as "Engines", "Games"
  and "landed", nav and theme). The swarm can then grow the frontend itself
  as a `ui` target.

## Frontend integration (the swarm UI)

The arena-style views (Progress, Fleet, Sessions, Board, Messages, Ideas
buried, Concepts, Protocol) ship as a registry item, shadcn-style:

```bash
npx rallypoint@latest add swarm-ui
```

The user owns and restyles the code it writes. It reads their own Supabase,
and Rallypoint stores nothing. There are two shapes, chosen in the wizard or
with a flag:

- **The UI is the product.** Like Swarm Arena, the swarm's public record is
  the site. In an existing Next.js App Router project, `add swarm-ui` writes
  `app/swarm/*` routes and components into it.
- **A standalone dashboard.** For a project with no Next.js app (Rust, Python,
  a proof library…), or when the dashboard should stay separate,
  `add swarm-dashboard` scaffolds a small Next.js app in `swarm-ui/`
  (plain CSS with Rallypoint tokens, no Tailwind). That app is pre-wired to
  their Supabase and deployable to Vercel.

**Access is customizable.** The default is public and read-only, like Swarm
Arena: the anon key plus read-only RLS. An option puts it behind Supabase
Auth so only the team sees it. Only agents write, through the CLI with a
server-side secret, and the browser never writes.

**Look:** Rallypoint's design system (signal colours, role flags) through CSS
variables, so it reads as Rallypoint and the user can retheme it.

## Design

- Designed with the **impeccable** skill, as an **upgrade to Rallypoint**, not
  a new brand. It uses the same system (`DESIGN.md`,
  `.impeccable/design.json`, `PRODUCT.md`): same type, tokens and signal
  language. Swarm reads as the next tier of one product.
- It keeps the PRODUCT.md principles: draw the mechanism (memory, referee
  gate and conductor as real diagrams), GitHub nouns first, every command
  truthful and copyable, and none of the listed anti-references.
- Each new surface (homepage tiers, Swarm section, wizard) gets an impeccable
  surface note and a critique pass under `.impeccable/`.

## Assumptions still open (correct any)

- Arena numbers on the site link to the live arena instead of hard-coding
  Elo figures that go stale.
- The CLI ships in the same zero-dependency `rallypoint` npm package. Supabase
  access goes through its REST API, with no SDK.
- I could not read `highnet/swarm-arena` (attaching it was blocked), so the
  runtime, schema and UI are rebuilt from the public site, not copied. The
  arena's own `npm run arena -- …` commands map to `npx rallypoint swarm …`.
- The schema is tested on a local Postgres 16 with Supabase's `auth` helpers
  stubbed, and through a PostgREST-shaped shim, not on a live Supabase
  project.
