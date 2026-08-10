#!/usr/bin/env node

// Deletes a merged issue branch from origin through the GitHub API, and then —
// non-fatally — from this checkout. The decision logic, and the measurements
// behind it, live in `lib/delete-merged-branch.mjs`; this file supplies argv,
// the parsed config, and the two transports.

import process from "node:process";

import { deleteMergedBranch } from "./lib/delete-merged-branch.mjs";
import { loadConfig, resolveTransport } from "./lib/gh.mjs";
import { git } from "./lib/git.mjs";

process.exit(
  deleteMergedBranch({
    argv: process.argv.slice(2),
    config: loadConfig(),
    gh: resolveTransport(),
    git,
  }),
);
