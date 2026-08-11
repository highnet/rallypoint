#!/usr/bin/env node

// Reports whether this checkout carries the coordination protocol the
// integration branch currently defines. The decision lives in
// `lib/freshness.mjs`; this file supplies argv, the parsed config, and real
// `git`. Strictly read-only apart from the `git fetch` that refreshes the
// remote-tracking ref it compares against: it moves no branch and writes
// nothing.

import process from "node:process";

import { freshness } from "./lib/freshness.mjs";
import { loadConfig } from "./lib/gh.mjs";
import { git as realGit } from "./lib/git.mjs";

/** @param {string[]} args */
const git = (...args) => realGit(args);

process.exit(
  freshness({ argv: process.argv.slice(2), config: loadConfig(), git }),
);
