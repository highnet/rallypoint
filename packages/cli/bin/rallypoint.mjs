#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  access,
  chmod,
  mkdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

const VERSION = "0.10.1"; // x-release-please-version
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
  rallypoint swarm connect [--url <url>] [--key <key>] [--generate] [--no-db]
  rallypoint swarm <command> [...]      (after "add swarm"; try "swarm help")

${strong("Registry")}
  Uses the campaign registry bundled with this CLI. Set
  RALLYPOINT_REGISTRY_URL or pass --registry <url> to inspect
  and install from another Rallypoint-compatible endpoint.

${strong("Swarm")}
  The next tier: "add swarm" after "add loop" adds shared memory in your own
  Supabase, a referee, retros and a conductor. "add swarm-ui" scaffolds the
  swarm's routes into an existing Next.js app; "add swarm-dashboard" creates
  a standalone swarm-ui/ app. Both generate a project-owned swarm.config.ts.

${strong("Connect")}
  Run after "add swarm" and applying schema.sql. Asks for the Supabase URL,
  the publishable (anon) key, the service-role key (hidden, used once, never
  saved) and the swarm secret (hidden, or generated). Sets the secret in the
  database, verifies it, and writes gitignored env files: agents read
  .rallypoint/swarm/.env.local, the dashboard reads its own .env.local.
  Real environment variables still win over the files.

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
    console.log(`${green(item.name)} ${muted(`v${item.version} · ${item.fileCount} files${item.requires ? ` · needs ${item.requires.join(", ")}` : ""}`)}`);
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
  let item = await loadItem(name);
  verifyItem(item);

  const cwd = resolve(value("--cwd") || process.cwd());
  const dryRun = has("--dry-run");
  const force = has("--force");

  for (const required of item.requires ?? []) {
    const marker = INSTALL_MARKERS[required];
    if (marker && !(await exists(resolve(cwd, marker))) && !force) {
      console.error(amber(`“${item.name}” builds on “${required}”, which is not installed here.`));
      console.error(`Run ${strong(`rallypoint add ${required}`)} first (or pass --force).`);
      process.exitCode = 2;
      return;
    }
  }
  if (item.detect?.nextApp && !force && !(await hasNextApp(cwd))) {
    console.error(amber("No Next.js app found here (no “next” dependency in package.json)."));
    console.error(`For a standalone dashboard, run ${strong("rallypoint add swarm-dashboard")} instead (or pass --force).`);
    process.exitCode = 2;
    return;
  }

  // A Next.js app that keeps its routes in src/app ignores a root app/ only
  // while it does not exist; creating one would shadow the whole site. Put
  // the swarm routes where the project's routes already are.
  if (item.detect?.nextApp && (await exists(resolve(cwd, "src/app"))) && !(await exists(resolve(cwd, "app")))) {
    const moved = (path) => (path.startsWith("app/") ? `src/${path}` : path);
    item = {
      ...item,
      files: item.files.map((file) => ({ ...file, path: moved(file.path) })),
      generate: item.generate ? { ...item.generate, out: moved(item.generate.out) } : item.generate,
    };
    console.log(muted("src/app detected: installing the swarm routes under src/app/swarm"));
  }

  const changes = [];
  const conflicts = [];
  let agentsMdSkipped = false;

  for (const file of item.files) {
    const destination = safeDestination(cwd, file.path);
    if (await exists(destination)) {
      const current = await readFile(destination, "utf8");
      if (current === file.content) {
        changes.push({ ...file, destination, action: "unchanged" });
      } else if (force) {
        changes.push({ ...file, destination, action: "overwrite" });
      } else if (file.path === "AGENTS.md") {
        // A pre-existing AGENTS.md almost always belongs to another tool or
        // to the repository owner. Never block the whole install over it —
        // leave it untouched and suggest the one-line fix instead.
        changes.push({ ...file, destination, action: "skip" });
        agentsMdSkipped = true;
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
    const marker =
      file.action === "unchanged" ? muted("same") :
      file.action === "overwrite" ? amber("write") :
      file.action === "skip" ? amber("skip") :
      green("add ");
    console.log(`  ${marker}  ${file.path}`);
    if (!dryRun && file.action !== "unchanged" && file.action !== "skip") {
      await mkdir(dirname(file.destination), { recursive: true });
      await writeFile(file.destination, file.content, "utf8");
      if (file.executable) await chmod(file.destination, 0o755);
    }
  }

  const written = changes.filter((file) => file.action !== "unchanged" && file.action !== "skip").length;
  const unchanged = changes.filter((file) => file.action === "unchanged").length;
  console.log(
    dryRun
      ? `\n${muted(`${written} writes planned · no changes written`)}`
      : `\n${green("Campaign ready.")} ${written} files written, ${unchanged} already current${agentsMdSkipped ? ", 1 left untouched" : ""}.`,
  );

  await dependencyHint(item, cwd, dryRun);

  if (item.generate && !dryRun) {
    await generateFor(item, cwd);
  } else if (item.generate) {
    console.log(muted(`\nwould generate ${item.generate.out} (project-owned) from .rallypoint/swarm.json`));
  }

  if (agentsMdSkipped) {
    console.log(
      `\n${amber("AGENTS.md already exists and was left unchanged.")} Add this line so agents pick up the loop:\n  ${strong("@AGENTIC_LOOP.md")}`,
    );
  }
}

// What proves an item is already installed in a repository.
const INSTALL_MARKERS = {
  loop: ".rallypoint/config.json",
  swarm: ".rallypoint/swarm.json",
};

async function hasNextApp(cwd) {
  try {
    const pkg = JSON.parse(await readFile(resolve(cwd, "package.json"), "utf8"));
    return Boolean(pkg.dependencies?.next || pkg.devDependencies?.next);
  } catch {
    return false;
  }
}

// npm packages an item's files import (swarm-ui's fleet graph needs d3, its
// live updates @supabase/realtime-js). The CLI never edits package.json or
// runs npm; it names what is missing from the host app and the command that
// adds it.
async function dependencyHint(item, cwd, dryRun) {
  const wanted = [
    ...Object.entries(item.dependencies ?? {}).map(([name, range]) => ({ name, range, dev: false })),
    ...Object.entries(item.devDependencies ?? {}).map(([name, range]) => ({ name, range, dev: true })),
  ];
  if (wanted.length === 0) return;
  let pkg = {};
  try {
    pkg = JSON.parse(await readFile(resolve(cwd, "package.json"), "utf8"));
  } catch {
    // No readable package.json: everything is missing.
  }
  const present = { ...pkg.dependencies, ...pkg.devDependencies };
  const missing = wanted.filter((dep) => !present[dep.name]);
  if (missing.length === 0) return;
  const spec = (deps) => deps.map((dep) => `${dep.name}@"${dep.range}"`).join(" ");
  const runtime = missing.filter((dep) => !dep.dev);
  const dev = missing.filter((dep) => dep.dev);
  const commands = [
    runtime.length ? `npm install ${spec(runtime)}` : null,
    dev.length ? `npm install --save-dev ${spec(dev)}` : null,
  ].filter(Boolean);
  console.log(
    `\n${amber(dryRun ? "Would need" : "Install")} ${missing.map((dep) => dep.name).join(", ")} ${muted(`(imported by ${item.name}'s files, not in package.json)`)}:`,
  );
  for (const command of commands) console.log(`  ${strong(command)}`);
}

// Project-owned files (the swarm UI's swarm.config.ts) are generated by the
// installed swarm runtime, once, and never overwritten.
async function generateFor(item, cwd) {
  const runtime = resolve(cwd, ".rallypoint/swarm/swarm.mjs");
  const out = safeDestination(cwd, item.generate.out);
  if (await exists(out)) {
    console.log(`\n${muted("kept")} ${item.generate.out} ${muted("(project-owned; never overwritten)")}`);
    return;
  }
  if (!(await exists(runtime))) {
    console.log(`\n${amber("Not generated:")} ${item.generate.out} needs the swarm runtime. Run ${strong("rallypoint add swarm")}, then ${strong(`rallypoint swarm ${item.generate.command} --out ${item.generate.out}`)}.`);
    return;
  }
  const result = spawnSync(process.execPath, [runtime, item.generate.command, "--out", item.generate.out], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status === 0) {
    console.log(`\n${green("generated")} ${item.generate.out} ${muted("from .rallypoint/swarm.json · yours to edit")}`);
  } else {
    console.log(`\n${amber("Could not generate")} ${item.generate.out}: ${(result.stderr || result.stdout).trim()}`);
  }
}

function forwardToSwarm() {
  const cwd = resolve(value("--cwd") || process.cwd());
  const runtime = resolve(cwd, ".rallypoint/swarm/swarm.mjs");
  const result = spawnSync(process.execPath, [runtime, ...args.slice(1)], { cwd, stdio: "inherit" });
  if (result.error || result.status === null) {
    throw new Error(`could not run ${runtime}${result.error ? `: ${result.error.message}` : ""}`);
  }
  process.exitCode = result.status;
}

// The labels the installed loop reads. Names come from config.labels, so a
// project that renamed one gets its own name; the fallbacks are the loop's
// defaults. `task` and `ready` are gone: the claimable pool is the absence of
// a hold label (see registry/rallypoint/.rallypoint/scripts/lib/config.mjs),
// and asking for them created a label literally named "undefined".
function requiredLabels(labels = {}) {
  const wanted = [
    { name: labels.claimed ?? "status:claimed", color: "fbca04", description: "Reserved by one worker" },
    { name: labels.blocked ?? "status:blocked", color: "d93f0b", description: "Cannot proceed" },
    { name: labels.deferred ?? "status:deferred", color: "c2e0c6", description: "Deliberately postponed" },
    { name: labels.human ?? "needs:human", color: "5319e7", description: "Requires an owner decision or protected action" },
    { name: labels.approved ?? "review:approved", color: "0e8a16", description: "Reviewer verdict on a pull request" },
    { name: labels.changesRequested ?? "status:changes-requested", color: "e99695", description: "Reviewer asked for changes" },
    { name: labels.mergedUnreviewed ?? "merged:unreviewed", color: "f9d0c4", description: "Merged before an independent review" },
    { name: labels.improvement ?? "loop:improvement", color: "c5def5", description: "A measured change to the loop's own prompts" },
    { name: "prio:p0", color: "b60205", description: "Priority: highest" },
    { name: "prio:p1", color: "d93f0b", description: "Priority: high" },
    { name: "prio:p2", color: "fbca04", description: "Priority: normal" },
    { name: "prio:p3", color: "c2e0c6", description: "Priority: low" },
  ];
  const seen = new Set();
  return wanted.filter((label) => {
    if (typeof label.name !== "string" || label.name.trim() === "" || seen.has(label.name)) return false;
    seen.add(label.name);
    return true;
  });
}

// RALLYPOINT_GH_SCRIPT swaps "gh" for a Node script, as the Swarm runtime
// does, so tests can drive init against a fake GitHub.
function gh(...command) {
  const script = process.env.RALLYPOINT_GH_SCRIPT;
  return execFileSync(script ? process.execPath : "gh", script ? [script, ...command] : command, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function branchProtection(nameWithOwner, branch) {
  try {
    gh("api", `repos/${nameWithOwner}/branches/${branch}/protection`);
    return "protected";
  } catch (error) {
    return /404/.test(error.message) ? "unprotected" : "unknown";
  }
}

function localBranch(cwd) {
  try {
    return execFileSync("git", ["symbolic-ref", "--short", "HEAD"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
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

  // An empty repository (no commits yet) has no default branch: gh reports
  // defaultBranchRef as null or with an empty name. Syncing that would write
  // integrationBranch: "", so keep what the config already says, or fall back
  // to the local branch, and say the branch still has to be pushed.
  const remoteDefault = repository.defaultBranchRef?.name?.trim() || "";
  const emptyRepository = remoteDefault === "";
  const defaultBranch = emptyRepository
    ? config.integrationBranch?.trim() || localBranch(cwd) || "main"
    : remoteDefault;
  if (emptyRepository) {
    console.log(`  ${amber("warn")}  ${repository.nameWithOwner} has no commits yet; using integrationBranch ${defaultBranch} (push it, then re-run “rallypoint init”)`);
  }
  if (config.integrationBranch !== defaultBranch) {
    console.log(`  ${amber("sync")}  integrationBranch ${config.integrationBranch || "(blank)"} -> ${defaultBranch}`);
    config.integrationBranch = defaultBranch;
    if (!dryRun) {
      await writeFile(configPath, `${JSON.stringify(config, null, 2)}
`, "utf8");
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

  const protection = emptyRepository ? "empty" : branchProtection(repository.nameWithOwner, defaultBranch);
  if (protection === "protected") {
    console.log(`  ${green("ok")}    ${defaultBranch} has branch protection`);
  } else if (protection === "unprotected") {
    console.log(`  ${amber("warn")}  ${defaultBranch} has no branch protection rules`);
  } else if (protection === "empty") {
    console.log(`  ${muted("skip")}  branch protection: ${defaultBranch} does not exist on GitHub yet`);
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

// ---------------------------------------------------------------------------
// swarm connect: prompt for the Supabase settings and the swarm secret, set
// the secret in the database, and write the gitignored env files. Secrets are
// read without echo and never printed.
// ---------------------------------------------------------------------------

const AGENT_ENV = ".rallypoint/swarm/.env.local";
const MIN_SECRET = 16; // schema.sql's swarm_set_secret rejects anything shorter

function parseEnv(text) {
  const values = new Map();
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (match) values.set(match[1], match[2].replace(/^(['"])(.*)\1$/, "$2"));
  }
  return values;
}

// Replace KEY=… lines in place and append the rest, keeping comments and
// unrelated keys the operator wrote by hand.
function mergeEnv(text, updates, header) {
  const pending = new Map(Object.entries(updates));
  const lines = text ? text.replace(/\r?\n$/, "").split(/\r?\n/) : header.slice();
  const merged = lines.map((line) => {
    const key = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line)?.[1];
    if (key && pending.has(key)) {
      const next = pending.get(key);
      pending.delete(key);
      return `${key}=${next}`;
    }
    return line;
  });
  for (const [key, next] of pending) merged.push(`${key}=${next}`);
  return `${merged.join("\n")}\n`;
}

async function readText(path) {
  try {
    return await readFile(path, "utf8");
  } catch {
    return "";
  }
}

// Interactive terminals get readline for visible answers and raw mode for
// hidden ones. Piped stdin (scripts, tests) is read line by line instead, so
// `printf '%s\n' … | rallypoint swarm connect` works without a TTY.
function createPrompter() {
  const interactive = Boolean(process.stdin.isTTY);
  let lines = null;
  const nextLine = async () => {
    if (!lines) {
      const chunks = [];
      for await (const chunk of process.stdin) chunks.push(chunk);
      lines = Buffer.concat(chunks).toString("utf8").split(/\r?\n/);
    }
    return lines.length ? lines.shift() : "";
  };

  const visible = async (question) => {
    if (!interactive) {
      process.stdout.write(question);
      const answer = await nextLine();
      process.stdout.write("\n");
      return answer.trim();
    }
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
      return (await rl.question(question)).trim();
    } finally {
      rl.close();
    }
  };

  const hidden = async (question) => {
    process.stdout.write(question);
    if (!interactive) {
      const answer = await nextLine();
      process.stdout.write("\n");
      return answer;
    }
    return new Promise((done, fail) => {
      const stdin = process.stdin;
      let typed = "";
      const cleanup = () => {
        stdin.off("data", onData);
        stdin.setRawMode(false);
        stdin.pause();
        process.stdout.write("\n");
      };
      const onData = (chunk) => {
        for (const char of String(chunk)) {
          if (char === "\r" || char === "\n") {
            cleanup();
            done(typed);
            return;
          }
          if (char === "\u0003") {
            cleanup();
            fail(new Error("cancelled; nothing was changed"));
            return;
          }
          if (char === "\u007f" || char === "\b") typed = typed.slice(0, -1);
          else if (char >= " ") typed += char;
        }
      };
      stdin.setRawMode(true);
      stdin.setEncoding("utf8");
      stdin.resume();
      stdin.on("data", onData);
    });
  };

  return { interactive, visible, hidden };
}

const authHeaders = (key) => ({
  apikey: key,
  // Legacy keys are JWTs and also go in Authorization; the newer
  // sb_publishable_/sb_secret_ keys are not JWTs and only go in apikey.
  ...(key.startsWith("eyJ") ? { Authorization: `Bearer ${key}` } : {}),
  "Content-Type": "application/json",
  Accept: "application/json",
});

async function rpc(url, key, fn, body) {
  let response;
  try {
    response = await fetch(`${url}/rest/v1/rpc/${fn}`, { method: "POST", headers: authHeaders(key), body: JSON.stringify(body) });
  } catch (error) {
    throw new Error(`could not reach ${url}: ${error.cause?.message ?? error.message}`);
  }
  const text = await response.text();
  if (!response.ok) {
    let message = text;
    try {
      message = JSON.parse(text).message ?? text;
    } catch {
      // not JSON; keep the raw body
    }
    const error = new Error(`${fn} failed (${response.status}): ${message}`);
    error.status = response.status;
    throw error;
  }
  return text ? JSON.parse(text) : null;
}

// "ignored", "add" (tracked or not ignored yet) or "no-git".
function ignoreState(cwd, path) {
  const check = spawnSync("git", ["check-ignore", "-q", path], { cwd });
  if (check.status === 0) return "ignored";
  if (check.status === 1) return "add";
  return "no-git";
}

function githubRepo() {
  try {
    return gh("repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner");
  } catch {
    return "";
  }
}

async function connectSwarm() {
  const cwd = resolve(value("--cwd") || process.cwd());
  if (!(await exists(resolve(cwd, ".rallypoint/swarm/swarm.mjs")))) {
    throw new Error(`Rallypoint Swarm is not installed here. Run “rallypoint add swarm” after “rallypoint add loop”.`);
  }
  const agentPath = resolve(cwd, AGENT_ENV);
  const agentText = await readText(agentPath);
  const saved = parseEnv(agentText);
  const known = (name) => process.env[name] || saved.get(name) || "";
  const ask = createPrompter();
  const withDefault = (label, current) => (current ? `${label} [${current}]: ` : `${label}: `);

  console.log(`${strong("Connect Swarm memory")}\n`);

  const knownUrl = known("RALLYPOINT_SUPABASE_URL");
  const url = (value("--url") || (await ask.visible(withDefault("Supabase project URL", knownUrl))) || knownUrl).replace(/\/+$/, "");
  if (!/^https?:\/\/\S+$/.test(url)) throw new Error(`“${url || "(empty)"}” is not a URL like https://<project>.supabase.co; nothing was changed`);

  const knownKey = known("RALLYPOINT_SUPABASE_KEY");
  const key = value("--key") || (await ask.visible(withDefault("Publishable (anon) key", knownKey ? "keep current" : ""))) || knownKey;
  if (!key) throw new Error("the publishable (anon) key is required (Project settings > API keys); nothing was changed");

  // --no-db never writes the secret, and the secret is verified against the
  // database before anything is saved, so a freshly generated one can only
  // fail. Say so before generating anything.
  if (has("--generate") && has("--no-db")) {
    throw new Error("--generate cannot be combined with --no-db: a new secret is not in the database yet, so it could never verify. Set the secret first (select public.swarm_set_secret('…') in the SQL editor, or store its bcrypt hash in public.swarm_secret), then pipe the same secret in: rallypoint swarm connect --no-db < secret-file. Nothing was changed");
  }

  let secret = "";
  if (!has("--generate")) {
    secret = await ask.hidden(`Swarm secret (${MIN_SECRET}+ characters, hidden; leave empty to generate one): `);
    if (secret && ask.interactive) {
      const again = await ask.hidden("Repeat the swarm secret: ");
      if (again !== secret) throw new Error("the two entries did not match; nothing was changed");
    }
  }
  const generated = !secret;
  // The same holds for an empty answer under --no-db, which would otherwise
  // generate a secret that can never verify.
  if (generated && has("--no-db")) {
    throw new Error("--no-db needs the secret that is already set in the database: pipe it in (rallypoint swarm connect --no-db < secret-file) or type it at the prompt. Nothing was changed");
  }
  if (generated) secret = randomBytes(32).toString("base64url");
  if (secret.length < MIN_SECRET) {
    throw new Error(`the swarm secret must be at least ${MIN_SECRET} characters (the schema refuses shorter ones); nothing was changed`);
  }

  if (has("--no-db")) {
    console.log(`  ${muted("skip")}  database: --no-db (the secret must already be set there)`);
  } else {
    const serviceKey = process.env.RALLYPOINT_SUPABASE_SERVICE_KEY
      || (await ask.hidden("Service-role key (hidden; used once to set the secret, never saved): "));
    if (!serviceKey) throw new Error("the service-role key is required to set the secret (or pass --no-db); nothing was changed");
    try {
      await rpc(url, serviceKey, "swarm_set_secret", { p_secret: secret });
    } catch (error) {
      const hint = [401, 403, 404].includes(error.status) || /permission denied/i.test(error.message)
        ? " Re-apply .rallypoint/swarm/schema.sql (it lets service_role set the secret) and check that the key is the service-role key."
        : "";
      throw new Error(`${error.message}.${hint} Nothing was written.`);
    }
    console.log(`  ${green("ok")}    secret set in ${url}`);
  }

  try {
    await rpc(url, key, "swarm_check", { p_secret: secret });
    console.log(`  ${green("ok")}    the publishable key and this secret can write`);
  } catch (error) {
    throw new Error(`the secret did not verify: ${error.message}. Nothing was written.`);
  }

  const written = [];
  await mkdir(dirname(agentPath), { recursive: true });
  await writeFile(agentPath, mergeEnv(agentText, {
    RALLYPOINT_SUPABASE_URL: url,
    RALLYPOINT_SUPABASE_KEY: key,
    RALLYPOINT_SWARM_SECRET: secret,
  }, [
    "# Rallypoint Swarm agents' environment, written by “rallypoint swarm connect”.",
    "# It holds the swarm secret: never commit, share or print it.",
  ]), "utf8");
  await chmod(agentPath, 0o600).catch(() => {});
  written.push(AGENT_ENV);

  // The dashboard only reads, so it gets the URL and the publishable key,
  // never the secret. Standalone dashboards live in swarm-ui/; "add swarm-ui"
  // puts the routes in the project's own Next.js app.
  const dashboardDir = (await exists(resolve(cwd, "swarm-ui/package.json")))
    ? "swarm-ui"
    : (await exists(resolve(cwd, "app/swarm"))) ? "." : null;
  if (dashboardDir) {
    const dashboardPath = resolve(cwd, dashboardDir, ".env.local");
    const dashboardText = await readText(dashboardPath);
    const repo = parseEnv(dashboardText).get("RALLYPOINT_GITHUB_REPO") || githubRepo();
    await writeFile(dashboardPath, mergeEnv(dashboardText, {
      NEXT_PUBLIC_RALLYPOINT_SUPABASE_URL: url,
      NEXT_PUBLIC_RALLYPOINT_SUPABASE_KEY: key,
      ...(repo ? { RALLYPOINT_GITHUB_REPO: repo } : {}),
    }, ["# Rallypoint Swarm dashboard, written by “rallypoint swarm connect”. Read-only keys only."]), "utf8");
    written.push(relative(cwd, dashboardPath).replace(/\\/g, "/"));
  }

  const gitignore = resolve(cwd, ".gitignore");
  for (const path of written) {
    const state = ignoreState(cwd, path);
    if (state === "add") {
      const current = await readText(gitignore);
      await writeFile(gitignore, `${current}${current && !current.endsWith("\n") ? "\n" : ""}/${path}\n`, "utf8");
      console.log(`  ${green("add ")}  /${path} to .gitignore`);
    } else if (state === "no-git") {
      console.log(`  ${amber("warn")}  not a git repository: make sure ${path} is never committed`);
    }
    console.log(`  ${green("wrote")} ${path}`);
  }

  console.log(`\n${green("Swarm memory connected.")} ${generated
    ? `A new ${secret.length}-character secret was generated and saved to ${AGENT_ENV}; it is not shown here.`
    : `The secret is saved in ${AGENT_ENV}.`}`);
  console.log(`Next: ${strong("npx rallypoint@latest swarm doctor")}`);
}

try {
  // `swarm` forwards everything after it (including --version, --help) to the
  // installed runtime, so it is dispatched before any global flag.
  if (command === "swarm" && args[1] === "connect") {
    await connectSwarm();
  } else if (command === "swarm") {
    if (!(await exists(resolve(value("--cwd") || process.cwd(), ".rallypoint/swarm/swarm.mjs")))) {
      throw new Error(`Rallypoint Swarm is not installed here. Run “rallypoint add swarm” after “rallypoint add loop”.`);
    }
    forwardToSwarm();
  } else if (has("--version") || has("-v")) {
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
