---
version: 1
slug: "app-swarm-wizard-page-tsx"
primary_target: "app/swarm/wizard/page.tsx"
related_targets: ["components/swarm-wizard.tsx","lib/swarm.ts","lib/swarm-goals.ts","app/globals.css"]
---

Scope: the Swarm goal wizard (`app/swarm/wizard/page.tsx` and its client component `components/swarm-wizard.tsx`).
Mode: Tool.

Audience: A developer who has decided to try Swarm on their own repository and Supabase project.
Job: Write a pitch of one or two sentences and leave with a working starting point: the genesis prompt, a `.rallypoint/swarm.json` matching the contract shape, the exact command sequence, and the conductor prompt, all copyable.
Primary action: the pitch textarea, first thing on the page, with Swarm Arena's pitch above it as a worked example ("This pitch became Swarm Arena", "Use this example" fills every step).
Proof: the worked example links to the live arena; the 100-goal gallery is labelled inspiration only, not verified recipes.

Structure: 1 pitch (required) → divider "Everything below is optional" → 2 goal → 3 measure (mode first: score / checks / review; score fields only for score, a checks editor for checks; mode is suggested from the pitch until the user picks) → 4 targets (name, colour from an eight-colour palette always shown with its name, description; ids derived) → 5 UI shape, visibility, "Also let the swarm build the UI", project name, tagline, vocabulary → 6 conductor (concurrency, budget, focus) → Your setup. Each optional step says "or let the genesis session decide"; empty fields are emitted empty for genesis to fill.

Chosen direction: The Signal Code as a form. Numbered steps open with a 2px ink rule and the ink step index from the install panel; radios are ruled options with a signal-blue bar on the selected one; segmented controls reuse the audience-switch look; outputs reuse the command well (`CommandCopy`), multi-line where needed.

Constraints: pure client-side, nothing sent anywhere (stated beside the output); every control labelled; native radios, selects and checkboxes for keyboard access; visible focus; works at 375px with no horizontal scroll; light and dark; `?example=arena` pre-fills the worked example.

Unresolved decisions: none.
