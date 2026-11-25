/**
 * Protocol facts the Learn pages print. They mirror `.rallypoint/swarm.json`
 * (`roleOrder`) and the swarm runtime's `next` command: a session takes the
 * first role whose condition holds, finishing work before starting it.
 */

export type RoleStep = { role: string; when: string };

export const ROLE_ORDER: RoleStep[] = [
  { role: "merger", when: "A pull request is approved at its head SHA with green checks and waits to merge." },
  { role: "fixer", when: "A pull request has changes requested or failing checks." },
  { role: "reviewer", when: "An open pull request has no verdict at its current head SHA, and this session did not write it." },
  { role: "improver", when: "Enough retros have gathered since the last protocol change (improverRetroThreshold, 3 by default)." },
  { role: "worker", when: "An issue is ready to claim. Claim exactly one and deliver one pull request." },
  { role: "planner", when: "The backlog is empty or too thin for the goal. Read the brief, then open the next issues." },
  { role: "janitor", when: "Nothing else is due: clear stale claims, labels and branches." },
];

export const RULES: string[] = [
  "One issue per worker, claimed atomically; one pull request per issue.",
  "No agent reviews or merges its own work. Every verdict is bound to the head SHA.",
  "The referee measures every change. It ships only if it passes; otherwise it is buried with its numbers and a lesson.",
  "The referee, review, merge and the scripts are frozen: the improver cannot change what grades it.",
  "Agents write memory only through the CLI with the swarm secret. The browser never writes.",
  "Messages are public to the whole swarm. There are no private side channels.",
  "Every session leaves a retro before it ends.",
];

export const MODE_COPY = {
  score: {
    name: "Score",
    gate: "The measure command prints a number. A candidate ships only if it beats the baseline by the margin, in the configured direction.",
  },
  checks: {
    name: "Checks",
    gate: "Every named check command must exit 0. There is no number and no baseline run.",
  },
  review: {
    name: "Review",
    gate: "No automated referee. The independent reviewer's verdict against the issue's acceptance criteria is the gate.",
  },
} as const;

/**
 * One issue through the swarm, agent by agent. The seven vanilla stations
 * (filed → merged) are all here, in order; `swarm: true` marks the steps the
 * swarm adds around them.
 */
export const SHIP_STEPS: { title: string; role: string; body: string; command: string; swarm?: boolean }[] = [
  { title: "Filed", role: "planner", body: "The planner (as strategist) turns the goal into small issues, each with a target and a concept.", command: "swarm plan plan.json" },
  { title: "Claimed", role: "worker", body: "One worker reserves exactly one issue through the reservation ref.", command: "node .rallypoint/scripts/claim.mjs" },
  { title: "Refereed", role: "worker", body: "Before opening anything, the worker measures the change against the integration branch: a score, checks, or review alone.", command: "swarm referee", swarm: true },
  { title: "Buried", role: "worker", body: "If the referee says it lost, no pull request opens: the idea is buried with its numbers and its lesson.", command: "swarm bury", swarm: true },
  { title: "PR opened", role: "worker", body: "A winning change becomes one pull request that closes its issue, with the referee's result in the body.", command: "Closes #n" },
  { title: "Changes requested", role: "reviewer", body: "Another session reviews it at its head SHA, against the issue and the referee result.", command: "review.mjs record --verdict request-changes" },
  { title: "Fixed", role: "fixer", body: "A fixer pushes the requested change and re-runs the referee; the head moves, so it goes back for review.", command: "swarm referee" },
  { title: "Approved", role: "reviewer", body: "An independent approve, never from the session that wrote the code.", command: "review.mjs record --verdict approve" },
  { title: "Merged", role: "merger", body: "The merger lands it and records the shipped version and its score.", command: "swarm ship --version v…" },
  { title: "Retro", role: "every session", body: "Every session ends with a retro: what helped, what slowed it, one suggestion.", command: "swarm retro", swarm: true },
  { title: "Improved", role: "improver", body: "When retros pile up, the improver makes one measured change to the tunable skills; the judges stay frozen.", command: "swarm protocol change", swarm: true },
];

/** Always on duty around the loop. */
export const ON_DUTY: { role: string; body: string }[] = [
  { role: "orchestrator", body: "The conductor: surveys the board each tick and dispatches one session per role and target." },
  { role: "janitor", body: "Clears stale claims, orphaned leases and abandoned sessions so the board tells the truth." },
  { role: "tester", body: "Available as in vanilla, for verification passes a project wants on top of the referee." },
];

/** Copyable prompts for starting sessions, as on the protocol page. */
export const START_PROMPTS: { title: string; when: string; prompt: string }[] = [
  {
    title: "Run one swarm agent",
    when: "The default. The session picks its own role from the state of the repository.",
    prompt:
      "Run a swarm agent. Follow SWARM.md: `npx rallypoint swarm prepare`, take your role with `npx rallypoint swarm next`, do that one role, log progress with `npx rallypoint swarm log`, and leave a retro with `npx rallypoint swarm retro` before you end.",
  },
  {
    title: "Work one target",
    when: "Point a worker at one part of the goal.",
    prompt:
      "Run a swarm agent on one target. Follow SWARM.md, but take your role with `npx rallypoint swarm next <target>`. Read the target's playbook first, log progress, submit through the referee, and leave a retro.",
  },
  {
    title: "Clear the review queue",
    when: "Pull requests are piling up. Finishing work beats starting it.",
    prompt:
      "Repeat `npx rallypoint swarm next --only merger,reviewer` and do each role it gives you, one at a time. Never review or merge work this session wrote. Stop when it prints ROLE none. Leave one retro at the end.",
  },
  {
    title: "Plan the next issues",
    when: "The backlog is empty, or the strategy needs a fresh look.",
    prompt:
      "Run the swarm strategist: read `npx rallypoint swarm brief`, the playbooks and the concepts, then open the next issues with `npx rallypoint swarm plan plan.json`. Prefer porting a concept that already gained on one target to targets that have not tried it.",
  },
];
