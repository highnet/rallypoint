---
target: swarm page, homepage tiers and swarm band, swarm wizard
total_score: 27
max_score: 32
na_heuristics: 7,9
p0_count: 0
p1_count: 0
target_identity: "file:/home/user/rallypoint/app/swarm/page.tsx"
target_fingerprint: "sha256:07286e9e1d745eed4d661863d6464346ede9737e00ca0e345b387fb4564cf35d"
target_path: /home/user/rallypoint/app/swarm/page.tsx
timestamp: 2026-11-25T16-53-06Z
slug: app-swarm-page-tsx
---
⚠️ DEGRADED: single-context (no sub-agent tool exposed to this agent)

Reviewed from screenshots at 1440 and 390 wide, light and dark, plus a scripted wizard run (gallery goal → checks default → score mode → target → output parsed as JSON; `?example=arena`). No horizontal overflow at 390 on `/`, `/swarm`, `/swarm/wizard`.

## Design Health Score (Swarm surfaces)
| # | Heuristic | Score | Key Issue |
|---|---|---|---|
| 1 | Visibility of System Status | 3 | Wizard output updates live; copy confirms; mode shows "suggested" until chosen |
| 2 | Match System / Real World | 4 | GitHub nouns and contract commands only; memory stops named after the real tables |
| 3 | User Control and Freedom | 4 | Every wizard step optional; example and gallery only prefill; rows removable |
| 4 | Consistency and Standards | 4 | Same tokens, flags, chips, command wells, bands; no new brand |
| 5 | Error Prevention | 3 | Score contract stated next to the command field; secret warned twice; no validation of the command itself |
| 6 | Recognition Rather Than Recall | 4 | Roles printed with flags; finish-first order numbered; target colours always named |
| 7 | Flexibility | n/a | Persuade/tool pages without power-user modes |
| 8 | Aesthetic and Minimalist Design | 2 | /swarm is long (nine sections); vanilla command shown twice in the desktop first viewport |
| 9 | Error Recovery | n/a | No error states beyond doctor, which lives in the CLI |
| 10 | Help and Documentation | 3 | Requirements and setup complete; docs carry the CLI table; no troubleshooting |
| **Total** | | **27/32 (84%)** | **Good** |

## Design Specificity Verdict
LLM: Authored for this product. The mechanism schematic (work line on GitHub, memory line in your Supabase, a red branch where the referee buries a loss, the learning loop, the frozen stop bar) is drawn from the contract, not illustrated. No hero metrics, no icon-card rows, no gradients. Swarm Arena is linked live with no copied ratings.
Detector: not run (no detector in this environment); manual pass found no shadows, glows or new colours outside the eight target swatches, which carry names.

## Priority Issues (found → status)
- [P1] Mechanism SVG: dashed links ran through the mono labels under Claim, Pull request, Referee and Merge; "loses: swarm bury" overprinted "ship · trial"; the learning loop's diagonal crossed "swarm plan". → Fixed: links start below the labels, the loss branch drops from the results link, labels moved, loop enters the first station horizontally (wide and tall).
- [P1] Wizard legends sat inside the fieldset's top rule (legend-in-border rendering). → Fixed: legends float full-width above the rule's content.
- [P2] On phones the tier choice fell below the first viewport. → Fixed: a "next tier: Rallypoint Swarm" link in the hero bar jumps to the chooser (hidden in the agent view).
- [P2] At 390 the examples table caption was squeezed into a narrow column and the colour select truncated its hex. → Fixed: caption moved to a visible paragraph above the table; options show the colour name (the swatch sits beside it).
- [P2] Learning table: the "Written with" commands wrapped mid-flag. → Fixed: column widened to 30%.
- [P2] Genesis prompt read "Pitch: <your pitch> Use…" with no full stop. → Fixed: a full stop is added when the pitch lacks one.
- [P2] Copy claimed a referee command is required. → Fixed everywhere: score, checks, or review alone; "a goal, and optionally a way to measure it".
- [P2] Open: the desktop first viewport shows `npx rallypoint@latest add loop` twice (hero and tier column). Kept so the two tiers read as a parallel choice. (/impeccable distill)
- [P3] Open: /swarm runs nine sections; the in-page contents strip mitigates but a reader must scroll far for setup. (/impeccable distill)
- [P3] Open: score examples (`npm run test:count --silent` and similar) are placeholders; they are labelled "Examples by kind. You define the real command."

Questions skipped: no P0–P1 issues remain open and no question tool in this run.
