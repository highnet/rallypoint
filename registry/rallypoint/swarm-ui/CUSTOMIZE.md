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
| `app/swarm/_components/*` | the overview bands (hero, target cards, steps), nav icons and target marks, flags, chips, panels, the step chart, the delivery bar | freely |
| `app/swarm/**/page.tsx` | thin pages: `getSwarmContext()`, one query, render | freely |
| `app/swarm/loading.tsx`, `app/swarm/**/loading.tsx` | the fallback each page streams into; the folders' copies re-export the root one | the root one freely |
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
7. **Read request data inside the page, never in the layout.** Every page
   is request-time because `getSwarmContext()` calls `connection()` first,
   and it renders inside the Suspense boundary of the `loading.tsx` in its
   own folder. Do not add `export const dynamic`, `revalidate` or
   `fetchCache`: Next.js 16 rejects them under Cache Components. Anything in
   `layout.tsx` that reads cookies or memory goes in its own `<Suspense>`, as
   the top bar's status does. That keeps the scaffold building with
   `cacheComponents` on and off. A new route folder (and an `[id]` folder)
   gets the same one-line `loading.tsx`, re-exporting `app/swarm/loading.tsx`;
   `npm run swarm:test` checks that every page has one.
8. **Never assume a page unmounts.** With Cache Components, Next.js keeps up
   to three pages you left mounted but hidden (`display: none`). So element
   ids must be unique per page (as the skills viewer's file anchors are),
   CSS must not depend on what else sits in `<main>` (no `:has()` on page
   content from outside it), timers and subscriptions pause in an effect
   cleanup, and stale status messages clear in a `useLayoutEffect` cleanup.
   Signing out reloads the whole page so no private page stays hidden in
   the document.

## Letting the swarm build it

With `ui.includeUiTarget` in `.rallypoint/swarm.json`, `swarm init` adds a
`ui` target, and the planner opens UI issues like any other work. A UI change
goes through the same gate as everything else: the measure (in `checks` mode,
for example `npm run build` plus an accessibility script), an independent
review, then a merger. The improver never edits the referee.

## Starter UI issues

Seeds for `npx rallypoint swarm plan`, each scoped to one pull request:

1. Draw a live fleet graph of targets, agents and open PRs on /swarm/fleet
2. Show each target's open issues and the issue being worked on in its card
3. Add a 24-hour replay of fleet activity with play, pause and step controls
4. Show each referee run's checks as a timeline on /swarm/results/[id]
5. Link buried ideas to the concepts matrix and show their numbers inline
6. Add an RSS feed for /swarm/news
7. Add a "News" band to the overview with the three latest stories
8. Add per-target filters and a search box to the Board timeline

Each must keep the rules above: read through `queries.ts`, no writes, text
equivalents for anything drawn, and no horizontal overflow at 375px.
