# Concepts

A **concept** is an idea general enough to try on more than one target:
"reuse work between steps", "spend the time budget instead of stopping
early", "test the risky path first". Concepts are how the swarm learns
across attempts. When an idea gains on one target, the strategist ports it
to the others, and the concepts page shows what carried over.

## Using concepts

- Give every experiment issue a concept id (`concept` in `plan.json`).
- After a merge, the merger records the trial:
  `swarm concept trial <id> --target <t> --outcome gained --delta <d> --ref #<n>`.
- A burial with `--concept <id>` records a `lost` trial automatically.
- Use `neutral` when the change shipped for other reasons but moved
  nothing.

## The concepts

Genesis seeds this list, and the steward refines the descriptions. Add new
ones with `swarm concept add`. Each entry is the id, the name, then one or
two lines on what it is and where it should help.

<!-- genesis: replace this comment with 3–6 concepts for this project -->
