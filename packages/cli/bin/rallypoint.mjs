#!/usr/bin/env node

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

const VERSION = "0.1.0";
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

${strong("Registry")}
  Uses the campaign registry bundled with this CLI. Set
  RALLYPOINT_REGISTRY_URL or pass --registry <url> to inspect
  and install from another Rallypoint-compatible endpoint.
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

try {
  if (has("--version") || has("-v")) {
    console.log(VERSION);
  } else if (command === "list") {
    await listItems();
  } else if (command === "view" && itemName) {
    await viewItem(itemName);
  } else if (command === "add" && itemName) {
    await addItem(itemName);
  } else {
    help();
    if (command && !has("--help") && !has("-h")) process.exitCode = 1;
  }
} catch (error) {
  console.error(`${amber("Rallypoint error:")} ${error.message}`);
  process.exitCode = 1;
}
