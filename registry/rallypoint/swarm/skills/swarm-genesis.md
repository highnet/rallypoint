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

## 1. Interview the operator first

A pitch is one or two sentences. A wrong guess here is copied into every
issue the swarm opens afterwards. So before you decide anything, find out
what is actually being built, with the **interview-me** skill
(https://interviewme.at):

```bash
npx interview-me install --yes
```

If you cannot install it, fetch it and follow it as written:
`curl -s https://interviewme.at/skill.md`.

- Start from the pitch and what is already in reach (the repository, its
  docs, `.rallypoint/swarm.json`). Never ask what those already answer.
- Ask **one question per turn**, with the harness's question tool when it
  has one. Cover all six areas: core, the real challenge, picture,
  references, edges, success. "Success" is where the measure comes from:
  ask how the operator will know a change made things better.
- Play it back every three or four questions until the operator says
  **"that's right"**. Then write the brief to `docs/briefs/<slug>.md` and
  get it confirmed.
- Write no configuration, code or plan until the brief is confirmed. If the
  operator says "just go", write the brief with the gaps marked as
  assumptions, and list them in the pull request.
- No human to ask (an unattended run)? Do not invent answers. Write the
  brief from the pitch and the repository, mark every guess as an
  assumption, and say so at the top of the pull request.

The confirmed brief is the source for everything below.

## 2. Initialize Impeccable for design and product

Give the swarm one product and design vocabulary, so the sessions that touch
the product or the UI build against the same context instead of guessing it
again each time. Use **Impeccable** (https://impeccable.style):

```bash
npx impeccable install
```

Then, in the agent (after reloading it so the skill loads):

1. `/impeccable init`: write `PRODUCT.md` (audience, goals, positioning)
   **from the confirmed brief**. Don't run a second interview.
2. `/impeccable document`, when the project already has a UI or a design
   language: record the visual system in `DESIGN.md`. With nothing visual
   yet, leave `DESIGN.md` for the first `ui` task.
3. `/impeccable hooks on`: turn on the design checks, and ask the operator
   to approve the hooks in their tool. You do not approve them yourself.

Claude Code can install it as a plugin instead
(`/plugin marketplace add pbakaus/impeccable`). Other agents can use
`npx skills add pbakaus/impeccable`. Commit `PRODUCT.md`, `DESIGN.md` and the
project-level skill files. Never commit anything that holds a secret.

## 3. Decide and write

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
6. **UI** (when `app/swarm/` or `swarm-ui/` exists): let `PRODUCT.md` and
   `DESIGN.md` set the words and the look, then fill
   `ui.project`, the target colours in `ui.targets` and `ui.vocabulary`. Then
   regenerate the project-owned config with
   `npx rallypoint@latest swarm ui-config --force`. Adjust the generated
   `swarm.config.ts` by hand where the pitch calls for it (nav labels, theme
   variables). Leave the scaffold's pages alone: growing them is the swarm's
   work.
7. **First plan**: every task traces to the confirmed brief. `ui` tasks name
   the Impeccable command that judges them (for example "run
   `/impeccable critique` on the page and fix every P0/P1"). Write `plan.json` with 5–15 small tasks across the
   targets. Include `ui` tasks when `ui.includeUiTarget` is set, taken from
   the scaffold's `CUSTOMIZE.md` ideas and fitted to this pitch. Do not open
   them yet.

## 4. Deliver

- Validate: `swarm doctor` and `swarm plan plan.json --dry-run` must pass.
- Open one pull request, "Swarm genesis: <goal title>", containing:
  the confirmed brief (`docs/briefs/<slug>.md`), `PRODUCT.md` and `DESIGN.md`
  from Impeccable, `.rallypoint/swarm.json`, the referee script (if any), the playbooks,
  `concepts.md`, the UI config, and `plan.json`. Its body includes the
  pitch, your measure decision and why, and the referee's output.
- Do not merge it yourself. After an independent merge, the operator runs
  `swarm init` and `swarm plan plan.json`, then starts agents or the
  conductor.
