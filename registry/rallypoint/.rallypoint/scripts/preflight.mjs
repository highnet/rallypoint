#!/usr/bin/env node

// Reports whether the current branch and a prepared pull request body would
// let `review.mjs record` resolve an authoring session. The decision lives in
// `lib/preflight.mjs`; this file supplies argv, the parsed config, and real
// `git`/`gh`. Strictly read-only: it renames no branch, edits no body, and
// opens nothing.

import process from "node:process";

import { preflight } from "./lib/preflight.mjs";
import { gh, git, loadConfig } from "./lib/gh.mjs";

process.exit(
  preflight({ argv: process.argv.slice(2), config: loadConfig(), git, gh }),
);
