# Swarm genesis

You run **once**, at the start. You turn the project's pitch into this
project's own starting point, and deliver it as **one pull request** for
independent review. After it merges, the swarm takes over.

Worked example. This pitch:

> A swarm of AI agents building chess, Go, Othello and Hex engines that keep
> getting stronger. Watch them climb, read the code, or play one yourself.

became Swarm Arena (https://swarm-arena-race.vercel.app/), with:

- four targets, one per engine;
- a `score` measure (Elo from refereed games against a ladder of real
  opponents);
- a playbook per engine;
- vocabulary where targets are "Engines", results are "Games" and shipped is
  "landed";
- a UI that is the product.

A website pitch would instead get `checks` (build, tests, an a11y or
performance budget) or `review`. Not every swarm has a reward function, and
that is fine.

## Inputs

- The pitch: `goal.pitch` in `.rallypoint/swarm.json`, or the one in your
  prompt. Write it into `goal.pitch`.
- Any choices the operator already made in `.rallypoint/swarm.json` (from
  the wizard on rallypoint.tools). **Keep every non-empty value.** Decide
  only what is empty.
- The repository itself: read it before deciding anything.

## Decide and write

1. **Goal**: `goal.title` (short) and `goal.statement` (what "better" or
   "done" means, concretely).
2. **Targets**: the independent fronts the swarm can work on in parallel.
   Each gets `{id, name, description}` with a lowercase id (`api`, `web`,
   `chess`). Use none when the work has no natural split. Set
   `ui.includeUiTarget` when the swarm should grow its own frontend.
3. **Measure**: choose the mode honestly.
   - `score` only when a number truly tracks the goal. Then write the
     referee script it runs (for example `scripts/referee.mjs`). It must be
     deterministic enough to compare two commits, finish within
     `timeoutSeconds`, and print the score on its last stdout line or as
     `{"score": n}`. Set `direction`, `margin` (above the noise you
     measured: run it three times) and `unit`.
   - `checks` when "better" means "still builds, passes and meets budgets".
     List named commands that exit 0 on success.
   - `review` when nothing automated can judge it.

   Run whatever you configured and paste the output into the pull request.
   A referee nobody has seen pass is not a referee.
4. **Playbooks**: one `.rallypoint/swarm/playbooks/<target>.md` per target,
   from `playbooks/README.md`: how this part works, what to try first, what
   to avoid.
5. **Concepts**: seed `.rallypoint/swarm/skills/concepts.md` with three to
   six transferable ideas worth testing across targets.
6. **UI** (when `app/swarm/` or `swarm-ui/` exists): fill
   `ui.project`, the target colours in `ui.targets` and `ui.vocabulary`. Then
   regenerate the project-owned config with
   `npx rallypoint@latest swarm ui-config --force`. Adjust the generated
   `swarm.config.ts` by hand where the pitch calls for it (nav labels, theme
   variables). Leave the scaffold's pages alone: growing them is the swarm's
   work.
7. **First plan**: write `plan.json` with 5–15 small tasks across the
   targets. Include `ui` tasks when `ui.includeUiTarget` is set, taken from
   the scaffold's `CUSTOMIZE.md` ideas and fitted to this pitch. Do not open
   them yet.

## Deliver

- Validate: `swarm doctor` and `swarm plan plan.json --dry-run` must pass.
- Open one pull request, "Swarm genesis: <goal title>", containing:
  `.rallypoint/swarm.json`, the referee script (if any), the playbooks,
  `concepts.md`, the UI config, and `plan.json`. Its body includes the
  pitch, your measure decision and why, and the referee's output.
- Do not merge it yourself. After an independent merge, the operator runs
  `swarm init` and `swarm plan plan.json`, then starts agents or the
  conductor.
