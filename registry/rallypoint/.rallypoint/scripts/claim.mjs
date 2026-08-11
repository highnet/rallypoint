#!/usr/bin/env node

// Reserves one ready issue for this session. The decision and the contract it
// keeps live in `lib/claim.mjs`; this file supplies argv, the parsed config, and
// a transport.
//
// The claim is also where the checkout itself is checked. A worker's
// first command is the last moment before it starts writing code against a role
// prompt and a `.rallypoint/scripts/` directory that may already have been
// superseded, and a reservation made from a stale checkout is worse than one
// never made: the issue is then held by a session executing retired protocol.
// `--allow-stale` exists for the operator who has decided the drift is
// irrelevant.

import process from "node:process";

import { beaconPush } from "./lib/beacon-push.mjs";
import { claim } from "./lib/claim.mjs";
import { EXIT_STALE_CHECKOUT, freshness } from "./lib/freshness.mjs";
import { loadConfig, resolveTransport } from "./lib/gh.mjs";
import { git as realGit } from "./lib/git.mjs";

/** @param {string[]} args */
const git = (...args) => realGit(args);

const argv = process.argv.slice(2);
const config = loadConfig();

if (freshness({ argv, config, git }) !== 0) process.exit(EXIT_STALE_CHECKOUT);

process.exit(
  claim({
    argv,
    config,
    gh: resolveTransport(),
    // The claim is also the only point in the protocol that knows the branch
    // name before the branch exists, which is why the beacon push lives here
    // and not in a hook. It publishes the prescribed branch at the
    // integration branch tip so the claim is visible to observers on other
    // hosts from its first minute — the exposure the worktree guard states
    // it cannot reach. Best-effort: it reports refusals and never changes the
    // exit code above.
    afterClaim: ({ branch }) =>
      beaconPush({
        branch,
        config,
        git,
        stdout: console.log,
        stderr: console.error,
      }),
  }),
);
