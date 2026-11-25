---
target: swarm dashboard scaffold (registry/rallypoint/swarm-ui): overview, targets, target detail, results, sessions, fleet, news
total_score: 31
max_score: 36
na_heuristics: 7
p0_count: 0
p1_count: 0
target_path: registry/rallypoint/swarm-ui/app/swarm/page.tsx
timestamp: 2026-11-25T22-30-00Z
slug: registry-swarm-ui-page-tsx
---
⚠️ DEGRADED: single-context. Assessment B unavailable: the `impeccable detect` launcher (a downloaded binary) was not permitted to run in this session, so there is no deterministic scan. Manual pass against craft-floor.md instead.

Reviewed from screenshots at 1440×900 and 390×844, light and dark, of a freshly installed `swarm-dashboard` against two mock memories: empty (generated config, review mode, no targets, no GitHub) and sample (score mode, three targets, two working sessions). No horizontal overflow and no console errors on any captured route. `next build` passes.

## Design Health Score
| # | Heuristic | Score | Key Issue |
|---|---|---|---|
| 1 | Visibility of System Status | 4 | Live/idle pill in the header, "Latest" strip, Right now band |
| 2 | Match System / Real World | 4 | Vocabulary and target names from swarm.config.ts; CLI commands named exactly |
| 3 | User Control and Freedom | 3 | Read-only; filters are links; no theme toggle (follows the host) |
| 4 | Consistency and Standards | 4 | One band system, one card, one mark per target across sidebar, cards and target head |
| 5 | Error Prevention | 3 | n/a-ish for a read-only surface; missing env/schema/GitHub each get a specific panel |
| 6 | Recognition Rather Than Recall | 4 | Icons beside every nav label; target marks always beside names |
| 7 | Flexibility | n/a | Read surface |
| 8 | Aesthetic and Minimalist Design | 3 | Overview is long (six bands), mirrors the reference's information design |
| 9 | Error Recovery | 3 | Every empty state names the next command and when the data appears |
| 10 | Help and Documentation | 3 | How it works band links the full story; README documents tokens and fonts |
| **Total** | | **31/36 (86%)** | **Good** |

## Priority Issues (found → status)
- [P1] Eyebrow line above the hero heading and above the target heading (craft-floor ban). → Fixed: the measure line sits under the lede; the target label line under the description.
- [P1] Hero backdrop grid crossed the lede in light mode. → Fixed: mask starts at 40% of the width.
- [P1] Display tracking at −0.04em on Inter Tight made glyphs touch at hero size. → Fixed: −0.022em hero, −0.02em bands.
- [P1] System font fallback as the display voice. → Fixed: Inter, Inter Tight and JetBrains Mono self-hosted with next/font; host overrides still win.
- [P2] Target colours (configured for light paper) lost contrast in dark charts and marks. → Fixed: series and marks are mixed toward the ink.
- [P2] Empty states said "None yet" without a next step. → Fixed: sessions (doctor + prepare), delivery and news (`swarm plan plan.json`), versions (`swarm ship`), buried, protocol, board.
- [P2] "1 ideas buried". → Fixed: singular/plural.
- [P2] Panel used a one-sided border stripe (ban). → Fixed: full border, tinted warn panel.
- [P3] Open: How it works numbers its steps 01–04; kept because the order is the protocol's order.
- [P3] Open: the big-number target card is the hero-metric pattern; kept on purpose, it is the brief (the Arena information design).
