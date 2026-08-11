#!/usr/bin/env node

// Acquires, releases, and sweeps session leases: the record of what an
// orchestrator has already dispatched, so a second survey over an unchanged
// board does not recommend the same session twice.
//
// Every rule — the ref shapes, the head binding, the TTL, and the refusal to
// read a failed lookup as a free target — lives in `lib/lease.mjs`; this file
// supplies argv, the parsed config, and a real `gh`.

import process from "node:process";

import { gh, loadConfig } from "./lib/gh.mjs";
import { lease } from "./lib/lease.mjs";

process.exit(lease({ argv: process.argv.slice(2), config: loadConfig(), gh }));
