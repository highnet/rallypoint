#!/usr/bin/env node

// Releases a stale claim on an open issue: reservation ref first, then the
// labels and the assignee. The ordering rule, the eligibility check, and the
// refusal to touch the issue when the reservation cannot be removed live in
// `lib/release-claim.mjs`; this file supplies argv, the parsed config, and a
// real `gh`.
//
// `cleanup.mjs` remains the command for a *closed* issue's reservation, and its
// refusal to release one for an open issue is unchanged.

import process from "node:process";

import { gh, loadConfig } from "./lib/gh.mjs";
import { git } from "./lib/git.mjs";
import { releaseClaim } from "./lib/release-claim.mjs";

// `git` is what makes the local-work guard bind: unpushed commits in a sibling
// worktree are the only evidence that a session is alive before it pushes, and
// nothing reachable through `gh` can see them. It is injected rather than
// imported by the library for the reason `lib/git.mjs` gives — no test should
// be able to reach the real repository by importing a pure module.
process.exit(
  releaseClaim({ argv: process.argv.slice(2), config: loadConfig(), gh, git }),
);
