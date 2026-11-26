# Growing the scaffold into your own frontend

Rallypoint ships the swarm UI as a scaffold: every route, wired to your data,
drawn plainly. The frontend that tells your project's story is yours to build,
by hand or by the swarm itself through a `ui` target.

## Where things live

| File | What it is | Who edits it |
| ---- | ---------- | ------------ |
| `app/swarm/swarm.config.ts` | project name, goal copy, measure mode and label, targets with colours, vocabulary, navigation, theme variables | you; generated once, never overwritten |
| `app/swarm/_lib/queries.ts` | every read the pages make, one function per page | extend it; keep it read-only |
| `app/swarm/_lib/supabase.ts`, `_lib/github.ts` | the PostgREST and GitHub REST readers | rarely |
| `app/swarm/_lib/types.ts` | row types for every contract table and view | only when the schema changes |
| `app/swarm/_components/*` | the overview bands (hero, target cards, steps), nav icons and target marks, flags, chips, panels, the step chart, the delivery bar, the fleet graph's mount and replay bar (`fleet-graph.tsx`) | freely |
| `app/swarm/_lib/fleet-graph.ts` | the adapter from sessions, memory and GitHub to the fleet graph's `SwarmInput` | freely; it decides what a sector, an agent and a work item are |
| `app/swarm/_graph/*` | the fleet graph engine (`@rallypoint/swarm-graph`, D3, framework-free) | rarely; take upstream changes whole |
| `app/swarm/**/page.tsx` | thin pages: `getSwarmContext()`, one query, render | freely |
| `app/swarm/swarm.css` | scoped styles and theme variables | freely |

## Rules that keep it honest

1. **Pages read only through `_lib/queries.ts`.** A page never calls
   `fetch`, PostgREST or GitHub directly. Add a query function, then render
   its result. That keeps data access in one reviewable place.
2. **Never write.** No inserts, updates, RPCs with side effects, or GitHub
   mutations from the UI. Agents write through the CLI with the swarm
   secret; the browser only reads. Never put the service-role key or
   `RALLYPOINT_SWARM_SECRET` in the app.
3. **Never assume a score.** Branch on `measureMode()`: `score` swarms have
   numbers; `checks` and `review` swarms show delivery and named checks.
4. **Gate every page.** Start with `getSwarmContext()` and render `<Gate>`
   when it is not `ok`, so missing env, a missing schema and private mode
   keep working.
5. **Stay accessible.** Colour never carries meaning alone (pair it with a
   name, a symbol or a shape); every chart has a text or table equivalent;
   keyboard focus stays visible; motion respects `prefers-reduced-motion`;
   nothing overflows at 375px.
6. **Words come from `swarmConfig`.** Use `word("shipped")`, target names
   and the nav from the config, not hard-coded project nouns.

## The fleet graph

`/swarm/fleet` opens with an animated graph of the swarm, the same engine as
Swarm Arena's fleet page (`@rallypoint/swarm-graph`, copied into
`app/swarm/_graph/`), with the session table below it as its text
equivalent. It follows the protocol: your targets ring the integration
branch; open issues wait outside their target; a claim forks an
`agent/<issue>-<slug>` branch; it becomes a pull request, outlined by its
review state; and a merge is the only flow into the integration branch,
landing in the target it changed. Agents sit on the branch or pull request
their latest session holds.

**Replay.** "Replay last 24 h" plays the last 24 actively worked hours back
from the state they started in (idle gaps squeezed to a beat); the timeline
switches to the whole run, plays at 1×, 2× or 4×, pauses, and scrubs (drag,
or arrow keys; Shift+arrow jumps between milestones; Home and End). The
clock shows the time of the last event played. With
`prefers-reduced-motion` the graph draws without ambient motion and the
playhead steps per event.

**What feeds it.** `getFleetGraph()` in `_lib/queries.ts` reads the history
(the latest 500 sessions, 1000 progress notes, 500 referee results, 500
versions, 300 buried ideas, 200 protocol changes, and the 300 most recently
updated GitHub issues and pull requests) and hands it to `toSwarmInput()` in
`_lib/fleet-graph.ts`, which maps:

| Graph | From |
| ----- | ---- |
| sectors | `swarmConfig.targets` (names and colours) plus target ids found in the data; work with no target goes to the only target, or to "Other" |
| integration branch | `swarmConfig.integrationBranch`, else the GitHub repository's default branch, else `main` |
| agents | one per agent name in `swarm_sessions`, from its latest session: role, target, issue, PR, latest progress note. Working only while that session is `working` and was seen in the last two hours |
| work items | GitHub issues staged by `status:claimed` / `status:blocked` / `status:deferred` / `needs:human`, and pull requests (joined by "Closes #N") by `review:approved` / `status:changes-requested` / merged. Without GitHub, the issues working sessions hold and those a shipped version names |
| events | sessions starting and ending, progress notes, referee results (pass/fail), shipped versions, buried ideas, protocol changes, issues opened and claimed, pull requests opened, reviewed and merged |
| the number in a sector | merged pull requests (all time, with today's), or shipped versions without GitHub |

Every read may fail: without GitHub the graph shows memory alone and says
so under it; with no rows it still draws the integration branch and the
targets. It re-reads the page every 60 seconds while the tab is visible and
no replay plays (`refreshSeconds` on `<FleetGraph>`; 0 turns it off).

Change what a sector is (a directory, a label) in `toSwarmInput`. Colours
come from the `--rp-*` variables (the `THEME` map at the top of
`fleet-graph.tsx`). The graph needs `d3` (and `@types/d3` for TypeScript);
`add swarm-ui` names the install command when they are missing, and the
standalone dashboard lists them in its `package.json`.

## Letting the swarm build it

With `ui.includeUiTarget` in `.rallypoint/swarm.json`, `swarm init` adds a
`ui` target, and the planner opens UI issues like any other work. A UI change
goes through the same gate as everything else: the measure (in `checks` mode,
for example `npm run build` plus an accessibility script), an independent
review, then a merger. The improver never edits the referee.

## Starter UI issues

Seeds for `npx rallypoint swarm plan`, each scoped to one pull request:

1. Show each target's open issues and the issue being worked on in its card
2. Link a fleet graph node to its session, issue or pull request in a side panel
3. Show each referee run's checks as a timeline on /swarm/results/[id]
4. Link buried ideas to the concepts matrix and show their numbers inline
5. Add an RSS feed for /swarm/news
6. Add a "News" band to the overview with the three latest stories
7. Add per-target filters and a search box to the Board timeline

Each must keep the rules above: read through `queries.ts`, no writes, text
equivalents for anything drawn, and no horizontal overflow at 375px.
