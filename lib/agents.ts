export const agents = [
  {
    slug: "planner",
    name: "Planner",
    title: "The cartographer",
    summary: "Keeps a dependency-aware queue of small, ready quests.",
    color: "violet",
    token: "hex",
    does: [
      "Reads repository rules, the roadmap, open issues, and dependencies.",
      "Maintains 5–15 ready tasks with explicit acceptance criteria.",
      "Marks genuine owner decisions for human attention.",
    ],
    never: ["Claims implementation work", "Edits product code", "Reviews pull requests"],
    handoff: "A groomed status:ready issue with scope, priority, verification, and dependencies.",
  },
  {
    slug: "worker",
    name: "Worker",
    title: "The builder",
    summary: "Claims one quest and ships one focused pull request.",
    color: "red",
    token: "triangle",
    does: [
      "Atomically claims exactly one ready issue.",
      "Creates one issue branch from the current integration branch.",
      "Completes acceptance criteria and runs relevant checks.",
    ],
    never: ["Holds multiple claims", "Reviews its own work", "Pushes to a protected branch"],
    handoff: "One ready-for-review pull request that closes the claimed issue.",
  },
  {
    slug: "reviewer",
    name: "Reviewer",
    title: "The gatekeeper",
    summary: "Judges another agent’s diff and alone may grant approval.",
    color: "blue",
    token: "square",
    does: [
      "Reads the linked quest, repository rules, and current revision.",
      "Checks correctness, security, maintainability, tests, and scope.",
      "Approves or leaves one concise set of actionable changes.",
    ],
    never: ["Fixes the branch", "Claims an issue", "Reviews its own session’s work"],
    handoff: "A clear approval or requested-changes verdict on the current revision.",
  },
  {
    slug: "tester",
    name: "Tester",
    title: "The scout",
    summary: "Finds the weakest meaningful behavior and closes its coverage gap.",
    color: "amber",
    token: "star",
    does: [
      "Measures coverage across the workspace.",
      "Files one small, reproducible coverage-gap quest.",
      "Claims that quest and adds the missing behavioral tests.",
    ],
    never: ["Refactors unrelated code", "Invents broad test rewrites", "Reviews its own pull request"],
    handoff: "A focused test pull request tied to a documented coverage gap.",
  },
  {
    slug: "fixer",
    name: "Fixer",
    title: "The mender",
    summary: "Returns a reviewed pull request to a mergeable state.",
    color: "green",
    token: "pentagon",
    does: [
      "Reads the newest requested-changes verdict and unresolved comments.",
      "Applies focused fixes on the existing pull-request branch.",
      "Re-runs relevant checks and pushes the corrected revision.",
    ],
    never: ["Claims another issue", "Broadens scope", "Approves the resulting work"],
    handoff: "The same pull request, updated and ready for independent re-review.",
  },
  {
    slug: "janitor",
    name: "Janitor",
    title: "The keeper",
    summary: "Releases stale coordination state without touching product work.",
    color: "slate",
    token: "round",
    does: [
      "Finds claims with no branch or pull-request evidence of activity.",
      "Restores abandoned issues to the ready queue.",
      "Removes closed-issue reservations and reminds idle pull requests.",
    ],
    never: ["Claims work", "Edits product code", "Reviews, approves, or merges"],
    handoff: "A truthful queue with stale reservations removed and no product diff.",
  },
] as const;

export type Agent = (typeof agents)[number];

export function getAgent(slug: string) {
  return agents.find((agent) => agent.slug === slug);
}
