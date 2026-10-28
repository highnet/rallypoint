#!/usr/bin/env node

// The loop's self-improvement commands: `retro` measures recent delivery,
// `status` says whether the improver has anything to do, `check` gates an
// improvement pull request before it merges, and `evaluate` decides whether a
// merged one is kept or reverted. The rules and their exit codes live in
// `lib/improvement.mjs`; this file supplies argv, the parsed config, and a
// real transport.
//
// Read-only except `evaluate --record`, which posts one comment carrying the
// result so the next session reads it instead of recomputing it.

import process from "node:process";

import { loadConfig, resolveTransport } from "./lib/gh.mjs";
import { improvement } from "./lib/improvement.mjs";

process.exit(
  improvement({
    argv: process.argv.slice(2),
    config: loadConfig(),
    gh: resolveTransport(),
  }),
);
