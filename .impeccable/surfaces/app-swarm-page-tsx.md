---
version: 1
slug: "app-swarm-page-tsx"
primary_target: "app/swarm/page.tsx"
related_targets: ["components/swarm-mechanism.tsx","components/swarm-compare.tsx","components/swarm-tiers.tsx","lib/swarm.ts","app/page.tsx","app/globals.css"]
---

Scope: the Rallypoint Swarm product page (`app/swarm/page.tsx`), plus the homepage two-tier chooser (`components/swarm-tiers.tsx`) and the homepage `#swarm` band that reuse its components.
Mode: Persuade, then Read.

Audience: Developers and technical leads who already know (or just met) the vanilla loop and are weighing a harder goal: one with no backlog and no finish line.
Job: See in ten seconds that Swarm is the next tier of the same product (more setup, more capability), understand the mechanism (GitHub owns the work, your Supabase owns the memory, a referee gates every change, the improver cannot touch its judges), check the requirements honestly, and start: `npx rallypoint@latest add swarm` or the wizard.
Primary action: `npx rallypoint@latest add swarm`, copyable in the first viewport; secondary: Describe your swarm (`/swarm/wizard`).
Proof: Swarm Arena (https://swarm-arena-race.vercel.app/), linked live, never with hard-coded Elo; the pitch that produced it, quoted verbatim.

Chosen direction: The Signal Code, extended rather than rebranded. Same tokens, Archivo / Martian Mono, role signal flags beside every role name, GitHub label chips (`needs:human`), tables where other sites put cards. The mechanism is one transit schematic: the work line (issue yellow → pull request blue) on GitHub above, the memory line in a sunk panel below, dashed links labelled with the CLI verb that writes each table, a red branch where the referee buries a loss, a learning loop back to the next issue, and a red stop bar for the frozen judges. Wide SVG above 768px, a purpose-drawn tall SVG on phones.

Bands: two drenched regions only (Two-Band Rule): the referee on signal yellow (a gate, like the claim), Swarm Arena on signal blue (proof). The homepage keeps its own yellow and blue; its `#swarm` band stays on paper.

Constraints: every command and name from `docs/swarm/CONTRACT.md`; measure modes stated honestly (score, checks, or review alone; progress without a score is delivery); the UI is described as a project-owned scaffold plus `app/swarm/swarm.config.ts` that Rallypoint never overwrites; agent messages framed as public board threads, never private side channels; vanilla copy untouched except where Swarm differs; semantic tables that reflow under 768px; no horizontal scroll at 375px; light and dark.

Unresolved decisions: whether the desktop first viewport should keep the vanilla install command twice (hero and tier column) for a parallel choice, or point the vanilla tier at the hero command.
