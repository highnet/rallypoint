#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import {
  access,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const cli = resolve(root, "packages/cli/bin/rallypoint.mjs");
const fixture = await mkdtemp(resolve(tmpdir(), "rallypoint-cli-"));

function run(args, expectedStatus = 0) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: fixture,
    encoding: "utf8",
  });
  if (result.status !== expectedStatus) {
    throw new Error(
      `rallypoint ${args.join(" ")} exited ${result.status}\n${result.stdout}\n${result.stderr}`,
    );
  }
  return `${result.stdout}${result.stderr}`;
}

async function missing(path) {
  try {
    await access(path);
    return false;
  } catch {
    return true;
  }
}

try {
  const view = run(["view", "loop"]);
  if (!view.includes("11 files · no changes written")) {
    throw new Error("view did not report the complete manifest");
  }

  run(["add", "loop", "--dry-run"]);
  if (!(await missing(resolve(fixture, "AGENTS.md")))) {
    throw new Error("dry-run wrote files");
  }

  const install = run(["add", "loop"]);
  if (!install.includes("Campaign ready.")) {
    throw new Error("install did not finish");
  }

  const config = JSON.parse(
    await readFile(resolve(fixture, ".rallypoint/config.json"), "utf8"),
  );
  if (config.claimRefPrefix !== "rallypoint-claims/issue-") {
    throw new Error("installed config is invalid");
  }

  const repeat = run(["add", "loop"]);
  if (!repeat.includes("11 already current")) {
    throw new Error("repeat install was not idempotent");
  }

  await writeFile(resolve(fixture, "AGENTS.md"), "user-owned instructions\n");
  const conflict = run(["add", "loop"], 2);
  if (!conflict.includes("stopped before writing")) {
    throw new Error("conflict did not stop the installer");
  }

  console.log("CLI smoke test passed: inspect, dry-run, install, repeat, conflict.");
} finally {
  await rm(fixture, { recursive: true, force: true });
}
