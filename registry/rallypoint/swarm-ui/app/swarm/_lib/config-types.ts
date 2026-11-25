/**
 * The shape of `app/swarm/swarm.config.ts`, the one project-owned file that
 * holds every project-specific word, colour and route of the swarm UI.
 *
 * GENERATION (what `rallypoint add swarm-ui` / `add swarm-dashboard` writes,
 * only when the file is absent; it never overwrites it):
 *
 *   swarmConfig field          <- `.rallypoint/swarm.json` field
 *   ------------------------------------------------------------------------
 *   project.name               <- ui.project.name, else the repository name
 *   project.tagline            <- ui.project.tagline, else goal.pitch, else ""
 *   goal.title                 <- goal.title
 *   goal.statement             <- goal.statement
 *   measure.mode               <- measure.mode ("score" | "checks" | "review")
 *   measure.label              <- measure.label, else "Score" in score mode,
 *                                 "Checks" in checks mode, "Review" in review
 *                                 mode
 *   measure.unit               <- measure.unit
 *   measure.direction          <- measure.direction ("higher" | "lower")
 *   targets[i].id              <- targets[i].id
 *   targets[i].name            <- targets[i].name, else targets[i].id
 *   targets[i].description     <- targets[i].description, else ""
 *   targets[i].color           <- ui.targets[<id>].color, else the i-th
 *                                 colour of DEFAULT_TARGET_COLORS below
 *   vocabulary                 <- DEFAULT_VOCABULARY, then ui.vocabulary
 *                                 merged over it key by key
 *   nav                        <- DEFAULT_NAV (not read from swarm.json)
 *   theme.cssVars              <- {} (not read from swarm.json)
 *
 * A `ui` target added by `ui.includeUiTarget` is an ordinary entry in
 * `targets` and is generated like any other.
 *
 * Everything the UI reads at runtime from Supabase (`swarm_settings.goal`,
 * the measure command, visibility) stays live; this file only decides how
 * it is presented. Where both exist, a non-empty value here wins.
 */

export type MeasureDirection = "higher" | "lower";

/**
 * How the referee judges a change (CONTRACT.md, "Measure modes").
 * - score: a number that must beat the baseline; /swarm draws a score chart.
 * - checks: named commands that must all pass; /swarm shows delivery.
 * - review: the reviewer's verdict is the gate; /swarm shows delivery.
 */
export type MeasureMode = "score" | "checks" | "review";

export type SwarmTarget = {
  /** The id agents record in `target` columns, e.g. "api". */
  id: string;
  /** The name printed beside the colour. Colour never appears alone. */
  name: string;
  /** Any CSS colour. Used for chart lines and target swatches. */
  color: string;
  description: string;
};

/**
 * The nouns the pages print. Change a value to change the word everywhere,
 * for example `shipped: "landed"`. Keep each key's singular/plural pair in
 * step.
 */
export type SwarmVocabulary = {
  shipped: string;
  buried: string;
  version: string;
  versions: string;
  session: string;
  sessions: string;
  target: string;
  targets: string;
  idea: string;
  ideas: string;
  concept: string;
  concepts: string;
  result: string;
  results: string;
  agent: string;
  message: string;
  messages: string;
  score: string;
};

export type NavSection = "Results" | "Swarm" | "Learn" | (string & {});

export type SwarmNavItem = {
  /** An absolute path inside the app, e.g. "/swarm/fleet". */
  href: string;
  label: string;
  /** Items are grouped under their section, in order of first appearance. */
  section: NavSection;
};

export type SwarmConfig = {
  project: { name: string; tagline: string };
  goal: { title: string; statement: string };
  measure: {
    mode: MeasureMode;
    label: string;
    /** Only meaningful in score mode. */
    unit: string;
    /** Only meaningful in score mode. */
    direction: MeasureDirection;
  };
  targets: SwarmTarget[];
  vocabulary: SwarmVocabulary;
  nav: SwarmNavItem[];
  /**
   * CSS custom properties set on the `.rp-swarm` root, e.g.
   * `{ "--rp-accent": "#0a7d5a" }`. See the list at the top of swarm.css.
   */
  theme: { cssVars: Record<string, string> };
};

export const DEFAULT_TARGET_COLORS = [
  "#2f5bd3",
  "#d4572a",
  "#0f8a6a",
  "#a23dbf",
  "#b8860b",
  "#2a7fb8",
  "#c0396b",
  "#5b6b2f",
] as const;

export const DEFAULT_VOCABULARY: SwarmVocabulary = {
  shipped: "shipped",
  buried: "buried",
  version: "version",
  versions: "versions",
  session: "session",
  sessions: "sessions",
  target: "target",
  targets: "targets",
  idea: "idea",
  ideas: "ideas",
  concept: "concept",
  concepts: "concepts",
  result: "result",
  results: "results",
  agent: "agent",
  message: "message",
  messages: "messages",
  score: "score",
};

/**
 * Every scaffold route, matching Swarm Arena's navigation one to one
 * (CONTRACT.md, "UI routes"). Remove an entry to hide a route from the nav,
 * rename a label, or add your own pages. The arena would label targets
 * "Engines" and results "Games".
 */
export const DEFAULT_NAV: SwarmNavItem[] = [
  { href: "/swarm", label: "Progress", section: "Results" },
  { href: "/swarm/news", label: "News", section: "Results" },
  { href: "/swarm/targets", label: "Targets", section: "Results" },
  { href: "/swarm/results", label: "Results", section: "Results" },
  { href: "/swarm/versions", label: "Versions", section: "Results" },
  { href: "/swarm/buried", label: "Ideas buried", section: "Results" },
  { href: "/swarm/fleet", label: "Fleet", section: "Swarm" },
  { href: "/swarm/sessions", label: "Sessions", section: "Swarm" },
  { href: "/swarm/rallypoint", label: "Rallypoint", section: "Swarm" },
  { href: "/swarm/board", label: "Board", section: "Swarm" },
  { href: "/swarm/messages", label: "Messages", section: "Swarm" },
  { href: "/swarm/how-it-works", label: "How it works", section: "Learn" },
  { href: "/swarm/protocol", label: "Protocol", section: "Learn" },
  { href: "/swarm/concepts", label: "Concepts", section: "Learn" },
  { href: "/swarm/skills", label: "Skills", section: "Learn" },
];
