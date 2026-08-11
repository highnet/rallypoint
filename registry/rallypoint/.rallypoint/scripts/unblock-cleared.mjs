#!/usr/bin/env node

// Clears `status:blocked` off an issue whose `Blocked-By:` trailer has cleared.
// The trailer grammar, the all-or-nothing rule, and the `needs:human` veto live
// in `lib/blocked-by.mjs`; this file supplies argv, the config, and a real `gh`.

import { readFileSync } from "node:fs";
import process from "node:process";

import { unblockCleared } from "./lib/blocked-by.mjs";
import { gh } from "./lib/gh.mjs";

const config = JSON.parse(
  readFileSync(new URL("../config.json", import.meta.url), "utf8"),
);

process.exit(unblockCleared({ argv: process.argv.slice(2), gh, config }));
