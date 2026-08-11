#!/usr/bin/env node

// Clears stale `status:*` labels off a closed issue. The refusal to touch an
// open issue, and the label-selection logic, live in `lib/clear-status-labels.mjs`;
// this file supplies argv and a real `gh`.

import process from "node:process";

import { clearStatusLabels } from "./lib/clear-status-labels.mjs";
import { gh } from "./lib/gh.mjs";

process.exit(
  clearStatusLabels({ argv: process.argv.slice(2), gh }),
);
