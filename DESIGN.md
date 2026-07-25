---
name: Rallypoint
description: A living expedition atlas for repository-native agent orchestration.
colors:
  table-night: "oklch(0.18 0.045 45)"
  vellum: "oklch(0.91 0.055 82)"
  vellum-bright: "oklch(0.96 0.035 84)"
  charcoal-ink: "oklch(0.22 0.04 58)"
  moss: "oklch(0.43 0.09 145)"
  oxblood: "oklch(0.39 0.12 25)"
  ember: "oklch(0.68 0.18 45)"
  lapis: "oklch(0.45 0.13 260)"
  tarnished-brass: "oklch(0.61 0.08 75)"
typography:
  display:
    fontFamily: "Cinzel, Iowan Old Style, Georgia, serif"
    fontSize: "clamp(3.2rem, 7vw, 6rem)"
    fontWeight: 900
    lineHeight: 0.9
    letterSpacing: "-0.035em"
  editorial:
    fontFamily: "IM FELL English, Iowan Old Style, Georgia, serif"
    fontSize: "clamp(2.5rem, 5vw, 5.4rem)"
    fontWeight: 700
    lineHeight: 0.98
  body:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.65
  label:
    fontFamily: "Geist Mono, ui-monospace, monospace"
    fontSize: "0.75rem"
    fontWeight: 700
    lineHeight: 1.3
    letterSpacing: "0.06em"
rounded:
  field-note: "4px"
  command: "8px"
  control: "10px"
spacing:
  xs: "8px"
  sm: "16px"
  md: "24px"
  lg: "48px"
  xl: "96px"
components:
  button-primary:
    backgroundColor: "{colors.ember}"
    textColor: "{colors.charcoal-ink}"
    rounded: "{rounded.field-note}"
    padding: "16px 28px"
  atlas-label:
    backgroundColor: "{colors.vellum}"
    textColor: "{colors.charcoal-ink}"
    rounded: "{rounded.field-note}"
    padding: "8px 10px"
  command-well:
    backgroundColor: "{colors.table-night}"
    textColor: "{colors.vellum-bright}"
    rounded: "{rounded.command}"
    padding: "8px 10px 8px 18px"
---

# Design System: Rallypoint

## Overview

**Creative North Star: "The Living Hexcrawl Atlas"**

Rallypoint is an original expedition atlas brought to life on a game table. The
repository is a traversable world: agent roles inhabit specific places, the
workflow is a physical route, and every handoff leaves evidence on the map.
The experience is dense, tactile, and narratively legible rather than a fantasy
skin over generic SaaS blocks.

The atlas leads; interface chrome recedes into stitched tabs, pinned field
notes, brass hardware, wax, vellum, and carved table edges. It evokes the craft
and immersion of premium tabletop bestiaries without copying any publisher's
trade dress, logos, layouts, or creatures.

**Key Characteristics:**

- Authored cartography and creature plates instead of abstract geometry.
- Six role locations with distinct architecture, inhabitants, props, and risks.
- Warm candlelight on a dark campaign table; daylight remains an aged map desk.
- Operational truth stays crisp through semantic labels, commands, and links.

## Colors

The palette is a full campaign palette restrained by charcoal ink and vellum.

- **Table Night:** the carved table, deep wells, and night-theme frame.
- **Vellum / Vellum Bright:** reading surfaces, labels, and accessible text.
- **Charcoal Ink:** primary typography and engraved marks.
- **Moss, Oxblood, Lapis:** role identity and localized watercolor washes.
- **Ember:** the active route, decisions, copy success, and primary action.
- **Tarnished Brass:** pins, hairlines, hardware, and structural highlights.

**The Ember Route Rule.** Ember marks progress or action, never generic decoration.

## Typography

**Display Font:** Cinzel, reserved for the Rallypoint title and monumental atlas headings.
**Editorial Font:** IM FELL English for bestiary entries, folio headings, and narrative copy.
**Body Font:** Geist for operational clarity.
**Code Font:** Geist Mono for commands, paths, and measurements only.

Display lettering feels engraved; editorial type has the irregular warmth of
an early printed field guide without sacrificing legibility. Body copy stays
contemporary and highly readable.

## Layout

The homepage opens as an atlas, not a conventional hero. Desktop uses a narrow
torn expedition folio over a dominant map; mobile stacks the folio before a
complete horizontally contained map. The first fold exposes the offer, install
action, command, and a selectable role location.

Subsequent sections change physical format: protocol scroll, bestiary plates,
CLI field kit, ownership charter, and proof seal. Maximum content width is
1540px. Reading measures stay between 65–75 characters.

## Elevation & Depth

Depth is structural: the table sits below the atlas, folios cast warm offset
shadows, pins and route studs rise above paper, and labels use shallow physical
lift. Inner shadows are reserved for carved command wells and recessed hardware.
Decorative glow alone never carries elevation.

## Shapes

The dominant silhouettes are torn paper, notched folios, stitched leather tabs,
wax seals, brass circles, and irregular atlas edges. Rounded rectangles are
limited to compact controls and command wells. Role portraits are tall engraved
plates, not equal-size dashboard cards.

## Components

### Atlas

The map is a real illustrated world asset with semantic HTML controls overlaid
at each location. Selecting a place advances the ember route, lifts its brass
pin, updates the field note, and preserves keyboard/focus behavior.

### Expedition Folio

The hero copy lives on an asymmetrical vellum sheet pinned above the map. Its
primary action resembles a brass-mounted wax command plate while remaining a
normal accessible link.

### Bestiary Plate

Each role has authored creature art, a title, operating truth, boundaries, and
handoff information. Portraits carry identity; color supplements but never
replaces text.

### Field-Guide Stat Block

Every role contract identifies the role before listing behavior. The integrated
vellum spread exposes habitat, quest capacity, authority, required yield, and
field kit from the shared `agentFieldGuides` source. It uses ruled divisions
inside one folio—not a row of independent dashboard cards—and becomes a linear
dossier on small screens.

### Commands

Commands sit in dark carved wells with visible copy controls and immediate
“Quest copied” feedback.

### Navigation

Desktop navigation is engraved into the table edge. Audience selection uses
stitched index tabs. Mobile navigation remains a conventional accessible sheet
dressed in the same materials.

## Do's and Don'ts

### Do:

- **Do** make each location visibly inhabited and functionally distinct.
- **Do** preserve semantic HTML above all decorative art and WebGL.
- **Do** use authored illustration at the scale the composition demands.
- **Do** keep all commands truthful and covered by CLI verification.
- **Do** provide immediate reduced-motion states and visible focus rings.

### Don't:

- **Don't** use generic circles, triangles, cubes, or icon tiles as the game world.
- **Don't** copy Dungeons & Dragons trade dress, published monsters, or branding.
- **Don't** fall back to glass, neon AI gradients, or repeated rounded cards.
- **Don't** let texture lower contrast or obscure the install action.
