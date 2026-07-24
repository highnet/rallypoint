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
  if (!view.includes("12 files · no changes written")) {
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
  if (!(await readFile(resolve(fixture, "AGENTIC_LOOP.md"), "utf8")).includes("Rallypoint Agent Protocol")) {
    throw new Error("AGENTIC_LOOP.md was not installed");
  }

  const config = JSON.parse(
    await readFile(resolve(fixture, ".rallypoint/config.json"), "utf8"),
  );
  if (config.claimRefPrefix !== "rallypoint-claims/issue-") {
    throw new Error("installed config is invalid");
  }

  const repeat = run(["add", "loop"]);
  if (!repeat.includes("12 already current")) {
    throw new Error("repeat install was not idempotent");
  }

  const originalConfig = await readFile(
    resolve(root, "registry/rallypoint/.rallypoint/config.json"),
    "utf8",
  );
  await writeFile(resolve(fixture, ".rallypoint/config.json"), "{}\n");
  const hardConflict = run(["add", "loop"], 2);
  if (!hardConflict.includes("stopped before writing")) {
    throw new Error("a non-AGENTS.md conflict did not stop the installer");
  }
  await writeFile(resolve(fixture, ".rallypoint/config.json"), originalConfig);

  await writeFile(resolve(fixture, "AGENTS.md"), "user-owned instructions\n");
  const agentsConflict = run(["add", "loop"]);
  if (!agentsConflict.includes("AGENTS.md already exists and was left unchanged")) {
    throw new Error("AGENTS.md conflict did not surface the @AGENTIC_LOOP.md suggestion");
  }
  if (!agentsConflict.includes("Campaign ready.")) {
    throw new Error("an AGENTS.md conflict incorrectly blocked the rest of the install");
  }
  if ((await readFile(resolve(fixture, "AGENTS.md"), "utf8")) !== "user-owned instructions\n") {
    throw new Error("AGENTS.md was overwritten despite the conflict");
  }

  const initFixture = await mkdtemp(resolve(tmpdir(), "rallypoint-cli-init-"));
  try {
    const initBeforeAdd = spawnSync(process.execPath, [cli, "init"], {
      cwd: initFixture,
      encoding: "utf8",
    });
    if (initBeforeAdd.status !== 1 || !initBeforeAdd.stderr.includes("add loop")) {
      throw new Error("init did not require add loop to run first");
    }

    spawnSync(process.execPath, [cli, "add", "loop"], { cwd: initFixture });
    const initNoGh = spawnSync(process.execPath, [cli, "init"], {
      cwd: initFixture,
      encoding: "utf8",
      env: { ...process.env, PATH: "" },
    });
    if (initNoGh.status !== 1 || !initNoGh.stderr.includes("GitHub CLI")) {
      throw new Error("init did not report a missing GitHub CLI");
    }
  } finally {
    await rm(initFixture, { recursive: true, force: true });
  }

  console.log(
    "CLI smoke test passed: inspect, dry-run, install, repeat, hard conflict, AGENTS.md soft conflict, init preconditions.",
  );
} finally {
  await rm(fixture, { recursive: true, force: true });
}
