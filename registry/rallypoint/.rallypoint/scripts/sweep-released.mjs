#!/usr/bin/env node

// Deletes what sessions that may not delete refs leave behind.
//
//   node .rallypoint/scripts/sweep-released.mjs [--dry-run]
//
// A Claude Code cloud session cannot delete refs, so `lib/git-data.mjs`
// releases a claim or a lease by moving it onto a `rallypoint: released`
// marker commit, which every Rallypoint read already treats as absent, and an
// agent branch's delete after its merge is refused. This removes both for
// good:
//
//  - every claim and session ref whose tip is a released marker, and
//  - every `<branchPrefix><issue>-…` branch whose tip is the head of a merged
//    pull request and which no open pull request uses. A branch with commits
//    past its merged head is kept: that is work nobody has merged.
//
// It must run where ref deletes are allowed — locally with `gh`, or in
// Actions (`.github/workflows/rallypoint-sweep.yml` runs it daily). Where it
// would have to emulate deletes it refuses, exit 2. Nothing here is urgent:
// released refs already read as absent.
//
// Exit codes: 0 swept (or nothing to sweep), 1 a delete failed, 2 refused.

import process from "node:process";

import { coordinationRefs, isReleasedMessage } from "./lib/git-data.mjs";
import { loadConfig, resolveTransport } from "./lib/gh.mjs";

const dryRun = process.argv.includes("--dry-run");
const config = loadConfig();
const gh = resolveTransport({ showReleased: true });

if (gh.describe().gitData === "push") {
  console.error(
    "sweep-released.mjs deletes refs, which this session may not do (its git-data writes are " +
      "emulated with `git push`). Run it locally with `gh`, or let the rallypoint-sweep workflow run it.",
  );
  process.exit(2);
}

const repository = JSON.parse(gh("repo", "view", "--json", "nameWithOwner")).nameWithOwner;
const isCoordinationRef = coordinationRefs(config);

/** @param {string} prefix the part after `refs/heads/` */
const refsUnder = (prefix) =>
  /** @type {{ ref: string, object: { sha: string } }[]} */ (
    JSON.parse(gh("api", "--paginate", `repos/${repository}/git/matching-refs/heads/${prefix.replace(/\/+$/, "")}`)).filter(
      (/** @type {{ ref: string }} */ entry) => entry.ref.startsWith(`refs/heads/${prefix}`),
    )
  );

let failed = 0;
let deleted = 0;

/** @param {string} ref a full ref name @param {string} why */
const remove = (ref, why) => {
  if (dryRun) {
    console.log(`would delete ${ref} (${why})`);
    return;
  }
  try {
    gh("api", "--method", "DELETE", `repos/${repository}/git/${ref}`);
    deleted += 1;
    console.log(`deleted ${ref} (${why})`);
  } catch (error) {
    failed += 1;
    console.error(`could not delete ${ref}: ${String(/** @type {Error} */ (error).message).split("\n")[0]}`);
  }
};

// Released claims and leases.
const roots = [config.claimRefPrefix, config.sessionRefPrefix].map((prefix) =>
  prefix.includes("/") ? prefix.slice(0, prefix.lastIndexOf("/") + 1) : prefix,
);
for (const root of new Set(roots)) {
  for (const { ref, object } of refsUnder(root)) {
    if (!isCoordinationRef(ref)) continue;
    let message = "";
    try {
      message = JSON.parse(gh("api", `repos/${repository}/git/commits/${object.sha}`)).message;
    } catch {
      continue; // unreadable: never assumed released
    }
    if (isReleasedMessage(message)) remove(ref, "released marker");
  }
}

// Merged agent branches whose delete a session could not make.
const openHeads = new Set(
  JSON.parse(gh("pr", "list", "--state", "open", "--limit", "500", "--json", "headRefName")).map(
    (/** @type {{ headRefName: string }} */ pull) => pull.headRefName,
  ),
);
const issueBranch = new RegExp(`^refs/heads/${config.branchPrefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\d+-`);

for (const { ref, object } of refsUnder(config.branchPrefix)) {
  if (!issueBranch.test(ref)) continue;
  const name = ref.slice("refs/heads/".length);
  if (openHeads.has(name)) continue;

  const pulls = JSON.parse(
    gh("pr", "list", "--head", name, "--state", "all", "--limit", "100", "--json", "state,headRefOid"),
  );
  const mergedAtTip = pulls.some(
    (/** @type {{ state: string, headRefOid: string }} */ pull) =>
      pull.state === "MERGED" && pull.headRefOid === object.sha,
  );
  if (mergedAtTip) remove(ref, "merged, no open pull request");
}

console.log(
  dryRun
    ? "Dry run: nothing was deleted."
    : `Swept ${deleted} ref(s)${failed ? `; ${failed} delete(s) failed` : ""}.`,
);
process.exit(failed ? 1 : 0);
