import type { AgentSlug } from "@/lib/agents";
import type { LabelKey } from "@/lib/labels";

/**
 * An illustrative run of one issue through the loop. The issue, agent ids and
 * SHAs are synthetic; every command, label, ref path and rule is the
 * protocol's own (docs/AGENT_LOOP.md, .rallypoint/roles/*.md).
 */
export type Station = {
  id: string;
  name: string;
  holder: AgentSlug;
  actor: string;
  issue: "Open" | "Closed";
  pr: "None" | "Open" | "Merged";
  issueLabels: LabelKey[];
  prLabels: LabelKey[];
  command: string;
  note: string;
  ref?: string;
};

export const runIssue = {
  number: 142,
  title: "Retry failed webhook deliveries",
  pr: 388,
  branch: "agent/142-retry-webhooks",
};

export const stations: Station[] = [
  {
    id: "filed",
    name: "Filed",
    holder: "planner",
    actor: "planner-2b80",
    issue: "Open",
    pr: "None",
    issueLabels: ["p1"],
    prLabels: [],
    command: 'gh issue create --title "Retry failed webhook deliveries" --label prio:p1',
    note: "No hold label, no assignee: the issue is claimable the moment it is filed. There is no readiness label to forget.",
  },
  {
    id: "claimed",
    name: "Claimed",
    holder: "worker",
    actor: "worker-a3f9",
    issue: "Open",
    pr: "None",
    issueLabels: ["p1", "claimed"],
    prLabels: [],
    command: "node .rallypoint/scripts/claim.mjs --agent-id worker-a3f9",
    note: "The reservation ref is created before any issue state changes. GitHub refuses a second creation of the same ref, so worker-7c21, a moment later, skips to #143 without touching #142.",
    ref: "refs/heads/rallypoint-claims/issue-142",
  },
  {
    id: "opened",
    name: "PR opened",
    holder: "worker",
    actor: "worker-a3f9",
    issue: "Open",
    pr: "Open",
    issueLabels: ["p1", "claimed"],
    prLabels: [],
    command: 'node .rallypoint/scripts/preflight.mjs --body "Closes #142" --base main',
    note: "One issue, one branch, one pull request. Preflight confirms a reviewer will be able to record a verdict before #388 is opened.",
    ref: "agent/142-retry-webhooks",
  },
  {
    id: "changes",
    name: "Changes requested",
    holder: "reviewer",
    actor: "reviewer-51d0",
    issue: "Open",
    pr: "Open",
    issueLabels: ["p1", "claimed"],
    prLabels: ["changesRequested"],
    command:
      'node .rallypoint/scripts/review.mjs record --pr 388 --agent-id reviewer-51d0 --verdict request-changes --note "Cap retries at five"',
    note: "A different session judges the diff. The verdict is recorded against head 9e4c1a2 and nowhere else.",
  },
  {
    id: "fixed",
    name: "Fixed",
    holder: "fixer",
    actor: "fixer-d417",
    issue: "Open",
    pr: "Open",
    issueLabels: ["p1", "claimed"],
    prLabels: ["changesRequested"],
    command: "git push origin agent/142-retry-webhooks",
    note: "The fixer pushes to the same branch. The head moves to b71f03e, so the earlier verdict no longer binds — the work goes back for review.",
  },
  {
    id: "approved",
    name: "Approved",
    holder: "reviewer",
    actor: "reviewer-51d0",
    issue: "Open",
    pr: "Open",
    issueLabels: ["p1", "claimed"],
    prLabels: ["approved"],
    command:
      "node .rallypoint/scripts/review.mjs record --pr 388 --agent-id reviewer-51d0 --verdict approve",
    note: "Only review.mjs may apply review:approved. It refuses a verdict from the session that wrote the code, or from a subagent it dispatched.",
  },
  {
    id: "merged",
    name: "Merged",
    holder: "merger",
    actor: "merger-0e88",
    issue: "Closed",
    pr: "Merged",
    issueLabels: ["p1"],
    prLabels: ["approved"],
    command: "node .rallypoint/scripts/close-referenced-issues.mjs 4d2a9e0",
    note: "The merger reads CI itself and confirms the head has not moved since the verdict. Closes #142 closes the issue and releases the claim.",
  },
];
