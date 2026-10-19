---
name: Rallypoint
description: A published signal code for agents — every state one label, every role one signal.
colors:
  signal-red: "oklch(0.565 0.2 27.5)"
  signal-yellow: "oklch(0.85 0.165 89)"
  signal-blue: "oklch(0.45 0.175 263)"
  signal-black: "oklch(0.2 0.025 262)"
  signal-white: "oklch(0.995 0 0)"
  paper: "oklch(0.982 0.004 255)"
  paper-sunk: "oklch(0.955 0.007 255)"
  ink: "oklch(0.2 0.025 262)"
  ink-soft: "oklch(0.43 0.025 262)"
  rule: "oklch(0.86 0.012 262)"
  night-paper: "oklch(0.17 0.028 262)"
  night-paper-sunk: "oklch(0.205 0.03 262)"
  night-ink: "oklch(0.955 0.006 255)"
  night-ink-soft: "oklch(0.78 0.02 260)"
  night-rule: "oklch(0.34 0.03 262)"
  night-link: "oklch(0.78 0.12 258)"
  code-bg: "oklch(0.2 0.025 262)"
  code-fg: "oklch(0.96 0.006 255)"
  code-soft: "oklch(0.76 0.02 260)"
  code-rule: "oklch(1 0 0 / 0.16)"
  scrim: "oklch(0.12 0.02 262 / 0.5)"
  signal-red-text: "oklch(0.5 0.2 27.5)"
  night-signal-red-text: "oklch(0.7 0.17 27.5)"
  gh-open: "#1a7f37"
  gh-done: "#8250df"
  gh-state-fg: "#fff"
  night-gh-open: "#3fb950"
  night-gh-done: "#a371f7"
  night-gh-state-fg: "#0d1117"
  theme-light: "#f7f8fa"
  theme-dark: "#10141f"
typography:
  display:
    fontFamily: "Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(2.75rem, 1.1rem + 5.4vw, 6rem)"
    fontWeight: 700
    lineHeight: 0.92
    letterSpacing: "-0.035em"
    fontVariation: "'wdth' 78"
  headline:
    fontFamily: "Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(2.25rem, 1.5rem + 3vw, 3.75rem)"
    fontWeight: 700
    lineHeight: 1.02
    letterSpacing: "-0.025em"
    fontVariation: "'wdth' 82"
  title-l:
    fontFamily: "Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(1.875rem, 1.4rem + 1.6vw, 2.5rem)"
    fontWeight: 700
    lineHeight: 1.02
  title:
    fontFamily: "Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.625rem"
    fontWeight: 700
    lineHeight: 1.1
  lead:
    fontFamily: "Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 400
    lineHeight: 1.5
  body:
    fontFamily: "Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.0625rem"
    fontWeight: 400
    lineHeight: 1.6
  small:
    fontFamily: "Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 600
    lineHeight: 1.4
  micro:
    fontFamily: "Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.6875rem"
    fontWeight: 500
    lineHeight: 1.3
  chip:
    fontFamily: "Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 600
    lineHeight: 1
  code:
    fontFamily: "Martian Mono, ui-monospace, monospace"
    fontSize: "0.9375rem"
    fontWeight: 400
    lineHeight: 1.5
    fontVariation: "'wdth' 75"
  diagram-label:
    fontFamily: "Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "22px"
    fontWeight: 700
  diagram-mono:
    fontFamily: "Martian Mono, ui-monospace, monospace"
    fontSize: "19px"
  diagram-note:
    fontFamily: "Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "17px"
  diagram-small:
    fontFamily: "Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 600
rounded:
  hairline: "2px"
  panel: "6px"
  pill: "2em"
spacing:
  s1: "4px"
  s2: "8px"
  s3: "12px"
  s4: "16px"
  s5: "24px"
  s6: "32px"
  s7: "48px"
  s8: "64px"
  s9: "96px"
  s10: "128px"
components:
  button-primary:
    backgroundColor: "{colors.signal-blue}"
    textColor: "{colors.signal-white}"
    rounded: "{rounded.hairline}"
    height: "44px"
    padding: "0 24px"
  button-secondary:
    textColor: "{colors.ink}"
    rounded: "{rounded.hairline}"
    height: "40px"
  command:
    backgroundColor: "{colors.code-bg}"
    textColor: "{colors.code-fg}"
    rounded: "{rounded.hairline}"
    padding: "12px 16px"
  label-chip:
    rounded: "{rounded.pill}"
    typography: "{typography.chip}"
    padding: "0.35em 0.7em"
  band-yellow:
    backgroundColor: "{colors.signal-yellow}"
    textColor: "{colors.signal-black}"
  band-blue:
    backgroundColor: "{colors.signal-blue}"
    textColor: "{colors.signal-white}"
  panel:
    backgroundColor: "{colors.paper-sunk}"
    rounded: "{rounded.panel}"
---

# Design System: Rallypoint

## Overview

**Creative North Star: "The Signal Code"**

Rallypoint reads like a published code of signals for coding agents. Agents never
talk to each other; they read and write public signals on GitHub. The site makes
that literal: every role carries one square signal flag drawn in the geometry of
the International Code of Signals, every state is a GitHub label rendered exactly
as GitHub renders it, and every mechanism (the claim race, the label lines, the
run of one issue) is drawn as a schematic from protocol facts — never illustrated.

The page is a code book, not a pitch deck: a cool white ground (signal-night navy
in dark), ink hairline rules, compressed grotesque headlines, and tables where
other sites put cards. Colour arrives at page scale in two drenched bands — the
claim on signal yellow, the proof on signal blue — and otherwise stays inside the
flags and chips where it carries meaning.

**Key Characteristics:**

- Zero raster illustration. Diagrams are inline SVG or real HTML UI built from protocol facts.
- Five signal inks, used whole: red, yellow, blue, black, white.
- Compressed Archivo for display, Martian Mono only for code, refs, paths and commands.
- Tables, rules and schematics instead of card grids.
- Demonstration data is labelled ("Illustrative run · real commands"); claims are never invented.

## Colors

A full signal palette held in check by a cool, nearly colourless code-book ground.

### Primary
- **Signal Blue** (signal-blue): the action colour — primary buttons, selected tabs, links on paper, the pull-request line, and the drenched proof band.

### Secondary
- **Signal Yellow** (signal-yellow): the claim colour — the claim band, the role-contract handoff band, the active station on the rail, the issue line, and text selection. It matches GitHub's own `status:claimed` yellow on purpose.

### Tertiary
- **Signal Red** (signal-red): refusal and boundary — the refused-ref stop bar, the "Never" marks, and red fields inside flags. Text in red uses Signal Red Text (signal-red-text / night-signal-red-text) for AA contrast.

### Neutral
- **Code-book Paper** (paper / night-paper): the page ground in light and dark.
- **Sunk Paper** (paper-sunk / night-paper-sunk): recessed panels — the GitHub card on the rail and the install manifest.
- **Ink / Soft Ink** (ink, ink-soft and night variants): text and secondary text; soft ink stays above 7:1 on paper.
- **Rule** (rule / night-rule): hairlines, table dividers, unreached rail track.
- **Signal Black / White**: flag fields, the footer ground, and the fixed inks inside the drenched bands.
- **GitHub state colours** (gh-open, gh-done and night variants): only on rendered GitHub state badges.

### Named Rules
**The Whole-Ink Rule.** Signal colours are used at full strength in flags, chips, bands and diagram lines — never tinted into washes, gradients or glows.

**The Never-Alone Rule.** A flag or chip is always printed beside its role or label name. Colour never carries meaning by itself.

**The Two-Band Rule.** A page drenches at most two regions in signal colour; everything else is paper.

## Typography

**Display Font:** Archivo (variable width, set at 78–82% width)
**Body Font:** Archivo at 100% width
**Label/Mono Font:** Martian Mono at 75–87.5% width

**Character:** One engineered grotesque, compressed for headlines and open for reading, with a narrow technical mono that appears only where the content is literally code.

### Hierarchy
- **Display** (700, clamp 2.75–6rem, 0.92): the homepage H1 and role-contract names only.
- **Headline** (700, clamp 2.25–3.75rem, 1.02): section headings and the handoff statement.
- **Title** (700, 1.625–2.5rem): docs section headings, line names, contract columns.
- **Lead** (400, 1.25rem, 1.5): ledes and section explanations, max 44ch.
- **Body** (400, 1.0625rem, 1.6): reading text, max 68ch.
- **Label** (600, 0.8125rem): table headers, captions, footer headings. Sentence case, never tracked caps.
- **Code** (Martian Mono, 0.9375rem): commands, refs, label names in prose.
- **Diagram** (22 / 19 / 17 / 15px in SVG user units): labels inside schematics, which scale with the drawing.

### Named Rules
**The Mono-Means-Code Rule.** Martian Mono appears only for things a person could paste: commands, paths, refs, config keys, agent ids.

**The No-Kicker Rule.** No eyebrow labels above headings. A heading carries its own weight.

## Layout

A 1440px frame with a fluid gutter (16–48px). Sections are full-width bands with
128px vertical padding (96px under 900px), separated by a hairline or by a change
of ground. Section heads use a 7/5 split: heading left, explanation bottom-aligned
right; content then runs the full frame width. The hero is a 7/5 split above a
full-width rail; under 1024px everything stacks. Tables reflow into labelled
blocks under 768px. The docs use a 220px sticky contents column beside a 920px
reading column. Breakpoints in use: 599, 767, 899, 1023px.

## Elevation & Depth

Flat. There are no shadows. Depth is conveyed by ground changes (paper, sunk
paper, code wells, drenched bands) and by rule weight: 1px hairlines for
division, 2px ink rules to open a major block. The sticky header is the one
translucent surface (paper at 90% with a light blur) so content reads beneath it.

### Named Rules
**The Flat-Ground Rule.** No box-shadows, no glows. If something needs to stand forward, change its ground or its rule.

## Shapes

Square by default. Flags are exact squares; controls and command wells take a
2px hairline radius; recessed panels take 6px; only GitHub chips, state badges and
small tags are pills, because that is how GitHub draws them. Diagram lines are
12px with round joins and 45° bends, like a transit schematic. Station nodes are
circles with heavy ink rings; terminal stations are filled.

## Components

### Buttons
- **Shape:** squared (2px).
- **Primary:** Signal Blue with white text, 44px tall, 24px side padding; hover darkens the blue.
- **Secondary:** transparent with a 1.5px current-colour border; used for rail controls (40px square icon buttons).
- **Quiet:** transparent icon buttons in the header; hover lays a 10% current-colour wash.
- **Focus:** 3px solid focus ring with 2px offset; the ring turns ink on yellow and white on blue.

### Chips
- **Style:** GitHub labels rendered as GitHub renders them — the label's own hex as fill, black or white text chosen by luminance, pill radius, 0.75rem semibold.
- **Colours:** the ones `rallypoint init` creates; labels init does not create use GitHub's neutral `#ededed`.

### Command well
- Dark code ground, yellow `$` prompt, Martian Mono at 75% width, and a full-height Copy button divided by a hairline. Copy confirms with a check, the word "Copied" and a polite live-region announcement. On phones the button collapses to its icon.

### Navigation
- Sticky 64px header: mark and wordmark left, five text links right with a 2px underline for hover and current page, theme toggle. Under 900px the links move into a right-hand sheet with focus trap and Escape to close.

### Signal flags (signature)
- Nine square flags (eight roles plus the Rallypoint mark), 24-unit grid, five inks, a 1px ink edge so white fields hold on white. Sizes: 16px in lists, 22–28px in tables, 40px on the rail, up to 200px on contract pages.

### Signal rail (signature)
- The homepage run of issue #142 through seven stations. Each station is a mast with the holding role's flag; reaching a station hoists its flag (760ms ease-out) and inks the mast and track. Below, a GitHub-style card shows issue and PR state with live chips, and the event panel shows the actor, the exact command, and one sentence of protocol. Autoplays only without reduced motion, pauses off-screen, stops for good on any manual step; Prev / Play-Pause / Next are always present.

### Transit schematics
- The claim race and the label lines are drawn as transit maps: one line per session or object, stations as states, a red stop bar where GitHub refuses. Wide SVG above 768px, a purpose-drawn tall SVG on phones.

## Do's and Don'ts

### Do:
- **Do** draw mechanisms from protocol facts: label names, ref paths, commands and exit behaviour exactly as the installed files define them.
- **Do** label synthetic demonstration data on the surface where it appears.
- **Do** pair every flag and chip with its name.
- **Do** keep colour whole — full-strength signal inks in flags, chips, lines and bands.
- **Do** use tables and ruled lists for structured comparisons.

### Don't:
- **Don't** use AI-generated or painted illustration, parchment, maps, or fantasy trade dress.
- **Don't** add shadows, glows, gradients or glass.
- **Don't** set eyebrow kickers above headings or tracked-caps labels.
- **Don't** use Martian Mono for anything that is not literally code.
- **Don't** build sections out of rows of identical icon cards.
