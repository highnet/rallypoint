---
target: swarm dashboard scaffold (registry swarm-ui / swarm-dashboard): overview, targets, news, results, fleet, sessions, not-connected gate
total_score: 28
max_score: 32
na_heuristics: 7,9
p0_count: 0
p1_count: 0
target_path: registry/rallypoint/swarm-ui/app/swarm/page.tsx
timestamp: 2026-11-25T20-30-00Z
slug: registry-swarm-ui-app-swarm-page-tsx
---
⚠️ DEGRADED: the impeccable skill was not installed in this cloud session; the critique follows its heuristics and report format by hand, single-context.

Reviewed from screenshots of a fresh `add loop` + `add swarm` + `add swarm-dashboard` install (production build), at 1440 wide and iPhone 13, light and dark, against three memories: a mock PostgREST with sample data (score mode, three targets), the same with empty tables (review mode, no targets, no GitHub), and no Supabase env at all. No horizontal overflow at 390 on any of them.

## Design Health Score
| # | Heuristic | Score | Key Issue |
|---|---|---|---|
| 1 | Visibility of System Status | 4 | Live "N working / Idle" pill in the top bar, "Just in" strip, standings with deltas |
| 2 | Match System / Real World | 4 | Every noun from swarm.config.ts vocabulary; commands are the real CLI |
| 3 | User Control and Freedom | 3 | In-page tabs and "more" links everywhere; no way to dismiss the "Just in" strip |
| 4 | Consistency and Standards | 4 | One card, one story list, one empty-state shape across pages |
| 5 | Error Prevention | 3 | Read-only UI; GitHub-less and env-less states explain themselves |
| 6 | Recognition Rather Than Recall | 4 | Targets always mark + name; icons always beside labels; numbers labelled |
| 7 | Flexibility | n/a | Read-only record |
| 8 | Aesthetic and Minimalist Design | 3 | Overview is long (hero, five sections); tabs mitigate |
| 9 | Error Recovery | n/a | Only the gate panels, which name the fix |
| 10 | Help and Documentation | 3 | Empty states name the next command; "Further reading" maps the pages |
| **Total** | | **28/32** | **Good** |

## Priority Issues (found → status)
- [P1] Phones: the top bar collapsed to 33px while the sticky section menu assumed 56px, so the menu overprinted the "Just in" strip. → Fixed: the bar has a fixed height.
- [P1] Blocks that set their own margins (story list, results table, filters, card grid) lost the gutter and touched the sidebar or overflowed right. → Fixed: the main column is padded; only the overview's bands bleed.
- [P1] Empty states said only "None yet". → Fixed: every empty state names what fills it and the command that does (`swarm doctor` + `swarm prepare` for sessions and fleet, `swarm plan plan.json` for delivery, `swarm ship`, `swarm bury`, `swarm say`, …).
- [P2] "Shipped: Renderer v0.6 shipped" in the latest story. → Fixed: the kind prefix is dropped for versions.
- [P2] Buried story body ran reason and lesson together without a full stop. → Fixed.
- [P2] Hero eyebrow repeated the title when no goal title is set ("Swarm / Swarm"). → Fixed: hidden when equal.
- [P2] The measure command wrapped mid-flag in the hero. → Fixed: nowrap.
- [P3] Open: the "Just in" strip cannot be dismissed.
- [P3] Open: target detail, board, sessions and the other secondary pages inherit the new tokens and type but keep their earlier layouts.
