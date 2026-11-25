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

// Read from the manifest rather than restating it. A hardcoded count asserts
// that `view` agrees with a number in this file, which is not the property
// worth testing and goes stale every time the item gains a file.
const manifest = JSON.parse(
  await readFile(resolve(root, "registry/manifest.json"), "utf8"),
);
const loopFileCount = manifest.items.find((item) => item.name === "loop").files
  .length;

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
  if (!view.includes(`${loopFileCount} files · no changes written`)) {
    throw new Error(
      `view did not report the complete manifest (expected ${loopFileCount} files)`,
    );
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
  if (!repeat.includes(`${loopFileCount} already current`)) {
    throw new Error(
      `repeat install was not idempotent (expected ${loopFileCount} already current)`,
    );
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

    // init against a fake GitHub (RALLYPOINT_GH_SCRIPT): the labels it
    // creates come from config.labels, and an empty repository keeps the
    // configured integration branch instead of writing "".
    const ghLog = resolve(initFixture, ".gh-log.jsonl");
    const fakeGh = resolve(initFixture, "..", `fake-gh-init-${process.pid}.mjs`);
    await writeFile(fakeGh, `
import { appendFileSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(${JSON.stringify(ghLog)}, JSON.stringify(args) + "\\n");
const key = args.slice(0, 2).join(" ");
const empty = process.env.FAKE_GH_EMPTY === "1";
if (args[0] === "--version") console.log("gh version 2.0.0");
else if (key === "api user") console.log("octo");
else if (key === "repo view") console.log(JSON.stringify({ nameWithOwner: "acme/app", defaultBranchRef: empty ? null : { name: "trunk" } }));
else if (key === "label list") console.log(JSON.stringify([{ name: "status:claimed" }]));
else if (key === "label create") console.log("");
else if (args[0] === "api" && args[1].endsWith("/protection")) { console.error("HTTP 404: Branch not protected"); process.exit(1); }
else { console.error("fake gh: unhandled " + args.join(" ")); process.exit(1); }
`);
    const initWithFakeGh = (extraEnv) =>
      spawnSync(process.execPath, [cli, "init"], {
        cwd: initFixture,
        encoding: "utf8",
        env: { ...process.env, RALLYPOINT_GH_SCRIPT: fakeGh, ...extraEnv },
      });
    const readConfig = async () => JSON.parse(await readFile(resolve(initFixture, ".rallypoint/config.json"), "utf8"));
    try {
      const empty = initWithFakeGh({ FAKE_GH_EMPTY: "1" });
      const emptyOut = `${empty.stdout}${empty.stderr}`;
      if (empty.status !== 0) throw new Error(`init on an empty repository failed\n${emptyOut}`);
      if (/undefined/.test(emptyOut)) throw new Error(`init tried to create an undefined label\n${emptyOut}`);
      if ((await readConfig()).integrationBranch !== "main") {
        throw new Error(`init on an empty repository did not keep integrationBranch "main"\n${emptyOut}`);
      }
      if (!/no commits yet/.test(emptyOut) || !/does not exist on GitHub yet/.test(emptyOut)) {
        throw new Error(`init did not explain the empty repository\n${emptyOut}`);
      }
      const created = (await readFile(ghLog, "utf8")).trim().split("\n").map((line) => JSON.parse(line))
        .filter((args) => args[0] === "label" && args[1] === "create").map((args) => args[2]);
      for (const name of ["status:deferred", "status:changes-requested", "merged:unreviewed", "prio:p3"]) {
        if (!created.includes(name)) throw new Error(`init did not create label ${name}: ${created.join(", ")}`);
      }
      if (created.includes("status:claimed")) throw new Error("init recreated a label that already existed");
      if (created.some((name) => !name || name === "undefined")) throw new Error(`init created a nameless label: ${created.join(", ")}`);

      const synced = initWithFakeGh({});
      if (synced.status !== 0 || (await readConfig()).integrationBranch !== "trunk") {
        throw new Error(`init did not sync integrationBranch to the default branch\n${synced.stdout}${synced.stderr}`);
      }
    } finally {
      await rm(fakeGh, { force: true });
    }
  } finally {
    await rm(initFixture, { recursive: true, force: true });
  }

  console.log(
    "CLI smoke test passed: inspect, dry-run, install, repeat, hard conflict, AGENTS.md soft conflict, init preconditions, init labels and empty repositories.",
  );
} finally {
  await rm(fixture, { recursive: true, force: true });
}
