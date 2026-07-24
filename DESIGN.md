# Rallypoint Design Contract

This file is the acceptance boundary for the live render. The direction is a
premium tabletop campaign map—not fantasy wallpaper and not a generic SaaS
landing page. Every checkpoint is evaluated in both themes and at the viewport
sizes below.

## Impeccable direction

### Bolder

- The campaign table is the primary visual artifact; the headline is the
  primary verbal artifact. Nothing else competes at their scale.
- Desktop hero composition targets 42% message / 58% table. The table must show
  all five role tokens and the complete route without clipping.
- The display face is Palatino-style serif, capped at 96px on the homepage.
  Tracking never exceeds `-0.04em`; body copy remains Geist Sans.
- Orange is reserved for decisions, active progress, and successful handoffs.
  Role colors identify agents but do not become section backgrounds.
- Sections change rhythm: split manifesto, horizontal protocol ribbon, ruled
  role ledger, inset CLI well with parchment manifest, then a single proof band.
  Do not convert these into repeated rounded-card grids.
- 3D is a real game board: modeled route, six distinct molded tokens, d20,
  physical light, and pointer parallax. No generic gradient, glass, neon, or
  particle-field substitute.

### Delight

- Clicking the d20 produces a result in under 900ms and announces it through an
  `aria-live` region. A natural 20 receives a distinct critical state.
- Copy feedback appears within 200ms, reads “Quest copied,” and clears after
  roughly 1.6 seconds.
- Selecting a map stage lifts its token 8px and advances the orange route within
  520ms. The legend changes without moving the page.
- The human/agent fork changes the content in place, preserves a visible
  selected state, and never sends the user through an interstitial route.
- Reduced-motion users receive immediate state changes with no route drawing,
  die travel, parallax, or token travel.

## Live render targets

### Desktop — 1440 × 900

- Header is no taller than 96px.
- Audience fork is fully visible below the header.
- Human hero headline is 64–96px, no more than three lines, with its first CTA
  and install command visible in the first viewport.
- Campaign map occupies at least 52% of the hero grid and renders at least
  560px tall.
- No horizontal overflow. All five tokens, stage labels, and the route are
  visible.
- Agent fork displays its heading, both commands, and at least three role links
  before the first scroll.

### Mobile — 390 × 844

- No horizontal overflow at any route.
- Header controls and audience tabs have touch targets of at least 44px.
- Primary navigation remains reachable through the menu sheet.
- Hero copy precedes the table. Headline is 50–75px and does not clip.
- CTAs are full-width; command wells remain copyable without making the page
  wider than the viewport.
- Campaign map stays horizontally complete and at least 350px tall.
- Role ledger rows stack without hiding names, descriptions, or links.
- Agent contract pages use one column and expose the “Next role” action.

### Theme and contrast

- Dark hero text is warm parchment, never dark-on-felt.
- Light theme remains a daylight game table rather than a simple inversion.
- Body copy and commands target WCAG AA 4.5:1; large headings target 3:1.
- Focus rings are visible on tabs, route tokens, the d20, menu controls, links,
  copy controls, and CTAs.

### Three.js and performance

- Canvas is decorative (`aria-hidden`) and never captures pointer input.
- Pixel ratio is capped at 1.5.
- Geometry and materials are disposed on unmount.
- Resize uses `ResizeObserver`; the canvas introduces no layout shift.
- The page remains usable if WebGL is unavailable or JavaScript is delayed:
  semantic text, commands, links, and the CSS campaign map remain present.

### CLI truthfulness

- Every command displayed on the site must be covered by the packaged CLI smoke
  test or a direct shell check.
- `view loop` writes nothing.
- `add loop --dry-run` writes nothing.
- `add loop` installs 13 checksummed files.
- A repeat install is idempotent.
- A conflicting file other than `AGENTS.md` stops the entire write unless the
  user explicitly supplies `--force`.
- A conflicting `AGENTS.md` is the one exception: it is left untouched and the
  rest of the install proceeds, with a suggestion to add an `@AGENTIC_LOOP.md`
  reference line to it.

## Checkpoint matrix

| Surface | Viewport | Theme | Required evidence |
| --- | ---: | --- | --- |
| Human home | 1440×900 | dark + light | Screenshot, no overflow, hero hierarchy |
| Agent home | 1440×900 | dark + light | Selected tab, terse quickstart, commands |
| Human home | 390×844 | dark + light | Menu access, complete map, full-width CTAs |
| Planner page | 1440×900 | dark | 3D token, boundaries, handoff |
| Reviewer page | 390×844 | light | One-column contract, next-role action |
| Docs | 390×844 | dark | Menu access, readable table scroll, commands |

Do not mark the design complete from source inspection alone. Check these
targets against the running application.
