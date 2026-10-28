# Rallypoint

## Register

brand

## Platform

web

## Users

Developers and technical leads coordinating several coding agents through GitHub. They already have a repository, live in GitHub's issue and pull-request views all day, and want disciplined collaboration without adopting another orchestration service.

## Product Purpose

Rallypoint installs a complete, agent-agnostic operating protocol into an existing repository: nine roles (orchestrator, planner, worker, reviewer, tester, fixer, janitor, merger, improver), atomic issue claiming through a reservation ref, labels as a state machine, branch and pull-request rules, independent review bound to a head SHA, maintenance routines, and ready-to-run prompts. MIT-licensed; nothing calls home.

## Positioning

Agents never talk to each other. They read and write the same public signals — issues, branches, labels, pull requests — so the repository itself is the coordinator, and every handoff is auditable after the fact.

Rallypoint is a self-improving graph: roles are the nodes, labels the edges, GitHub the shared state, and the improver role tunes the role prompts one measured change at a time — kept or reverted on equal before/after samples, with scripts, config and the reviewer's, merger's and improver's prompts frozen to it. This is the sixth and top rung of agentic delivery (chat → autocomplete → agents in pilot → loops → graphs → self-improving systems).

## Conversion & proof

- Primary CTA: install the loop (`npx rallypoint@latest add loop`), in working form on the first viewport.
- Secondary CTA: read the docs / inspect the payload first (`view loop`).
- Remembered line: Coordinate coding agents with nothing but GitHub.
- Belief ladder: parallel agents need explicit roles; GitHub can hold all coordination state; a claim must be atomic; no agent may approve its own work; the loop can improve itself only through changes it cannot grade; installation is additive and reversible; the loop has shipped real software.
- Proof on hand: UTON OS, a studio booking platform with payments, was delivered through this loop — 1,328 pull requests opened and 1,256 merged in eight weeks, with payments, credentials and auth held on human-only approval paths. The protocol is distilled from the loop used in `highnet/codewright`. Do not invent other numbers.

## Brand Personality

Exact, legible, unhurried. A published signal code rather than a pitch: every state has one name, one signal, and one owner. Confidence comes from showing the mechanism, not from adjectives.

## Anti-references

AI-generated illustration of any kind, fantasy or tabletop trade dress, painted maps and parchment, terminal cosplay, neon-on-black AI gradients, glass cards, rows of identical icon cards, hero-metric templates, and cream editorial-paper landing pages.

## Design Principles

- Draw the mechanism: states, refs and verdicts are rendered as real diagrams and real GitHub UI, never as metaphor art.
- GitHub nouns first. A metaphor word survives only when it adds meaning the plain noun lacks.
- One signal per role, always paired with its name — colour never carries meaning alone.
- Prove with the product's own artefacts: label names, ref paths, exit codes, commands.
- Every command shown is truthful and copyable.

## Accessibility & Inclusion

Keyboard accessible, WCAG AA contrast, reduced-motion support (no autoplay under reduced motion, pausable otherwise), visible focus states, semantic headings and tables, and no information encoded by colour alone.
