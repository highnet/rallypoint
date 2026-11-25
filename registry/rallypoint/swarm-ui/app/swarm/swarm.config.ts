/**
 * Swarm UI configuration. This file is PROJECT-OWNED: edit freely.
 * Rallypoint writes it once, when it is absent, and never overwrites it.
 *
 * It holds every project-specific word, colour and route the swarm pages
 * print. The field-by-field mapping from `.rallypoint/swarm.json` is
 * documented at the top of `./_lib/config-types.ts`.
 *
 * The values below are neutral placeholders.
 */
import {
  DEFAULT_NAV,
  DEFAULT_VOCABULARY,
  type SwarmConfig,
} from "./_lib/config-types";

export const swarmConfig: SwarmConfig = {
  project: {
    name: "Swarm",
    tagline: "The public record of this repository's agent swarm.",
  },
  goal: {
    title: "",
    statement: "",
  },
  measure: {
    mode: "checks",
    label: "Checks",
    unit: "",
    direction: "higher",
  },
  targets: [
    {
      id: "main",
      name: "Main",
      color: "#2f5bd3",
      description: "The default target.",
    },
  ],
  vocabulary: { ...DEFAULT_VOCABULARY },
  nav: [...DEFAULT_NAV],
  theme: {
    cssVars: {},
  },
};
