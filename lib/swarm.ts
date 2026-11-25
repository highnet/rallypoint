/**
 * Rallypoint Swarm facts shared by the homepage band, /swarm, /swarm/wizard
 * and the docs. Every command and name here comes from docs/swarm/CONTRACT.md;
 * change them there first.
 */
import type { AgentSlug } from "@/lib/agents";

export const arenaUrl = "https://swarm-arena-race.vercel.app/";

export const swarmCommands = {
  addLoop: "npx rallypoint@latest add loop",
  init: "npx rallypoint@latest init",
  addSwarm: "npx rallypoint@latest add swarm",
  addUi: "npx rallypoint@latest add swarm-ui",
  addDashboard: "npx rallypoint@latest add swarm-dashboard",
  doctor: "npx rallypoint@latest swarm doctor",
  swarmInit: "npx rallypoint@latest swarm init",
  setSecret: "select swarm_set_secret('<your-swarm-secret>');",
  agentPrompt: "Run a swarm agent. Follow .claude/skills/swarm-agent/SKILL.md exactly.",
  conductor: "/loop /swarm-conductor",
} as const;

export function genesisPrompt(pitch: string) {
  const raw = pitch.trim().replace(/\s+/g, " ") || "<your pitch>";
  const text = /[.!?]$/.test(raw) ? raw : `${raw}.`;
  return `Run swarm genesis. Follow .claude/skills/swarm-genesis/SKILL.md. Pitch: ${text} Use the choices already in .rallypoint/swarm.json and decide the rest.`;
}

export const swarmEnvLines = [
  "export RALLYPOINT_SUPABASE_URL=https://<project-ref>.supabase.co",
  "export RALLYPOINT_SUPABASE_KEY=<publishable-key>",
  "export RALLYPOINT_SWARM_SECRET=<your-swarm-secret>",
].join("\n");

export const swarmUiEnvLines = [
  "NEXT_PUBLIC_RALLYPOINT_SUPABASE_URL=https://<project-ref>.supabase.co",
  "NEXT_PUBLIC_RALLYPOINT_SUPABASE_KEY=<publishable-key>",
  "RALLYPOINT_GITHUB_REPO=<owner>/<name>",
].join("\n");

/** Vanilla vs Swarm, row by row, from the confirmed brief. */
export const tierComparison: { aspect: string; vanilla: string; swarm: string }[] = [
  {
    aspect: "Coordination",
    vanilla: "GitHub only: issues, claim refs, labels, pull requests.",
    swarm: "The same. GitHub still owns the work.",
  },
  {
    aspect: "Memory",
    vanilla: "None beyond GitHub history.",
    swarm:
      "Your own Supabase project: sessions, progress notes, retros, messages, referee results, buried ideas, concepts.",
  },
  {
    aspect: "Role choice",
    vanilla: "You paste a role prompt.",
    swarm:
      "Each session picks its own role, finishing first: merger → fixer → reviewer → improver → worker → planner → janitor.",
  },
  {
    aspect: "Quality gate",
    vanilla: "Independent review bound to the head SHA.",
    swarm:
      "The same review, plus a referee on every change: a score that must beat main, checks that must pass, or independent review alone when there is nothing to measure. A loss is buried with its numbers.",
  },
  {
    aspect: "Learning",
    vanilla: "The improver, on before/after delivery metrics.",
    swarm:
      "Plus a retro from every session, buried ideas, concepts ported across targets, and metrics such as ship rate and claim-to-close time.",
  },
  {
    aspect: "Agent communication",
    vanilla: "Agents never message each other.",
    swarm:
      "Agents ask, propose and hand off in board threads stored in shared memory and visible to everyone. No private side channels.",
  },
  {
    aspect: "Running it",
    vanilla: "One prompt per role.",
    swarm:
      "A conductor /loop dispatches one session per role and target, with concurrency, budget, focus and escalation.",
  },
  {
    aspect: "Visibility",
    vanilla: "GitHub’s own views.",
    swarm:
      "A route scaffold you own: Progress, Fleet, Sessions, Board, Messages, Ideas buried, Concepts, Protocol.",
  },
  {
    aspect: "Setup",
    vanilla: "add loop, then init. Nothing else.",
    swarm: "More: a Supabase project with its schema and env, a goal, and optionally a way to measure it.",
  },
  {
    aspect: "Live proof",
    vanilla: "UTON OS: 1,328 pull requests opened and 1,256 merged in eight weeks.",
    swarm:
      "Swarm Arena: chess, Go 9×9, Othello and Hex engines written from scratch, each version measured against real opponents.",
  },
];

export type SwarmRole = {
  slug: AgentSlug;
  name: string;
  /** What this role does inside a swarm session. */
  job: string;
  command?: string;
};

/** Finish-first order: `swarm next` tries these top to bottom. */
export const swarmRoles: SwarmRole[] = [
  {
    slug: "merger",
    name: "Merger",
    job: "Lands approved pull requests whose referee result passed, then records the shipped version and its score.",
    command: "swarm ship --version v…",
  },
  {
    slug: "fixer",
    name: "Fixer",
    job: "Takes requested changes and failing checks on an open pull request and gets it back to review.",
  },
  {
    slug: "reviewer",
    name: "Reviewer",
    job: "Reviews someone else’s pull request, bound to its head SHA. Never its own.",
  },
  {
    slug: "improver",
    name: "Improver",
    job: "Once enough retros pile up, proposes one measured change to the tunable skills and role prompts. The judges stay frozen.",
  },
  {
    slug: "worker",
    name: "Worker",
    job: "Claims one issue, ships one pull request, runs the referee. A loss is buried with its lesson instead of merged.",
    command: "swarm referee",
  },
  {
    slug: "planner",
    name: "Planner · strategist",
    job: "Reads the digest of versions, buried ideas and concept trials, ports what worked to other targets, and opens the next issues.",
    command: "swarm brief",
  },
  {
    slug: "janitor",
    name: "Janitor",
    job: "Clears stale claims and abandoned sessions so the board tells the truth.",
  },
];

export type SwarmLoopStep = {
  name: string;
  holder: AgentSlug | "every";
  holderName: string;
  does: string;
  command: string;
  /** A step the swarm adds around the seven vanilla stations. */
  swarm?: boolean;
};

/**
 * One issue through the swarm, agent by agent: all seven vanilla stations
 * (Filed → Merged, as on the homepage) in order, plus the steps Swarm adds.
 */
export const swarmLoop: SwarmLoopStep[] = [
  { name: "Filed", holder: "planner", holderName: "Planner", does: "Turns the goal into small issues, each with a target and a concept.", command: "swarm plan plan.json" },
  { name: "Claimed", holder: "worker", holderName: "Worker", does: "Reserves exactly one issue through the reservation ref.", command: "claim.mjs --agent-id …" },
  { name: "Refereed", holder: "worker", holderName: "Worker", does: "Measures the change against the integration branch before opening anything.", command: "swarm referee", swarm: true },
  { name: "Buried", holder: "worker", holderName: "Worker", does: "If it lost, no pull request: the idea is buried with its numbers and lesson.", command: "swarm bury", swarm: true },
  { name: "PR opened", holder: "worker", holderName: "Worker", does: "A winning change becomes one pull request that closes its issue.", command: "Closes #n" },
  { name: "Changes requested", holder: "reviewer", holderName: "Reviewer", does: "Another session judges it at its head SHA, with the referee result.", command: "review.mjs record --verdict request-changes" },
  { name: "Fixed", holder: "fixer", holderName: "Fixer", does: "Pushes the fix and re-runs the referee; the head moves, so it goes back for review.", command: "swarm referee" },
  { name: "Approved", holder: "reviewer", holderName: "Reviewer", does: "An independent approve, never from the session that wrote the code.", command: "review.mjs record --verdict approve" },
  { name: "Merged", holder: "merger", holderName: "Merger", does: "Lands it and records the shipped version and its score.", command: "swarm ship --version v…" },
  { name: "Retro", holder: "every", holderName: "Every session", does: "Ends with what helped, what slowed it, and one suggestion.", command: "swarm retro", swarm: true },
  { name: "Improved", holder: "improver", holderName: "Improver", does: "When retros pile up, makes one measured change to the tunable skills.", command: "swarm protocol change", swarm: true },
];

/** The CLI command list from the contract, verbatim. */
export const swarmCliCommands: { command: string; does: string }[] = [
  { command: "doctor", does: "Checks env, gh, git, the config, Supabase reachability, the schema version and the secret." },
  { command: "init", does: "After doctor: creates target:<name> labels and stores the goal and visibility in swarm_settings." },
  { command: "prepare [--agent name]", does: "Opens a session (a row plus .git/rallypoint-swarm/session.json)." },
  {
    command: "next [target] [--only r1,r2]",
    does: "Picks the role, finishing first: merger → fixer → reviewer → improver → worker → planner → janitor. Prints ROLE, TARGET and READ.",
  },
  { command: "log \"<note>\"", does: "Appends a progress note and refreshes last_seen_at." },
  { command: "say --kind <kind> [--ref #n] [--thread id] \"<body>\"", does: "Posts a message." },
  { command: "inbox [--ref #n]", does: "Reads recent messages." },
  {
    command: "referee [--target t] [--baseline <ref>]",
    does: "Runs measure.command on HEAD and on the baseline, compares by direction and margin, records the result. Exits 0 or 3.",
  },
  {
    command: "bury --idea … --reason … --lesson … [--concept c] [--target t]",
    does: "Records a buried idea with its numbers (the latest result).",
  },
  { command: "ship --version v… [--target t] [--pr n]", does: "Records a shipped version with its score (merger only, after merge)." },
  { command: "concept add <id> \"<name>\" \"<description>\"", does: "Adds a concept the swarm can try on any target." },
  {
    command: "concept trial <id> --target t --outcome gained|lost|neutral [--delta d]",
    does: "Records one trial of a concept on a target.",
  },
  { command: "plan <plan.json>", does: "Opens GitHub issues from [{title, body, target, concept, type, prio}]." },
  { command: "brief", does: "The strategist’s digest: goal, targets, versions, buried ideas, concept trials, open work." },
  { command: "metrics", does: "The swarm_metrics row." },
  { command: "retro --well … --friction … --suggest …", does: "Writes the retro and ends the session." },
  { command: "status", does: "A JSON snapshot for the conductor." },
];

/** The scaffold's sections and routes, from the contract's UI table. */
export const swarmUiRoutes: { section: string; routes: { name: string; path: string }[] }[] = [
  {
    section: "Results",
    routes: [
      { name: "Progress", path: "/swarm" },
      { name: "News", path: "/swarm/news" },
      { name: "Targets", path: "/swarm/targets" },
      { name: "Results", path: "/swarm/results" },
      { name: "Versions", path: "/swarm/versions" },
      { name: "Ideas buried", path: "/swarm/buried" },
    ],
  },
  {
    section: "Swarm",
    routes: [
      { name: "Fleet", path: "/swarm/fleet" },
      { name: "Sessions", path: "/swarm/sessions" },
      { name: "Rallypoint lanes", path: "/swarm/rallypoint" },
      { name: "Board", path: "/swarm/board" },
      { name: "Messages", path: "/swarm/messages" },
    ],
  },
  {
    section: "Learn",
    routes: [
      { name: "How it works", path: "/swarm/how-it-works" },
      { name: "Protocol", path: "/swarm/protocol" },
      { name: "Concepts", path: "/swarm/concepts" },
      { name: "Skills", path: "/swarm/skills" },
    ],
  },
];

export const measureModes = [
  {
    id: "score",
    name: "Score",
    gate: "A command prints a number. The change must beat the integration branch by the margin, in the direction you set.",
    fits: "Engines, benchmarks, eval suites, simulations. Swarm Arena uses Elo.",
  },
  {
    id: "checks",
    name: "Checks",
    gate: "Named pass/fail commands must all exit 0. No number, no baseline run.",
    fits: "A website or product: build, tests, end-to-end, a Lighthouse or accessibility budget.",
  },
  {
    id: "review",
    name: "Review",
    gate: "No automated referee. The independent reviewer’s verdict against the issue’s acceptance criteria is the gate, as in vanilla.",
    fits: "Work with nothing to measure automatically: writing, research, design.",
  },
] as const;

/* ───────────── Config generation (the wizard) ───────────── */

export const roleOrder = ["merger", "fixer", "reviewer", "improver", "worker", "planner", "janitor"];
export const tunablePaths = [".rallypoint/roles/", ".rallypoint/swarm/skills/", ".rallypoint/swarm/playbooks/"];
export const frozenPaths = [
  ".rallypoint/scripts/",
  ".rallypoint/swarm/swarm.mjs",
  ".rallypoint/swarm/lib/",
  ".rallypoint/swarm/schema.sql",
  ".rallypoint/swarm.json",
  ".rallypoint/roles/reviewer.md",
  ".rallypoint/roles/merger.md",
  ".rallypoint/roles/improver.md",
];

/** A small palette that holds AA non-text contrast on paper and night paper. */
export const targetPalette = [
  { name: "Blue", hex: "#2f5bd3" },
  { name: "Red", hex: "#c8312b" },
  { name: "Green", hex: "#1a7f37" },
  { name: "Purple", hex: "#8250df" },
  { name: "Orange", hex: "#c4581b" },
  { name: "Teal", hex: "#0f7b8a" },
  { name: "Gold", hex: "#a77a00" },
  { name: "Slate", hex: "#5b6478" },
];

export type UiShape = "product" | "dashboard" | "none";
export type Focus = "balanced" | "finish-first" | "experiments" | "port-concepts";

export type WizardTarget = {
  name: string;
  description: string;
  color: string;
  /** Optional explicit id; otherwise derived from the name. */
  id?: string;
};
export type MeasureMode = "score" | "checks" | "review";
export type WizardCheck = { name: string; command: string };

export type WizardState = {
  pitch: string;
  title: string;
  statement: string;
  measureMode: MeasureMode;
  measureLabel: string;
  command: string;
  checks: WizardCheck[];
  direction: "higher" | "lower";
  margin: string;
  unit: string;
  targets: WizardTarget[];
  projectName: string;
  tagline: string;
  vocabShipped: string;
  vocabBuried: string;
  vocabVersion: string;
  uiShape: UiShape;
  visibility: "public" | "private";
  includeUiTarget: boolean;
  concurrency: number;
  budget: number | null;
  focus: Focus;
};

export const emptyWizard: WizardState = {
  pitch: "",
  title: "",
  statement: "",
  measureMode: "checks",
  measureLabel: "",
  command: "",
  checks: [],
  direction: "higher",
  margin: "",
  unit: "",
  targets: [],
  projectName: "",
  tagline: "",
  vocabShipped: "",
  vocabBuried: "",
  vocabVersion: "",
  uiShape: "product",
  visibility: "public",
  includeUiTarget: true,
  concurrency: 4,
  budget: null,
  focus: "balanced",
};

export const arenaPitch =
  "A swarm of AI agents building chess, Go, Othello and Hex engines that keep getting stronger. Watch them climb, read the code, or play one yourself.";

export const arenaExample: WizardState = {
  ...emptyWizard,
  pitch: arenaPitch,
  title: "Swarm Arena",
  statement:
    "Chess, Go 9×9, Othello and Hex engines written from scratch. A version ships only when it beats real opponents (Stockfish, GNU Go, Edax, an MCTS ladder); losing code is thrown out and the lesson kept.",
  measureMode: "score",
  measureLabel: "Elo vs the ladder",
  command: "npm run referee --silent",
  direction: "higher",
  unit: "Elo",
  targets: [
    { id: "chess", name: "Chess", description: "Chess engine, measured against Stockfish.", color: "#2f5bd3" },
    { id: "go9", name: "Go 9×9", description: "Go 9×9 engine, measured against GNU Go.", color: "#1a7f37" },
    { id: "othello", name: "Othello", description: "Othello engine, measured against Edax.", color: "#c8312b" },
    { id: "hex", name: "Hex 11×11", description: "Hex engine, measured against an MCTS ladder.", color: "#8250df" },
  ],
  projectName: "Swarm Arena",
  tagline: "Watch them climb, read the code, or play one yourself.",
  vocabShipped: "landed",
  vocabBuried: "buried",
  vocabVersion: "version",
  uiShape: "product",
  visibility: "public",
  includeUiTarget: true,
};

export function targetId(name: string) {
  return name
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export function buildSwarmConfig(state: WizardState) {
  const targets = state.targets
    .filter((target) => target.name.trim())
    .map((target) => ({
      id: target.id?.trim() || targetId(target.name),
      name: target.name.trim(),
      description: target.description.trim(),
      color: target.color,
    }));
  const margin = Number.parseFloat(state.margin);
  const score = state.measureMode === "score";

  return {
    goal: { title: state.title.trim(), statement: state.statement.trim(), pitch: state.pitch.trim() },
    measure: {
      mode: state.measureMode,
      label: state.measureLabel.trim(),
      command: score ? state.command.trim() : "",
      direction: state.direction,
      margin: score && Number.isFinite(margin) ? margin : 0,
      unit: score ? state.unit.trim() : "",
      checks:
        state.measureMode === "checks"
          ? state.checks
              .filter((check) => check.name.trim() || check.command.trim())
              .map((check) => ({ name: check.name.trim(), command: check.command.trim() }))
          : [],
      timeoutSeconds: 1800,
    },
    targets: targets.map(({ id, name, description }) => ({ id, name, description })),
    ui: {
      project: { name: state.projectName.trim(), tagline: state.tagline.trim() },
      targets: Object.fromEntries(targets.map(({ id, color }) => [id, { color }])),
      vocabulary: {
        shipped: state.vocabShipped.trim() || "shipped",
        buried: state.vocabBuried.trim() || "buried",
        version: state.vocabVersion.trim() || "version",
      },
      includeUiTarget: state.uiShape !== "none" && state.includeUiTarget,
    },
    visibility: state.visibility,
    protocolVersion: "p1",
    roleOrder,
    improverRetroThreshold: 3,
    conductor: { concurrency: state.concurrency, budget: state.budget, focus: state.focus, pace: "self" },
    tunablePaths,
    frozenPaths,
  };
}

export function conductorPrompt(state: WizardState) {
  const names = state.targets.map((t) => t.id?.trim() || targetId(t.name)).filter(Boolean);
  return [
    swarmCommands.conductor,
    `Concurrency: ${state.concurrency} sessions at a time.`,
    `Targets: ${names.length ? names.join(", ") : "every target in .rallypoint/swarm.json"}.`,
    `Budget: ${state.budget === null ? "unbounded; keep going until I stop you" : `${state.budget} sessions, then stop and report`}.`,
    `Focus: ${state.focus}.`,
    "Dispatch only through separate sessions; subagents stay inside a role.",
    "Escalate needs:human to me; never work around them.",
  ].join("\n");
}
