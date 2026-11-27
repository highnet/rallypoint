#!/usr/bin/env node

// `gh`, through whichever transport reaches GitHub here.
//
//   node .rallypoint/scripts/gh.mjs pr view 12 --json mergeable,mergeStateStatus,statusCheckRollup
//   node .rallypoint/scripts/gh.mjs pr merge 12 --merge
//   node .rallypoint/scripts/gh.mjs --which
//
// Role prompts run `gh` commands of their own — the merger's `pr view` and
// `pr merge` — and in a Claude Code cloud session the `gh` binary cannot run
// them: GitHub GraphQL is blocked there, and `gh pr …` is built on it. This
// runs the same arguments through `resolveTransport()`, so it is the `gh`
// binary wherever that works, and the REST transport in `lib/api.mjs`
// wherever it does not. A command the REST transport has not been taught
// fails by name rather than being approximated.
//
// `--which` prints the transport this would use, and why.

import process from "node:process";

import { resolveTransport } from "./lib/gh.mjs";

const args = process.argv.slice(2);
const transport = resolveTransport();

if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
  console.log(
    "usage: node .rallypoint/scripts/gh.mjs <gh arguments>\n" +
      "       node .rallypoint/scripts/gh.mjs --which",
  );
  process.exit(args.length === 0 ? 2 : 0);
}

if (args[0] === "--which") {
  const { kind, reason } = transport.describe();
  console.log(`${kind} (${reason})`);
  process.exit(0);
}

try {
  const output = transport(...args);
  if (output) console.log(output);
} catch (error) {
  const detail = /** @type {{ stderr?: unknown, message?: unknown }} */ (error ?? {});
  const said = String(detail.stderr ?? "").trim();
  console.error(said || String(detail.message ?? error));
  process.exit(1);
}
