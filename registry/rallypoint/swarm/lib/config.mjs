// `.rallypoint/swarm.json`: what this swarm is for and how it is judged.
// Pure: parsing, defaults and validation only.

import { DEFAULT_ROLE_ORDER } from "./roles.mjs";
import { validateMeasure } from "./referee.mjs";

export const DEFAULTS = Object.freeze({
  goal: { title: "", statement: "", pitch: "" },
  measure: { mode: "review", label: "", command: "", direction: "higher", margin: 0, unit: "", checks: [], timeoutSeconds: 1800 },
  targets: [],
  ui: {
    project: { name: "", tagline: "" },
    targets: {},
    vocabulary: { shipped: "shipped", buried: "buried", version: "version" },
    includeUiTarget: false,
  },
  visibility: "public",
  protocolVersion: "p1",
  roleOrder: DEFAULT_ROLE_ORDER,
  improverRetroThreshold: 3,
  conductor: { concurrency: 4, budget: null, focus: "balanced", pace: "self" },
  tunablePaths: [".rallypoint/roles/", ".rallypoint/swarm/skills/", ".rallypoint/swarm/playbooks/"],
  frozenPaths: [
    ".rallypoint/scripts/",
    ".rallypoint/swarm/swarm.mjs",
    ".rallypoint/swarm/lib/",
    ".rallypoint/swarm/schema.sql",
    ".rallypoint/swarm.json",
    ".rallypoint/roles/reviewer.md",
    ".rallypoint/roles/merger.md",
    ".rallypoint/roles/improver.md",
  ],
});

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

/** Shallow-per-section merge of a user config over the defaults. */
export const withDefaults = (config = {}) => ({
  ...DEFAULTS,
  ...config,
  goal: { ...DEFAULTS.goal, ...(config.goal ?? {}) },
  measure: { ...DEFAULTS.measure, ...(config.measure ?? {}) },
  ui: {
    ...DEFAULTS.ui,
    ...(config.ui ?? {}),
    project: { ...DEFAULTS.ui.project, ...(config.ui?.project ?? {}) },
    vocabulary: { ...DEFAULTS.ui.vocabulary, ...(config.ui?.vocabulary ?? {}) },
    targets: { ...(config.ui?.targets ?? {}) },
  },
  conductor: { ...DEFAULTS.conductor, ...(config.conductor ?? {}) },
  targets: Array.isArray(config.targets) ? config.targets : DEFAULTS.targets,
});

export const TARGET_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;

/** @returns {string[]} problems; empty means valid */
export const validateSwarmConfig = (config) => {
  const problems = [];
  if (!isObject(config)) return [".rallypoint/swarm.json must be a JSON object"];
  problems.push(...validateMeasure(config.measure));
  const ids = new Set();
  for (const [i, target] of (config.targets ?? []).entries()) {
    if (!isObject(target) || !TARGET_ID.test(target.id ?? "")) {
      problems.push(`targets[${i}].id must match ${TARGET_ID} (lowercase, digits, dashes)`);
      continue;
    }
    if (ids.has(target.id)) problems.push(`targets[${i}].id "${target.id}" is duplicated`);
    ids.add(target.id);
  }
  if (!["public", "private"].includes(config.visibility)) problems.push('visibility must be "public" or "private"');
  const unknownRoles = (config.roleOrder ?? []).filter((role) => !DEFAULT_ROLE_ORDER.includes(role));
  if (unknownRoles.length) problems.push(`roleOrder has unknown role(s): ${unknownRoles.join(", ")}`);
  // A frozen file inside a tunable folder is fine (frozen wins, as in
  // vanilla: `.rallypoint/roles/` is tunable, `roles/reviewer.md` is not). A
  // tunable path inside a frozen one would hand the improver its own judge.
  for (const path of config.tunablePaths ?? []) {
    if ((config.frozenPaths ?? []).some((frozen) => path.startsWith(frozen))) {
      problems.push(`tunable path ${path} overlaps a frozen path`);
    }
  }
  return problems;
};

export const parseSwarmConfig = (text) => {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    return { config: null, problems: [`.rallypoint/swarm.json is not valid JSON: ${error.message}`] };
  }
  const config = withDefaults(raw);
  return { config, problems: validateSwarmConfig(config) };
};

/** Everything a target can be, including the optional `ui` target. */
export const allTargets = (config) => {
  const targets = [...(config.targets ?? [])];
  if (config.ui?.includeUiTarget && !targets.some((target) => target.id === "ui")) {
    targets.push({ id: "ui", name: "UI", description: "The swarm's own frontend, grown from the Rallypoint scaffold." });
  }
  return targets;
};
