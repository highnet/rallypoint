#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const config = JSON.parse(
  readFileSync(new URL("../config.json", import.meta.url), "utf8"),
);

const args = process.argv.slice(2);
const values = (flag) =>
  args.flatMap((value, index) =>
    value === flag && args[index + 1] ? [args[index + 1]] : [],
  );
const value = (flag) => values(flag).at(0);
const run = (...command) =>
  execFileSync(command[0], command.slice(1), {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();

const agentId = value("--agent-id");
const requestedIssue = value("--issue");
const plans = values("--plan").slice(0, 3);

if (!agentId) {
  console.error("Missing required --agent-id <unique-session-id>.");
  process.exit(1);
}

const repository = JSON.parse(
  run("gh", "repo", "view", "--json", "nameWithOwner,defaultBranchRef"),
);
const baseBranch = config.integrationBranch || repository.defaultBranchRef.name;
const base = JSON.parse(
  run("gh", "api", `repos/${repository.nameWithOwner}/git/ref/heads/${baseBranch}`),
);
const issues = JSON.parse(
  run(
    "gh",
    "issue",
    "list",
    "--state",
    "open",
    "--label",
    config.labels.task,
    "--label",
    config.labels.ready,
    "--limit",
    "100",
    "--json",
    "number,title,labels,assignees",
  ),
);

const priority = (issue) => {
  const names = issue.labels.map((label) => label.name);
  if (names.includes("prio:p0")) return 0;
  if (names.includes("prio:p1")) return 1;
  return 2;
};

const candidates = issues
  .filter((issue) => issue.assignees.length === 0)
  .filter((issue) => !requestedIssue || String(issue.number) === requestedIssue)
  .sort((left, right) => priority(left) - priority(right) || left.number - right.number);

for (const issue of candidates) {
  const ref = `refs/heads/${config.claimRefPrefix}${issue.number}`;
  try {
    run(
      "gh",
      "api",
      "--method",
      "POST",
      `repos/${repository.nameWithOwner}/git/refs`,
      "-f",
      `ref=${ref}`,
      "-f",
      `sha=${base.object.sha}`,
    );
  } catch {
    continue;
  }

  try {
    run(
      "gh",
      "issue",
      "edit",
      String(issue.number),
      "--add-assignee",
      "@me",
      "--remove-label",
      config.labels.ready,
      "--add-label",
      config.labels.claimed,
    );
    const body = [
      `Claimed by Rallypoint agent \`${agentId}\`.`,
      "",
      ...plans.map((plan) => `- ${plan}`),
    ].join("\n");
    run("gh", "issue", "comment", String(issue.number), "--body", body);
  } catch (error) {
    try {
      run(
        "gh",
        "api",
        "--method",
        "DELETE",
        `repos/${repository.nameWithOwner}/git/${ref}`,
      );
    } catch {
      console.error(`Claim failed and reservation ${ref} requires manual cleanup.`);
    }
    throw error;
  }

  const slug = issue.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 42);
  console.log(`CLAIMED_ISSUE=${issue.number}`);
  console.log(`CLAIMED_URL=https://github.com/${repository.nameWithOwner}/issues/${issue.number}`);
  console.log(`CLAIM_BRANCH=${config.branchPrefix}${issue.number}-${slug}`);
  process.exit(0);
}

console.error("No unreserved status:ready issue is available.");
process.exit(2);
