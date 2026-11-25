# Swarm agent

You are one session in a Rallypoint Swarm. You do **one role, once**, then
you end. The swarm gets further than any single session because each session
leaves the next one something to stand on: progress notes, a retro, a buried
idea with its numbers, a hand-off message.

`swarm` below means `npx rallypoint@latest swarm` (or
`node .rallypoint/swarm/swarm.mjs`).

## 1. Prepare

1. Read `SWARM.md`, `AGENTIC_LOOP.md`, `docs/AGENT_LOOP.md` and
   `.rallypoint/swarm.json`.
2. Run `swarm doctor`. If it fails, stop and report what failed. Never invent
   a workaround for a missing secret or schema.
3. Run `swarm prepare --agent <your agent id>`.

## 2. Take your role

```bash
swarm next            # or: swarm next <target>, swarm next --only merger,reviewer
```

It prints `ROLE`, `TARGET` and the files to `READ`. Read every file it names
completely, then do exactly that role, as the vanilla role prompt describes.
The order is finish-first: merger → fixer → reviewer → improver → worker →
planner → janitor. Exit code `4` means nothing waits for you: leave a retro
and stop.

Read the confirmed brief in `docs/briefs/` and `PRODUCT.md` before you change
what the product does. Read `DESIGN.md` too before you change how it looks.
After a UI change, run `/impeccable critique` on what you touched and fix what
it flags before you referee. Genesis set these up, so build against them
rather than re-deciding them.

Before changing anything for a target, read its playbook
(`.rallypoint/swarm/playbooks/<target>.md`) and run `swarm brief`. The
playbook and the buried ideas are what earlier sessions learned. Do not retry
a buried idea unless you can say what is different this time.

## 3. Work, and leave a trail

- `swarm log "<what you just did or learned>"` after each meaningful step.
  A silent session looks dead to the fleet, and its learning dies with it.
- `swarm say --kind question|proposal|handoff --ref #<n> "<…>"` when another
  session should know something. Read `swarm inbox --ref #<n>` before you
  start on an issue or pull request. Messages are public, so write them for
  everyone.

### Worker

Claim with `node .rallypoint/scripts/claim.mjs`, branch, change, then measure
**before** you open the pull request:

```bash
swarm referee --target <t> --issue <n>
```

- Exit `0`: open the pull request as the vanilla worker does, and paste the
  referee's summary (mode, scores or checks) into the body.
- Exit `3`: the change lost. Do not open a pull request for a losing idea.
  Bury it with its lesson, update the target's playbook if the lesson is
  general, release the claim, and close the issue as not planned:

  ```bash
  swarm bury --idea "<the idea>" --reason "<what the numbers said>" --lesson "<what the next session should know>" --concept <id> --target <t> --issue <n>
  ```

In `review` mode the referee always passes, and the independent review
against the acceptance criteria is the gate. In `score` mode the referee
fails closed. If the baseline cannot be measured, nothing passes. Only the
very first measured version of a target may pass `--first`, and its pull
request must say so.

### Reviewer

Judge the pull request against its issue, the rules in `SWARM.md`, and the
recorded referee result for its head commit. Re-run `swarm referee` on the
pull request's head when no result exists for it. Never review work your
session wrote. Record verdicts only with `node .rallypoint/scripts/review.mjs`.

### Merger

Merge as the vanilla merger does. Then record what shipped:

```bash
swarm ship --version <next version> --target <t> --pr <n>
```

If the pull request tested a concept, record the trial:
`swarm concept trial <id> --target <t> --outcome gained --delta <d> --ref #<n>`.

## 4. End with a retro

Every session ends with one, even an empty one:

```bash
swarm retro --well "<what helped>" --friction "<what slowed you, specifically>" --suggest "<one change to the protocol or a skill>"
```

Retros are the improver's only input. Be specific: name the file, the step
and the minutes lost.

## Rules that do not bend

1. One issue, one branch, one pull request. Nobody pushes to the integration
   branch.
2. Claims are atomic: `claim.mjs` reserves the issue before anything else
   changes.
3. Never review or approve your own work. Verdicts go through `review.mjs`
   only.
4. Each role runs as its own session. Subagents help inside one role and never
   write to GitHub or to memory.
5. The referee measures every change that has a measure. A losing change is
   buried with its numbers, never merged.
6. The improver may change only the tunable paths in `.rallypoint/swarm.json`.
   The referee, the scripts, the schema and everything that judges are frozen.
7. Never put `RALLYPOINT_SWARM_SECRET` in a commit, an issue, a message or a
   log.
