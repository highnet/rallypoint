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
import { noteSwarmWork } from "./lib/swarm-session.mjs";

const argv = process.argv.slice(2);
const code = lease({ argv, config: loadConfig(), gh });

// A lease acquired from a checkout with a Rallypoint Swarm session open is
// that session's job: record the role and pull request on it. Best-effort,
// and never on a release or a sweep. A conductor leasing on a dispatched
// session's behalf has no session open in its own checkout, so it records
// nothing.
if (code === 0 && !argv.includes("--release") && !argv.includes("--sweep")) {
  const valueOf = (name) => {
    const index = argv.indexOf(name);
    return index < 0 ? null : (argv[index + 1] ?? null);
  };
  noteSwarmWork({ work: { role: valueOf("--role"), pr: valueOf("--pr") } });
}

process.exit(code);
