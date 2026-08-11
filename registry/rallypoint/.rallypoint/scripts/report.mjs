#!/usr/bin/env node

// Reports true coordination state: reservation refs, `status:*` labels,
// assignees, and open pull requests, plus the disagreements between them. The
// decision logic and its contract live in `lib/report.mjs`; this file supplies
// argv, the parsed config, a real `gh`, and a real `review.mjs check` runner.
//
// Strictly read-only. This script never mutates a label, an assignee, or a
// ref — see `lib/report.mjs` for why that guarantee is the entire point.

import process from "node:process";

import { checkPullRequest, gh, loadConfig } from "./lib/gh.mjs";
import { git } from "./lib/git.mjs";
import { report } from "./lib/report.mjs";

// `git` is read-only here too, and it is what lets the report distinguish a
// claim with a live unpushed session behind it from an abandoned one.
// It sees only this machine's worktrees; the report says so where it matters.
process.exit(
  report({
    argv: process.argv.slice(2),
    config: loadConfig(),
    gh,
    git,
    checkPullRequest,
  }),
);
