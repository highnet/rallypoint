export const agents = [
  {
    slug: "planner",
    portrait: "/world/roles/planner.jpg",
    name: "Planner",
    title: "The cartographer",
    summary: "Keeps a dependency-aware queue of small, claimable quests.",
    color: "violet",
    token: "hex",
    charge: "bearing-star",
    does: [
      "Reads repository rules, the roadmap, open issues, and dependencies.",
      "Files small issues with explicit acceptance criteria and priority.",
      "Marks genuine owner decisions for human attention.",
    ],
    never: ["Claims implementation work", "Edits product code", "Reviews pull requests"],
    handoff: "A scoped, prioritised issue that is claimable the moment it is filed.",
  },
  {
    slug: "worker",
    portrait: "/world/roles/worker.jpg",
    name: "Worker",
    title: "The builder",
    summary: "Claims one quest and ships one focused pull request.",
    color: "red",
    token: "triangle",
    charge: "keystone-mark",
    does: [
      "Atomically claims exactly one claimable issue.",
      "Creates one issue branch from the current integration branch.",
      "Completes acceptance criteria and runs relevant checks.",
    ],
    never: ["Holds multiple claims", "Reviews its own work", "Pushes to a protected branch"],
    handoff: "One ready-for-review pull request that closes the claimed issue.",
  },
  {
    slug: "reviewer",
    portrait: "/world/roles/reviewer.jpg",
    name: "Reviewer",
    title: "The gatekeeper",
    summary: "Judges another agent’s diff and alone may grant approval.",
    color: "blue",
    token: "square",
    charge: "chop-seal",
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
    portrait: "/world/roles/tester.jpg",
    name: "Tester",
    title: "The scout",
    summary: "Finds the weakest meaningful behavior and closes its coverage gap.",
    color: "amber",
    token: "star",
    charge: "blaze-mark",
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
    portrait: "/world/roles/fixer.jpg",
    name: "Fixer",
    title: "The mender",
    summary: "Returns a reviewed pull request to a mergeable state.",
    color: "green",
    token: "pentagon",
    charge: "stitch-mark",
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
    portrait: "/world/roles/janitor.jpg",
    name: "Janitor",
    title: "The keeper",
    summary: "Releases stale coordination state without touching product work.",
    color: "slate",
    token: "round",
    charge: "ward-ring",
    does: [
      "Finds claims with no branch or pull-request evidence of activity.",
      "Releases abandoned claims, clearing the label, assignee, and reservation.",
      "Removes closed-issue reservations and sweeps expired session leases.",
    ],
    never: ["Claims work", "Edits product code", "Reviews, approves, or merges"],
    handoff: "A truthful board with stale reservations released and no product diff.",
  },
  {
    slug: "merger",
    portrait: "/world/roles/merger.jpg",
    name: "Merger",
    title: "The ferryman",
    summary: "Carries approved work across, and never on the verdict alone.",
    color: "brass",
    token: "keystone",
    charge: "ford-mark",
    does: [
      "Reads the recorded verdict, then checks CI itself — approved is not mergeable.",
      "Confirms the head has not moved since the verdict and the run it read.",
      "Merges, deletes the remote branch, and reconciles the claim it left behind.",
    ],
    never: ["Claims work", "Reviews or approves", "Merges on a stale or unread check"],
    handoff: "Merged work, a closed or deliberately open issue, and no reservation left standing.",
  },
  {
    slug: "orchestrator",
    portrait: "/world/roles/orchestrator.jpg",
    name: "Orchestrator",
    title: "The marshal",
    summary: "Reads the shared board and recommends which roles run next.",
    color: "rose",
    token: "diamond",
    charge: "rally-point",
    does: [
      "Reads the claimable pool, open claims, and pull-request state across the repository.",
      "Decides which role — planner, worker, reviewer, tester, fixer, merger, or janitor — should run next.",
      "Recommends how many sessions of each role to start, then stops for an operator to confirm.",
    ],
    never: ["Claims an issue itself", "Edits product code or reviews a diff", "Starts a session on its own authority"],
    handoff: "A sized recommendation, matched to the right roles, for an operator to confirm.",
  },
] as const;

export type Agent = (typeof agents)[number];

export const agentFieldGuides = {
  planner: {
    habitat: "Planner’s Star Tower",
    habitatDetail: "Observatory, dependency charts, claimable queue",
    fieldKit: "Compass · issue map · acceptance ledger",
    capacity: "No claim",
    authority: "Queue",
    yield: "Ready quest",
  },
  worker: {
    habitat: "Worker’s Emberworks",
    habitatDetail: "Forge floor, branch anvil, green-check bell",
    fieldKit: "One claim token · hammer · focused diff",
    capacity: "One quest",
    authority: "Build",
    yield: "Focused PR",
  },
  reviewer: {
    habitat: "Reviewer’s Owl Scriptorium",
    habitatDetail: "Archive stacks, verdict desk, merge gate",
    fieldKit: "Contract · current revision · independent seal",
    capacity: "No claim",
    authority: "Verdict",
    yield: "Approval or changes",
  },
  tester: {
    habitat: "Tester’s Thornwood",
    habitatDetail: "Broken paths, edge cases, reproducible tracks",
    fieldKit: "Coverage lantern · measuring staff · failure specimen",
    capacity: "Filed gap",
    authority: "Coverage",
    yield: "Behavioral test",
  },
  fixer: {
    habitat: "Fixer’s Red Apothecary",
    habitatDetail: "Repair bench, newest verdict, retest shelf",
    fieldKit: "Requested changes · narrow instruments · same branch",
    capacity: "Current PR",
    authority: "Repair",
    yield: "Corrected revision",
  },
  janitor: {
    habitat: "Janitor’s Barrow of Keys",
    habitatDetail: "Stale claims, closed quests, truthful queue",
    fieldKit: "Activity trail · reservation keys · cleanup ledger",
    capacity: "No claim",
    authority: "Cleanup",
    yield: "Truthful queue",
  },
  merger: {
    habitat: "Merger’s Brass Ford",
    habitatDetail: "The one crossing, rollup boards, tally of what landed",
    fieldKit: "Verdict seal · check rollup · head-SHA glass",
    capacity: "No claim",
    authority: "Crossing",
    yield: "Landed work",
  },
  orchestrator: {
    habitat: "Marshal’s Road Shrine",
    habitatDetail: "Central rally camp where every route is visible",
    fieldKit: "Shared board · role roster · sized recommendation",
    capacity: "No claim",
    authority: "Counsel",
    yield: "Sized recommendation",
  },
} satisfies Record<
  Agent["slug"],
  {
    habitat: string;
    habitatDetail: string;
    fieldKit: string;
    capacity: string;
    authority: string;
    yield: string;
  }
>;

export function getAgent(slug: string) {
  return agents.find((agent) => agent.slug === slug);
}
