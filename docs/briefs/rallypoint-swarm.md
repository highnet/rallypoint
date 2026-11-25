# Brief: Rallypoint Swarm

_Interview: 2026-11-25. Status: awaiting confirmation._

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
| Role choice         | Human pastes a role prompt                             | Session picks its own role, finishing first: merger → fixer → reviewer → improver → worker → planner → janitor |
| Quality gate        | Independent review bound to head SHA                   | + a **referee** that measures every change; it ships only if it wins, otherwise it is buried with its numbers |
| Learning            | Improver on before/after delivery metrics              | + a retro from every session, buried ideas, concepts ported across targets, metrics (ship rate, claim→close) |
| Agent communication | Agents never message each other                        | Agents ask, propose and hand off in board threads, stored in memory and visible to all |
| Running it          | Prompts per role                                       | Conductor `/loop` dispatches one session per role and target (concurrency, budget, focus, escalation) |
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

1. **Site:** a two-tier presentation on the homepage, a Swarm section, the
   vanilla-vs-swarm comparison, Swarm Arena proof, and a **goal wizard** page
   (100-goal gallery → your goal → your measure → generated setup).
2. **Registry item `swarm`:** role prompts and skills for the self-picking
   role, retro, referee, strategist (concepts) and conductor, layered on `loop`.
3. **Generic CLI:** `rallypoint swarm …` commands (`prepare`, `next`, `log`,
   `retro`, `submit`, `plan`, `brief`, `metrics`) talking to the user's own
   Supabase.
4. **Supabase schema:** migrations the user applies to their own project.

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

## Assumptions (correct any)

- The referee is generic. The project supplies a command that prints a score,
  and a change lands only if it beats main by the configured margin. The
  wizard suggests forms such as tests, benchmarks, proof checks, eval scores or
  simulations, but the user defines the measure.
- Messages count as part of "memory". They are visible to everyone, with no
  private side channels, so the spirit of "agents never talk in private" holds.
- Arena numbers on the site link to the live arena rather than hard-coding Elo
  figures that go stale.
- The CLI ships in the same zero-dependency `rallypoint` npm package, and
  Supabase access goes through its REST API, so no SDK dependency.
- I could not read `highnet/swarm-arena` (attaching it was blocked), so the CLI
  and schema are rebuilt from the public site, not copied.

## Suggested first step

Site first: the two-tier homepage plus the wizard. Then the `swarm` registry
item, the CLI and the schema.
