#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  access,
  chmod,
  mkdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const VERSION = "0.2.0";
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const command = args[0];
const itemName = args[1];

const has = (flag) => args.includes(flag);
const value = (flag) => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
};

const colors = process.stdout.isTTY && !has("--no-color");
const paint = (code, text) => colors ? `\u001b[${code}m${text}\u001b[0m` : text;
const strong = (text) => paint("1", text);
const green = (text) => paint("32", text);
const amber = (text) => paint("33", text);
const muted = (text) => paint("2", text);

function help() {
  console.log(`
${strong("Rallypoint")} ${muted(`v${VERSION}`)}

${strong("Usage")}
  rallypoint list
  rallypoint view <item>
  rallypoint add <item> [--dry-run] [--force] [--cwd <path>]
  rallypoint init [--dry-run] [--cwd <path>]

${strong("Registry")}
  Uses the campaign registry bundled with this CLI. Set
  RALLYPOINT_REGISTRY_URL or pass --registry <url> to inspect
  and install from another Rallypoint-compatible endpoint.

${strong("Init")}
  Run after "add loop". Confirms the GitHub CLI is installed and
  authenticated, syncs .rallypoint/config.json's integration branch to the
  repository's actual default branch, creates the labels the loop depends
  on, and reports whether the default branch has protection rules.
`.trim());
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function checksum(content) {
  return createHash("sha256").update(content).digest("hex");
}

function safeDestination(cwd, target) {
  if (!target || isAbsolute(target)) {
    throw new Error(`Registry target must be relative: ${target}`);
  }
  const destination = resolve(cwd, target);
  const pathFromCwd = relative(cwd, destination);
  if (pathFromCwd.startsWith("..") || isAbsolute(pathFromCwd)) {
    throw new Error(`Registry target escapes the repository: ${target}`);
  }
  return destination;
}

async function loadItem(name) {
  const remote = value("--registry") || process.env.RALLYPOINT_REGISTRY_URL;
  if (remote) {
    const response = await fetch(`${remote.replace(/\/$/, "")}/${name}.json`);
    if (!response.ok) {
      throw new Error(`Registry returned ${response.status} for “${name}”.`);
    }
    return response.json();
  }

  const path = resolve(packageRoot, "registry", `${name}.json`);
  if (!(await exists(path))) {
    throw new Error(`Unknown campaign item “${name}”. Run “rallypoint list”.`);
  }
  return JSON.parse(await readFile(path, "utf8"));
}

function verifyItem(item) {
  if (item.schemaVersion !== 1 || !Array.isArray(item.files)) {
    throw new Error("Unsupported Rallypoint registry manifest.");
  }
  for (const file of item.files) {
    if (checksum(file.content) !== file.sha256) {
      throw new Error(`Checksum failed for ${file.path}.`);
    }
  }
}

async function listItems() {
  const remote = value("--registry") || process.env.RALLYPOINT_REGISTRY_URL;
  let index;
  if (remote) {
    const response = await fetch(`${remote.replace(/\/$/, "")}/index.json`);
    if (!response.ok) throw new Error(`Registry returned ${response.status}.`);
    index = await response.json();
  } else {
    index = JSON.parse(
      await readFile(resolve(packageRoot, "registry/index.json"), "utf8"),
    );
  }

  console.log(strong("Available campaign packs\n"));
  for (const item of index.items) {
    console.log(`${green(item.name)} ${muted(`v${item.version} · ${item.fileCount} files`)}`);
    console.log(`  ${item.description}`);
  }
}

async function viewItem(name) {
  const item = await loadItem(name);
  verifyItem(item);
  console.log(`${strong(item.name)} ${muted(`v${item.version}`)}`);
  console.log(`${item.description}\n`);
  for (const file of item.files) {
    console.log(`  ${file.executable ? "◆" : "◇"} ${file.path} ${muted(file.sha256.slice(0, 10))}`);
  }
  console.log(`\n${muted(`${item.files.length} files · no changes written`)}`);
}

async function addItem(name) {
  const item = await loadItem(name);
  verifyItem(item);

  const cwd = resolve(value("--cwd") || process.cwd());
  const dryRun = has("--dry-run");
  const force = has("--force");
  const changes = [];
  const conflicts = [];

  for (const file of item.files) {
    const destination = safeDestination(cwd, file.path);
    if (await exists(destination)) {
      const current = await readFile(destination, "utf8");
      if (current === file.content) {
        changes.push({ ...file, destination, action: "unchanged" });
      } else if (force) {
        changes.push({ ...file, destination, action: "overwrite" });
      } else {
        conflicts.push(file.path);
      }
    } else {
      changes.push({ ...file, destination, action: "create" });
    }
  }

  if (conflicts.length) {
    console.error(amber("Rallypoint stopped before writing."));
    console.error("These targets already exist with different contents:");
    for (const path of conflicts) console.error(`  • ${path}`);
    console.error(`\nInspect with ${strong("rallypoint view loop")}. Use --force only after review.`);
    process.exitCode = 2;
    return;
  }

  console.log(`${strong(dryRun ? "Dry run" : "Installing")} ${green(item.name)} ${muted(`v${item.version}`)}\n`);
  for (const file of changes) {
    const marker = file.action === "unchanged" ? muted("same") : file.action === "overwrite" ? amber("write") : green("add ");
    console.log(`  ${marker}  ${file.path}`);
    if (!dryRun && file.action !== "unchanged") {
      await mkdir(dirname(file.destination), { recursive: true });
      await writeFile(file.destination, file.content, "utf8");
      if (file.executable) await chmod(file.destination, 0o755);
    }
  }

  const written = changes.filter((file) => file.action !== "unchanged").length;
  console.log(
    dryRun
      ? `\n${muted(`${written} writes planned · no changes written`)}`
      : `\n${green("Campaign ready.")} ${written} files written, ${changes.length - written} already current.`,
  );
}

function requiredLabels(labels) {
  return [
    { name: labels.task, color: "1d76db", description: "Actionable work" },
    { name: labels.ready, color: "0e8a16", description: "Scoped and available" },
    { name: labels.claimed, color: "fbca04", description: "Reserved by one worker" },
    { name: labels.blocked, color: "d93f0b", description: "Cannot proceed" },
    { name: labels.human, color: "5319e7", description: "Requires an owner decision or protected action" },
    { name: labels.approved, color: "0e8a16", description: "Reviewer verdict on a pull request" },
    { name: "prio:p0", color: "b60205", description: "Priority: highest" },
    { name: "prio:p1", color: "d93f0b", description: "Priority: high" },
    { name: "prio:p2", color: "fbca04", description: "Priority: normal" },
  ];
}

function gh(...command) {
  return execFileSync("gh", command, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

async function initRepo() {
  const cwd = resolve(value("--cwd") || process.cwd());
  const dryRun = has("--dry-run");
  const configPath = resolve(cwd, ".rallypoint/config.json");

  if (!(await exists(configPath))) {
    throw new Error(`No .rallypoint/config.json in ${cwd}. Run “rallypoint add loop” first.`);
  }
  const config = JSON.parse(await readFile(configPath, "utf8"));

  console.log(`${strong(dryRun ? "Init (dry run)" : "Init")}\n`);

  try {
    gh("--version");
  } catch {
    throw new Error(`GitHub CLI (“gh”) was not found. Install it from https://cli.github.com and retry.`);
  }

  let login;
  try {
    login = gh("api", "user", "--jq", ".login");
  } catch {
    throw new Error(`“gh” is not authenticated. Run “gh auth login” and retry.`);
  }
  console.log(`  ${green("ok")}    authenticated as ${login}`);

  let repository;
  try {
    repository = JSON.parse(gh("repo", "view", "--json", "nameWithOwner,defaultBranchRef"));
  } catch {
    throw new Error(`“gh” could not resolve a GitHub repository for ${cwd}. Run inside a clone of the target repository.`);
  }
  console.log(`  ${green("ok")}    repository ${repository.nameWithOwner}`);

  const defaultBranch = repository.defaultBranchRef.name;
  if (config.integrationBranch !== defaultBranch) {
    console.log(`  ${amber("sync")}  integrationBranch ${config.integrationBranch} -> ${defaultBranch}`);
    config.integrationBranch = defaultBranch;
    if (!dryRun) {
      await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
    }
  } else {
    console.log(`  ${green("ok")}    integrationBranch already ${defaultBranch}`);
  }

  let existingLabels;
  try {
    existingLabels = new Set(
      JSON.parse(gh("label", "list", "--json", "name", "--limit", "200")).map((label) => label.name),
    );
  } catch (error) {
    throw new Error(`Could not list labels for ${repository.nameWithOwner}: ${error.message}`);
  }

  const failures = [];
  for (const label of requiredLabels(config.labels)) {
    if (existingLabels.has(label.name)) {
      console.log(`  ${muted("same")}  label ${label.name}`);
      continue;
    }
    if (dryRun) {
      console.log(`  ${green("add ")}  label ${label.name}`);
      continue;
    }
    try {
      gh("label", "create", label.name, "--color", label.color, "--description", label.description);
      console.log(`  ${green("add ")}  label ${label.name}`);
    } catch (error) {
      failures.push(label.name);
      console.log(`  ${amber("fail")}  label ${label.name}: ${error.message.split("\n")[0]}`);
    }
  }

  let protection = "unknown";
  try {
    gh("api", `repos/${repository.nameWithOwner}/branches/${defaultBranch}/protection`);
    protection = "protected";
  } catch (error) {
    protection = /404/.test(error.message) ? "unprotected" : "unknown";
  }
  if (protection === "protected") {
    console.log(`  ${green("ok")}    ${defaultBranch} has branch protection`);
  } else if (protection === "unprotected") {
    console.log(`  ${amber("warn")}  ${defaultBranch} has no branch protection rules`);
  } else {
    console.log(`  ${muted("skip")}  could not read branch protection for ${defaultBranch} (needs admin scope)`);
  }

  if (failures.length) {
    console.log(
      `\n${amber(`Init finished with ${failures.length} label failure(s).`)} Create them manually or re-run “rallypoint init”.`,
    );
    process.exitCode = 1;
    return;
  }

  console.log(`\n${dryRun ? muted("Dry run complete · no changes written") : green("Rallypoint is ready.")}`);
}

try {
  if (has("--version") || has("-v")) {
    console.log(VERSION);
  } else if (command === "list") {
    await listItems();
  } else if (command === "view" && itemName) {
    await viewItem(itemName);
  } else if (command === "add" && itemName) {
    await addItem(itemName);
  } else if (command === "init") {
    await initRepo();
  } else {
    help();
    if (command && !has("--help") && !has("-h")) process.exitCode = 1;
  }
} catch (error) {
  console.error(`${amber("Rallypoint error:")} ${error.message}`);
  process.exitCode = 1;
}
