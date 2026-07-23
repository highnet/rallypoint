#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const config = JSON.parse(
  readFileSync(new URL("../config.json", import.meta.url), "utf8"),
);
const issue = process.argv[process.argv.indexOf("--issue") + 1];
const run = (...command) =>
  execFileSync(command[0], command.slice(1), {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();

if (!issue) {
  console.error("Usage: cleanup.mjs --issue <closed-issue-number>");
  process.exit(1);
}

const repository = JSON.parse(run("gh", "repo", "view", "--json", "nameWithOwner"));
const state = JSON.parse(
  run("gh", "issue", "view", issue, "--json", "state"),
).state;

if (state !== "CLOSED") {
  console.error(`Issue #${issue} is ${state.toLowerCase()}; reservation preserved.`);
  process.exit(2);
}

run(
  "gh",
  "api",
  "--method",
  "DELETE",
  `repos/${repository.nameWithOwner}/git/refs/heads/${config.claimRefPrefix}${issue}`,
);
console.log(`Removed reservation for closed issue #${issue}.`);
