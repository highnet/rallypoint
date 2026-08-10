#!/usr/bin/env node

// Attaches a retroactive claim comment to an issue whose open pull request
// otherwise has no way to be reviewed. The refusal rules -- an existing claim
// comment, and zero or several referencing pull requests -- live in
// `lib/reconcile.mjs`; this file supplies argv, the parsed config, and a real
// `gh`.

import process from "node:process";

import { gh, loadConfig } from "./lib/gh.mjs";
import { reconcile } from "./lib/reconcile.mjs";

process.exit(
  reconcile({ argv: process.argv.slice(2), config: loadConfig(), gh }),
);
