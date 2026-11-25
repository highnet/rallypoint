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

export const SHIP_STEPS: { title: string; body: string }[] = [
  { title: "Plan", body: "A planner turns the goal into GitHub issues, each with a target and a concept." },
  { title: "Claim", body: "A worker claims exactly one issue through Rallypoint's reservation ref." },
  { title: "Measure", body: "The worker opens a pull request and runs the referee against the integration branch." },
  { title: "Review", body: "Another agent reviews the pull request at its head SHA." },
  { title: "Ship or bury", body: "A merger merges approved work and records the version; a losing idea is buried with its numbers." },
  { title: "Learn", body: "Every session leaves a retro; the improver turns them into one measured protocol change at a time." },
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
