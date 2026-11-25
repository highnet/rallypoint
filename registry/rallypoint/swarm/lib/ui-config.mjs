// Generates the project's own `app/swarm/swarm.config.ts` from
// `.rallypoint/swarm.json`. Pure. The mapping is the one documented at the top
// of the scaffold's `app/swarm/_lib/config-types.ts`; keep the two in step.
//
// The generated file is project-owned: the CLI writes it only when absent.

import { allTargets, withDefaults } from "./config.mjs";

export const DEFAULT_TARGET_COLORS = ["#2f5bd3", "#d4572a", "#0f8a6a", "#a23dbf", "#b8860b", "#2a7fb8", "#c0396b", "#5b6b2f"];

const MEASURE_LABEL = { score: "Score", checks: "Checks", review: "Review" };

const capital = (text) => (text ? text[0].toUpperCase() + text.slice(1) : text);

/** The swarmConfig object the generated file exports (minus nav/vocabulary spreads). */
export const uiConfigFrom = (rawConfig, { repository = null } = {}) => {
  const config = withDefaults(rawConfig);
  const repoName = repository ? String(repository).split("/").pop() : "";
  const mode = config.measure.mode ?? "review";
  return {
    project: {
      name: config.ui.project.name || repoName || "Swarm",
      tagline: config.ui.project.tagline || config.goal.pitch || "",
    },
    goal: { title: config.goal.title ?? "", statement: config.goal.statement ?? "" },
    measure: {
      mode,
      label: config.measure.label || MEASURE_LABEL[mode] || "Review",
      unit: config.measure.unit ?? "",
      direction: config.measure.direction === "lower" ? "lower" : "higher",
    },
    targets: allTargets(config).map((target, i) => ({
      id: target.id,
      name: target.name || target.id,
      color: config.ui.targets?.[target.id]?.color || DEFAULT_TARGET_COLORS[i % DEFAULT_TARGET_COLORS.length],
      description: target.description ?? "",
    })),
    vocabulary: rawConfig?.ui?.vocabulary ?? {},
  };
};

const literal = (value, indent = 2) =>
  JSON.stringify(value, null, 2)
    .split("\n")
    .map((line, i) => (i === 0 ? line : `${" ".repeat(indent)}${line}`))
    .join("\n");

/** @returns {string} TypeScript source for app/swarm/swarm.config.ts */
export const renderUiConfig = (rawConfig, options = {}) => {
  const ui = uiConfigFrom(rawConfig, options);
  const vocabulary = Object.fromEntries(Object.entries(ui.vocabulary).filter(([, value]) => typeof value === "string" && value));
  const navOverrides = {};
  if (vocabulary.targets) navOverrides["/swarm/targets"] = capital(vocabulary.targets);
  if (vocabulary.results) navOverrides["/swarm/results"] = capital(vocabulary.results);
  const nav = Object.keys(navOverrides).length
    ? `DEFAULT_NAV.map((item) => ({ ...item, label: (${literal(navOverrides, 4)} as Record<string, string>)[item.href] ?? item.label }))`
    : "[...DEFAULT_NAV]";

  return `/**
 * Swarm UI configuration for ${ui.project.name}. This file is PROJECT-OWNED:
 * edit freely. Rallypoint wrote it once, from .rallypoint/swarm.json, and never
 * overwrites it (regenerate on purpose with: npx rallypoint swarm ui-config --force).
 *
 * It holds every project-specific word, colour and route the swarm pages print.
 * The field-by-field mapping is documented at the top of ./_lib/config-types.ts.
 */
import {
  DEFAULT_NAV,
  DEFAULT_VOCABULARY,
  type SwarmConfig,
} from "./_lib/config-types";

export const swarmConfig: SwarmConfig = {
  project: ${literal(ui.project)},
  goal: ${literal(ui.goal)},
  measure: ${literal(ui.measure)},
  targets: ${literal(ui.targets)},
  vocabulary: { ...DEFAULT_VOCABULARY${Object.keys(vocabulary).length ? `, ...${literal(vocabulary, 2)}` : ""} },
  nav: ${nav},
  theme: {
    cssVars: {},
  },
};
`;
};
