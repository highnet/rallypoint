/**
 * Ready-to-paste prompts for vanilla Rallypoint. Each is self-contained: the
 * session reads the protocol and its role file, so the prompt only names the
 * job. Paths and scripts are the installed loop's own.
 */
import type { AgentSlug } from "@/lib/agents";

export type LoopPrompt = { id: string; title: string; when: string; role: AgentSlug; prompt: string };

export const loopPrompts: LoopPrompt[] = [
  {
    id: "orchestrate",
    title: "Run the orchestrator",
    when: "Not sure what should happen next, or you want a fleet started.",
    role: "orchestrator",
    prompt:
      "Act as the Rallypoint orchestrator. Read AGENTS.md and .rallypoint/roles/orchestrator.md, run `node .rallypoint/scripts/report.mjs`, and dispatch one separate session per role that has work waiting, finishing work first: mergers, fixers, reviewers, then workers sized to the claimable pool. Lease each pull request before you dispatch it. Do no role yourself.",
  },
  {
    id: "work",
    title: "Ship the next issue",
    when: "The backlog has claimable work.",
    role: "worker",
    prompt:
      "Act as a Rallypoint worker. Read AGENTS.md and .rallypoint/roles/worker.md, claim the highest-priority claimable issue with `node .rallypoint/scripts/claim.mjs --agent-id <your id>`, deliver it on the branch it prescribes, run preflight, and open one ready-for-review pull request that closes the issue.",
  },
  {
    id: "review",
    title: "Review open pull requests",
    when: "Pull requests are waiting for a verdict.",
    role: "reviewer",
    prompt:
      "Act as a Rallypoint reviewer. Read AGENTS.md and .rallypoint/roles/reviewer.md, take the oldest pull request without a verdict that this session did not write, judge it against its issue at its head SHA, and record the verdict only with `node .rallypoint/scripts/review.mjs record`.",
  },
  {
    id: "fix",
    title: "Fix requested changes",
    when: "A review asked for changes.",
    role: "fixer",
    prompt:
      "Act as a Rallypoint fixer. Read AGENTS.md and .rallypoint/roles/fixer.md, take the oldest pull request labelled status:changes-requested, fix exactly what the review asked on the same branch, push, and send it back for review.",
  },
  {
    id: "merge",
    title: "Merge what is approved",
    when: "Pull requests carry an independent approve.",
    role: "merger",
    prompt:
      "Act as the Rallypoint merger. Read AGENTS.md and .rallypoint/roles/merger.md, and merge each pull request labelled review:approved whose head has not moved since the verdict and whose checks are green. Never merge work this session wrote.",
  },
  {
    id: "plan",
    title: "Plan from the roadmap",
    when: "Nothing claimable is open, or the roadmap moved.",
    role: "planner",
    prompt:
      "Act as the Rallypoint planner. Read AGENTS.md, .rallypoint/roles/planner.md, the product and roadmap docs and the open issues, then file small issues with acceptance criteria, one prio label each, and a Blocked-By line where one depends on another. Do not claim or build anything.",
  },
  {
    id: "tidy",
    title: "Tidy coordination state",
    when: "Claims, leases or labels look stuck.",
    role: "janitor",
    prompt:
      "Act as the Rallypoint janitor. Read .rallypoint/roles/janitor.md, run `node .rallypoint/scripts/report.mjs`, and repair only what the report proves is stale: old claims, orphaned leases, labels that disagree. Change nothing else.",
  },
  {
    id: "improve",
    title: "Improve the loop",
    when: "Delivery metrics stall, or the same friction keeps coming up.",
    role: "improver",
    prompt:
      "Act as the Rallypoint improver. Read .rallypoint/roles/improver.md, start from `node .rallypoint/scripts/improvement.mjs status`, and propose at most one change to one tunable role prompt as a pull request for independent review. Never touch the scripts, the config or the judges' prompts.",
  },
  {
    id: "loop",
    title: "Leave it running",
    when: "You want the fleet to keep going without you.",
    role: "orchestrator",
    prompt:
      "/loop Act as the Rallypoint orchestrator every tick: run `node .rallypoint/scripts/report.mjs`, dispatch one separate session per role with work waiting (finishing work first, at most 4 at once), and escalate anything labelled needs:human to me instead of working around it.",
  },
];
