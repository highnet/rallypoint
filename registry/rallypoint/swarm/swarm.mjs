#!/usr/bin/env node

// Rallypoint Swarm runtime. Zero dependencies, Node >= 20.
//
//   node .rallypoint/swarm/swarm.mjs <command> [...]
//   npx rallypoint swarm <command> [...]        (forwards here)
//
// GitHub owns the work (issues, claims, pull requests, reviews, merges — all
// through the vanilla scripts in .rallypoint/scripts/). This runtime owns the
// memory: sessions, progress, retros, messages, referee results, shipped
// versions, buried ideas and concepts, in YOUR Supabase project.
//
// This file and lib/ are frozen to the improver: the swarm cannot edit the
// code that measures it.

import { execFileSync, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import process from "node:process";

import { allTargets, parseSwarmConfig } from "./lib/config.mjs";
import { MemoryError, memoryFromEnv } from "./lib/memory.mjs";
import { ROLE_WHEN, computeQueues, pickRole } from "./lib/roles.mjs";
import { referee } from "./lib/referee.mjs";
import { renderUiConfig } from "./lib/ui-config.mjs";

export const EXIT = { OK: 0, ERROR: 1, MISUSE: 2, REFEREE_FAILED: 3, NOTHING: 4 };

// ---------------------------------------------------------------------------
// argv
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2);
const command = argv[0];
const rest = argv.slice(1);

const flag = (name) => rest.includes(`--${name}`);
const option = (name) => {
  const index = rest.indexOf(`--${name}`);
  if (index < 0) return undefined;
  const value = rest[index + 1];
  return value === undefined || value.startsWith("--") ? undefined : value;
};
const positionals = () => {
  const out = [];
  for (let i = 0; i < rest.length; i += 1) {
    if (rest[i].startsWith("--")) {
      const next = rest[i + 1];
      if (next !== undefined && !next.startsWith("--") && !BOOLEAN_FLAGS.has(rest[i].slice(2))) i += 1;
      continue;
    }
    out.push(rest[i]);
  }
  return out;
};
const BOOLEAN_FLAGS = new Set(["json", "dry-run", "force", "no-record", "help", "kept", "reverted", "abandon", "no-color", "since-change", "first"]);

const asJson = flag("json");
const tty = process.stdout.isTTY && !flag("no-color") && !asJson;
const paint = (code, text) => (tty ? `\u001b[${code}m${text}\u001b[0m` : text);
const strong = (text) => paint("1", text);
const green = (text) => paint("32", text);
const amber = (text) => paint("33", text);
const muted = (text) => paint("2", text);

const out = (data, text) => {
  if (asJson) console.log(JSON.stringify(data, null, 2));
  else if (text !== undefined) console.log(text);
};

class UsageError extends Error {}

// ---------------------------------------------------------------------------
// repository context
// ---------------------------------------------------------------------------

const cwd = resolve(option("cwd") ?? process.cwd());
const memory = memoryFromEnv(process.env);

const git = (...args) =>
  execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

const ghCommand = () => {
  const script = process.env.RALLYPOINT_GH_SCRIPT;
  return script ? { cmd: process.execPath, pre: [script] } : { cmd: "gh", pre: [] };
};
const gh = (...args) => {
  const { cmd, pre } = ghCommand();
  return execFileSync(cmd, [...pre, ...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 64 * 1024 * 1024,
  }).trim();
};
const ghJson = (...args) => JSON.parse(gh(...args) || "null");

const readJsonFile = (path) => JSON.parse(readFileSync(path, "utf8"));

const loadSwarmConfig = () => {
  const path = join(cwd, ".rallypoint/swarm.json");
  if (!existsSync(path)) throw new Error("no .rallypoint/swarm.json here: run “npx rallypoint@latest add swarm” first");
  const { config, problems } = parseSwarmConfig(readFileSync(path, "utf8"));
  if (!config) throw new Error(problems.join("; "));
  return { config, problems };
};

const loadLoopConfig = () => {
  const path = join(cwd, ".rallypoint/config.json");
  return existsSync(path) ? readJsonFile(path) : null;
};

const sessionPath = () => {
  let gitDir;
  try {
    gitDir = resolve(cwd, git("rev-parse", "--git-dir"));
  } catch {
    gitDir = join(cwd, ".git");
  }
  return join(gitDir, "rallypoint-swarm", "session.json");
};

const readSession = () => {
  if (process.env.RALLYPOINT_SWARM_SESSION) return { id: process.env.RALLYPOINT_SWARM_SESSION };
  const path = sessionPath();
  return existsSync(path) ? readJsonFile(path) : null;
};

const writeSession = (session) => {
  const path = sessionPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(session, null, 2)}\n`);
};

const clearSession = () => rmSync(sessionPath(), { force: true });

const requireSession = () => {
  const session = readSession();
  if (!session?.id) throw new UsageError("no open session: run “swarm prepare” first");
  return session;
};

const touch = async (session, patch = {}) =>
  memory.update("swarm_sessions", session.id, { last_seen_at: new Date().toISOString(), ...patch });

const intOrNull = (value) => {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(String(value).replace(/^#/, ""));
  return Number.isInteger(n) ? n : null;
};

const ago = (iso) => {
  if (!iso) return "never";
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours} h ago` : `${Math.round(hours / 24)} d ago`;
};

// ---------------------------------------------------------------------------
// commands
// ---------------------------------------------------------------------------

const commands = {};

commands.help = () => {
  console.log(`
${strong("Rallypoint Swarm")}

${strong("Setup")}
  doctor                         check env, gh, git, config, memory and secret
  init [--dry-run]               target labels + goal/visibility into memory
  ui-config [--out <path>] [--force]
                                 generate the project's app/swarm/swarm.config.ts

${strong("A session")}
  prepare [--agent <name>]       open a session
  next [target] [--only a,b]     take your role (merger → fixer → reviewer →
                                 improver → worker → planner → janitor)
  log "<note>"                   progress as you go
  say --kind question|proposal|handoff|answer|note [--ref #n] [--thread id] "<body>"
  inbox [--ref #n] [--limit n]   recent messages
  referee [--target t] [--issue n] [--pr n] [--baseline <ref>] [--first] [--no-record]
                                 measure HEAD (score, checks or review mode); score
                                 mode fails closed without a baseline unless --first
  bury --idea "…" --reason "…" [--lesson "…"] [--concept id] [--target t] [--issue n] [--pr n]
  ship --version v… [--target t] [--pr n] [--sha s] [--score n] [--notes "…"]
  retro --well "…" --friction "…" --suggest "…"   ends the session

${strong("Planning and learning")}
  plan <plan.json> [--dry-run]   open issues: [{title, body, target, concept, type, prio}]
  brief                          the strategist's digest
  concept add <id> "<name>" ["<description>"]
  concept trial <id> --target t --outcome gained|lost|neutral [--delta d] [--ref #n]
  protocol change --summary "…" [--version p2] [--issue n] [--pr n]
  protocol verdict <id> --kept|--reverted
  retros [--since-change] [--role r] [--limit n]
  metrics                        ship rate, claim → close, retros waiting
  status                         JSON snapshot for the conductor

Every command accepts --json. Exit codes: 0 ok · 1 error · 2 misuse ·
3 referee failed · 4 nothing to do.
`.trim());
};

commands.doctor = async () => {
  const checks = [];
  const add = (name, ok, detail, level = ok ? "ok" : "fail") => checks.push({ name, ok, level, detail });

  add("node", Number(process.versions.node.split(".")[0]) >= 20, `v${process.versions.node}`);
  try {
    git("rev-parse", "--is-inside-work-tree");
    add("git", true, "inside a work tree");
  } catch {
    add("git", false, "not inside a git work tree");
  }
  try {
    const login = gh("api", "user", "--jq", ".login");
    add("gh", true, `authenticated as ${login}`);
  } catch {
    add("gh", false, "GitHub CLI missing or not authenticated (gh auth login)");
  }
  add("loop", existsSync(join(cwd, ".rallypoint/config.json")), "vanilla Rallypoint installed (.rallypoint/config.json)");

  let config = null;
  try {
    const loaded = loadSwarmConfig();
    config = loaded.config;
    // Before genesis (no goal title yet) an unfinished measure is expected:
    // genesis decides whatever the wizard left empty.
    const preGenesis = !config.goal.title;
    add(
      "swarm.json",
      loaded.problems.length === 0,
      loaded.problems.length
        ? `${loaded.problems.join("; ")}${preGenesis ? " (genesis will decide)" : ""}`
        : `measure mode: ${config.measure.mode}`,
      loaded.problems.length === 0 ? "ok" : preGenesis ? "warn" : "fail",
    );
    if (preGenesis) {
      add("goal", false, "no goal yet: run swarm genesis (.claude/skills/swarm-genesis/SKILL.md)", "warn");
    }
  } catch (error) {
    add("swarm.json", false, error.message);
  }

  add("RALLYPOINT_SUPABASE_URL", Boolean(process.env.RALLYPOINT_SUPABASE_URL), process.env.RALLYPOINT_SUPABASE_URL ?? "unset");
  add("RALLYPOINT_SUPABASE_KEY", Boolean(process.env.RALLYPOINT_SUPABASE_KEY), process.env.RALLYPOINT_SUPABASE_KEY ? "set" : "unset");
  add(
    "RALLYPOINT_SWARM_SECRET",
    Boolean(process.env.RALLYPOINT_SWARM_SECRET),
    process.env.RALLYPOINT_SWARM_SECRET ? "set (agents only)" : "unset: sessions can read but not write",
    process.env.RALLYPOINT_SWARM_SECRET ? "ok" : "warn",
  );

  if (memory.configured()) {
    try {
      const version = await memory.schemaVersion();
      add("schema", version === 1, `schema version ${version}`);
    } catch (error) {
      add("schema", false, `${error.message} (apply .rallypoint/swarm/schema.sql)`);
    }
    if (memory.canWrite()) {
      try {
        await memory.check();
        add("secret", true, "the swarm secret is accepted");
      } catch (error) {
        add("secret", false, error.message);
      }
    }
  }

  const failed = checks.filter((check) => check.level === "fail");
  if (asJson) out({ ok: failed.length === 0, checks });
  else {
    console.log(strong("Swarm doctor\n"));
    for (const check of checks) {
      const mark = check.level === "ok" ? green("ok  ") : check.level === "warn" ? amber("warn") : amber("fail");
      console.log(`  ${mark}  ${check.name.padEnd(24)} ${muted(check.detail)}`);
    }
    console.log(failed.length ? `\n${amber(`${failed.length} problem(s) to fix.`)}` : `\n${green("Ready.")}`);
  }
  return failed.length ? EXIT.ERROR : EXIT.OK;
};

commands.init = async () => {
  const { config, problems } = loadSwarmConfig();
  if (problems.length) throw new Error(`fix .rallypoint/swarm.json first: ${problems.join("; ")}`);
  const dryRun = flag("dry-run");
  const targets = allTargets(config);
  const done = [];

  let existing = new Set();
  try {
    existing = new Set(ghJson("label", "list", "--json", "name", "--limit", "500").map((label) => label.name));
  } catch (error) {
    throw new Error(`could not list labels (is gh authenticated?): ${error.message.split("\n")[0]}`);
  }
  for (const target of targets) {
    const name = `target:${target.id}`;
    if (existing.has(name)) {
      done.push({ label: name, action: "same" });
      continue;
    }
    const color = (config.ui?.targets?.[target.id]?.color ?? "#6e7781").replace(/^#/, "");
    if (!dryRun) gh("label", "create", name, "--color", color, "--description", (target.description || target.name || target.id).slice(0, 100));
    done.push({ label: name, action: "add" });
  }

  // The vanilla improver's path guard reads `.rallypoint/config.json`. Widen
  // its tunable set to the swarm's tunable paths (skills, playbooks), so the
  // steward's pull requests pass `improvement.mjs check`. Vanilla's own frozen
  // list still wins over anything listed here.
  const loopConfigPath = join(cwd, ".rallypoint/config.json");
  const tunable = [];
  if (existsSync(loopConfigPath)) {
    const loop = readJsonFile(loopConfigPath);
    const current = loop.improvement?.tunablePaths ?? [".rallypoint/roles/"];
    const missing = config.tunablePaths.filter((path) => !current.includes(path));
    if (missing.length) {
      loop.improvement = { ...(loop.improvement ?? {}), tunablePaths: [...current, ...missing] };
      if (!dryRun) writeFileSync(loopConfigPath, `${JSON.stringify(loop, null, 2)}\n`);
    }
    tunable.push(...missing);
  }

  const settings = [];
  if (memory.canWrite()) {
    const values = {
      goal: { ...config.goal, measure: { mode: config.measure.mode, label: config.measure.label, unit: config.measure.unit, direction: config.measure.direction } },
      targets: targets.map(({ id, name, description }) => ({ id, name, description })),
      visibility: config.visibility,
      protocol_version: config.protocolVersion,
      ui: config.ui,
    };
    for (const [key, value] of Object.entries(values)) {
      if (!dryRun) await memory.setSetting(key, value);
      settings.push(key);
    }
  }

  out({ dryRun, labels: done, settings, tunable }, [
    strong(dryRun ? "Swarm init (dry run)\n" : "Swarm init\n"),
    ...done.map((item) => `  ${item.action === "add" ? green("add ") : muted("same")}  label ${item.label}`),
    ...tunable.map((path) => `  ${green("add ")}  improver tunable path ${path} (.rallypoint/config.json)`),
    ...(settings.length
      ? settings.map((key) => `  ${green("set ")}  memory setting ${key}`)
      : [`  ${amber("skip")}  memory settings (RALLYPOINT_SWARM_SECRET unset)`]),
    "",
    dryRun ? muted("no changes written") : green("Swarm initialised."),
  ].join("\n"));
  return EXIT.OK;
};

commands.prepare = async () => {
  const existing = readSession();
  if (existing?.id && !flag("force")) {
    out({ session: existing, reused: true }, `${muted("session already open:")} ${existing.id} ${muted("(use --force for a new one)")}`);
    return EXIT.OK;
  }
  const agent = option("agent") ?? process.env.RALLYPOINT_AGENT ?? `agent-${randomBytes(3).toString("hex")}`;
  const row = await memory.insert("swarm_sessions", { agent });
  const session = { id: row.id, agent, startedAt: row.started_at };
  writeSession(session);
  out({ session }, `${green("session")} ${session.id} ${muted(`as ${agent}`)}\nNext: ${strong("swarm next")}`);
  return EXIT.OK;
};

const roleFiles = (role) => {
  const files = [];
  if (role === "planner") files.push(".rallypoint/swarm/skills/swarm-strategist.md");
  if (role === "improver") files.push(".rallypoint/swarm/skills/swarm-steward.md");
  files.push(`.rallypoint/roles/${role}.md`);
  return files;
};

const gatherBoard = async (config, loop) => {
  const pulls = ghJson("pr", "list", "--state", "open", "--json", "number,title,labels,isDraft,body,headRefName", "--limit", "200");
  const issues = ghJson("issue", "list", "--state", "open", "--json", "number,title,labels,assignees", "--limit", "500");
  const improvementLabel = loop?.labels?.improvement ?? "loop:improvement";
  const labelled = (item) => (item.labels ?? []).some((label) => label.name === improvementLabel);
  const improvementOpen = issues.some(labelled) || pulls.some(labelled);

  let retrosSinceChange = 0;
  let metrics = null;
  if (memory.configured()) {
    try {
      [metrics] = await memory.select("swarm_metrics");
      retrosSinceChange = Number(metrics?.retros_since_change ?? 0);
    } catch {
      metrics = null;
    }
  }

  let disagreements = [];
  const reportScript = join(cwd, ".rallypoint/scripts/report.mjs");
  if (existsSync(reportScript)) {
    const run = spawnSync(process.execPath, [reportScript, "--json", "--skip-pr-checks"], { cwd, encoding: "utf8" });
    try {
      disagreements = JSON.parse(run.stdout).disagreements ?? [];
    } catch {
      disagreements = [];
    }
  }
  return { pulls, issues, improvementOpen, retrosSinceChange, disagreements, metrics };
};

commands.next = async () => {
  const { config } = loadSwarmConfig();
  const loop = loadLoopConfig();
  const [target = null] = positionals();
  if (target && !allTargets(config).some((t) => t.id === target)) {
    throw new UsageError(`unknown target "${target}"; targets: ${allTargets(config).map((t) => t.id).join(", ") || "(none)"}`);
  }
  const only = option("only")?.split(",").map((role) => role.trim()).filter(Boolean) ?? null;
  const board = await gatherBoard(config, loop);
  const queues = computeQueues({
    ...board,
    labels: loop?.labels ?? {},
    target,
    improverRetroThreshold: config.improverRetroThreshold,
  });
  const picked = pickRole({ queues, order: config.roleOrder, only });
  const session = readSession();

  if (!picked) {
    out({ role: null, queues }, "ROLE none\nNothing waits for the roles you may take.");
    return EXIT.NOTHING;
  }
  const ref = picked.next ? `${picked.kind === "pr" ? "PR " : ""}#${picked.next.number}` : "-";
  if (session?.id && memory.canWrite()) {
    await touch(session, {
      role: picked.role,
      target,
      issue: picked.kind === "issue" ? picked.next?.number ?? null : null,
      pr: picked.kind === "pr" ? picked.next?.number ?? null : null,
    });
    writeSession({ ...session, role: picked.role, target });
  }
  const files = roleFiles(picked.role);
  out(
    { role: picked.role, target, ref: picked.next?.number ?? null, kind: picked.kind, title: picked.next?.title ?? null, read: files, queues },
    [
      `ROLE ${picked.role}`,
      `TARGET ${ref}${picked.next?.title ? ` ${muted(picked.next.title)}` : ""}`,
      ...files.map((file) => `READ ${file}`),
      muted(`why: ${ROLE_WHEN[picked.role]} (${picked.count} waiting)${target ? ` · target ${target}` : ""}`),
      picked.role === "worker" ? muted("claim with: node .rallypoint/scripts/claim.mjs --agent-id <your agent id>") : "",
    ].filter(Boolean).join("\n"),
  );
  return EXIT.OK;
};

commands.log = async () => {
  const session = requireSession();
  const note = positionals().join(" ").trim();
  if (!note) throw new UsageError('usage: swarm log "<note>"');
  const row = await memory.insert("swarm_progress", { session_id: session.id, note });
  await touch(session);
  out({ progress: row }, `${green("logged")} ${muted(note)}`);
  return EXIT.OK;
};

commands.say = async () => {
  const session = readSession();
  const kind = option("kind") ?? "note";
  const body = positionals().join(" ").trim();
  if (!body) throw new UsageError('usage: swarm say --kind question|proposal|handoff|answer|note [--ref #n] "<body>"');
  const row = await memory.insert("swarm_messages", {
    session_id: session?.id ?? null,
    author: session?.agent ?? process.env.RALLYPOINT_AGENT ?? "operator",
    kind,
    ref: option("ref") ?? null,
    topic: option("topic") ?? null,
    thread_id: intOrNull(option("thread")),
    body,
  });
  if (session?.id) await touch(session);
  out({ message: row }, `${green("posted")} ${kind} #${row.id}`);
  return EXIT.OK;
};

commands.inbox = async () => {
  const filters = {};
  if (option("ref")) filters.ref = `eq.${option("ref")}`;
  const rows = await memory.select("swarm_messages", {
    order: "created_at.desc",
    limit: Number(option("limit") ?? 20),
    filters,
  });
  out({ messages: rows }, rows.length
    ? rows.reverse().map((m) => `${muted(`#${m.id} ${ago(m.created_at)}`)} ${strong(m.author)} ${m.kind}${m.ref ? ` ${m.ref}` : ""}${m.thread_id ? muted(` ↳ #${m.thread_id}`) : ""}\n  ${m.body}`).join("\n")
    : muted("no messages yet"));
  return EXIT.OK;
};

const runCommand = (commandLine, { cwd: dir, timeoutSeconds }) => {
  const started = Date.now();
  const run = spawnSync(commandLine, {
    cwd: dir,
    shell: true,
    encoding: "utf8",
    timeout: timeoutSeconds * 1000,
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, RALLYPOINT_SWARM_SECRET: "" },
  });
  return { status: run.status, stdout: run.stdout ?? "", stderr: run.stderr ?? "", durationMs: Date.now() - started };
};

commands.referee = async () => {
  const { config, problems } = loadSwarmConfig();
  if (problems.length) throw new Error(`fix .rallypoint/swarm.json first: ${problems.join("; ")}`);
  const loop = loadLoopConfig();
  const measure = config.measure;
  const session = readSession();
  const head = git("rev-parse", "HEAD");

  let baselineCwd = null;
  let baselineSha = null;
  let worktree = null;
  if (measure.mode === "score") {
    const branch = loop?.integrationBranch ?? "main";
    const baselineRef = option("baseline") ?? `origin/${branch}`;
    try {
      if (!option("baseline")) git("fetch", "--quiet", "origin", branch);
      baselineSha = git("rev-parse", baselineRef);
      if (baselineSha === head) {
        // Measuring the baseline against itself: the candidate cannot beat it.
        baselineCwd = cwd;
      } else {
        worktree = mkdtempSync(join(tmpdir(), "rallypoint-baseline-"));
        git("worktree", "add", "--detach", "--force", worktree, baselineSha);
        baselineCwd = worktree;
      }
    } catch (error) {
      console.error(amber(`baseline unavailable: ${error.message.split("\n")[0]}`));
    }
  }

  let result;
  try {
    result = referee({ measure, runCommand, cwd, baselineCwd, requireBaseline: !flag("first") });
  } finally {
    if (worktree) {
      try {
        git("worktree", "remove", "--force", worktree);
      } catch {
        rmSync(worktree, { recursive: true, force: true });
      }
    }
  }

  const row = {
    session_id: session?.id ?? null,
    target: option("target") ?? session?.target ?? null,
    issue: intOrNull(option("issue")),
    pr: intOrNull(option("pr")),
    commit_sha: head,
    baseline_sha: baselineSha,
    mode: result.mode,
    candidate_score: result.candidate_score,
    baseline_score: result.baseline_score,
    delta: result.delta,
    direction: measure.mode === "score" ? measure.direction : null,
    margin: measure.mode === "score" ? Number(measure.margin ?? 0) : null,
    passed: result.passed,
    details: { ...result.details, reason: result.reason },
  };
  let stored = null;
  if (!flag("no-record") && memory.canWrite()) stored = await memory.insert("swarm_results", row);
  if (session?.id && memory.canWrite()) await touch(session);

  const lines = [
    `${result.passed ? green("PASS") : amber("FAIL")} ${muted(`${result.mode} mode`)} ${result.reason}`,
  ];
  if (result.mode === "score") {
    lines.push(muted(`candidate ${result.candidate_score ?? "—"} · baseline ${result.baseline_score ?? "—"}${measure.unit ? ` ${measure.unit}` : ""}`));
  }
  if (result.mode === "checks") {
    for (const check of result.details.checks) lines.push(`  ${check.passed ? green("ok  ") : amber("fail")} ${check.name} ${muted(`${check.durationMs} ms`)}`);
  }
  if (stored) lines.push(muted(`recorded as result #${stored.id}`));
  if (!result.passed) lines.push(`If the idea is dead, keep the lesson: ${strong('swarm bury --idea "…" --reason "…" --lesson "…"')}`);
  out({ result: stored ?? row }, lines.join("\n"));
  return result.passed ? EXIT.OK : EXIT.REFEREE_FAILED;
};

commands.bury = async () => {
  const session = readSession();
  const idea = option("idea");
  const reason = option("reason");
  if (!idea || !reason) throw new UsageError('usage: swarm bury --idea "…" --reason "…" [--lesson "…"] [--concept id]');
  let numbers = null;
  try {
    const [latest] = await memory.select("swarm_results", { order: "created_at.desc", limit: 1, filters: session?.id ? { session_id: `eq.${session.id}` } : {} });
    if (latest) {
      numbers = {
        result_id: latest.id,
        mode: latest.mode,
        candidate_score: latest.candidate_score,
        baseline_score: latest.baseline_score,
        delta: latest.delta,
        passed: latest.passed,
        checks: latest.details?.checks?.map(({ name, passed }) => ({ name, passed })) ?? null,
      };
    }
  } catch {
    numbers = null;
  }
  const row = await memory.insert("swarm_buried", {
    target: option("target") ?? session?.target ?? null,
    issue: intOrNull(option("issue")),
    pr: intOrNull(option("pr")),
    idea,
    concept: option("concept") ?? null,
    reason,
    lesson: option("lesson") ?? null,
    numbers,
  });
  if (row.concept) {
    try {
      await memory.insert("swarm_concept_trials", {
        concept_id: row.concept,
        target: row.target ?? "all",
        outcome: "lost",
        delta: numbers?.delta ?? null,
        ref: row.pr ? `#${row.pr}` : row.issue ? `#${row.issue}` : null,
      });
    } catch {
      // unknown concept ids are not fatal for a burial
    }
  }
  if (session?.id) await touch(session);
  out({ buried: row }, `${green("buried")} #${row.id} ${muted(idea)}`);
  return EXIT.OK;
};

commands.ship = async () => {
  const session = readSession();
  const version = option("version");
  if (!version) throw new UsageError("usage: swarm ship --version v… [--target t] [--pr n] [--score n]");
  let score = option("score") !== undefined ? Number(option("score")) : null;
  const target = option("target") ?? session?.target ?? null;
  const pr = intOrNull(option("pr"));
  // The merge commit, not whatever this checkout's HEAD happens to be.
  let sha = option("sha") ?? null;
  if (!sha && pr) {
    try {
      sha = gh("pr", "view", String(pr), "--json", "mergeCommit", "--jq", ".mergeCommit.oid") || null;
    } catch {
      sha = null;
    }
  }
  if (!sha) {
    try {
      sha = git("rev-parse", "HEAD");
    } catch {
      sha = null;
    }
  }
  if (score === null) {
    try {
      const filters = { passed: "eq.true", mode: "eq.score" };
      if (pr) filters.pr = `eq.${pr}`;
      if (target) filters.target = `eq.${target}`;
      const [latest] = await memory.select("swarm_results", { order: "created_at.desc", limit: 1, filters });
      score = latest?.candidate_score ?? null;
    } catch {
      score = null;
    }
  }
  const row = await memory.insert("swarm_versions", {
    target,
    version,
    score,
    pr,
    commit_sha: sha,
    notes: option("notes") ?? null,
  });
  if (session?.id) await touch(session);
  out({ version: row }, `${green("shipped")} ${row.target ? `${row.target} ` : ""}${version}${score !== null ? muted(` · ${score}`) : ""}`);
  return EXIT.OK;
};

commands.concept = async () => {
  const [sub, id, name, description] = positionals();
  if (sub === "add") {
    if (!id || !name) throw new UsageError('usage: swarm concept add <id> "<name>" ["<description>"]');
    const row = await memory.insert("swarm_concepts", { id, name, description: description ?? null });
    out({ concept: row }, `${green("concept")} ${row.id}`);
    return EXIT.OK;
  }
  if (sub === "trial") {
    const target = option("target");
    const outcome = option("outcome");
    if (!id || !target || !outcome) throw new UsageError("usage: swarm concept trial <id> --target t --outcome gained|lost|neutral [--delta d]");
    const row = await memory.insert("swarm_concept_trials", {
      concept_id: id,
      target,
      outcome,
      delta: option("delta") !== undefined ? Number(option("delta")) : null,
      ref: option("ref") ?? null,
    });
    out({ trial: row }, `${green("trial")} ${id} on ${target}: ${outcome}`);
    return EXIT.OK;
  }
  throw new UsageError("usage: swarm concept add|trial …");
};

commands.protocol = async () => {
  const [sub, id] = positionals();
  if (sub === "change") {
    const summary = option("summary");
    if (!summary) throw new UsageError('usage: swarm protocol change --summary "…" [--version p2] [--issue n] [--pr n]');
    let version = option("version");
    if (!version) {
      const [metrics] = await memory.select("swarm_metrics");
      const current = /^p(\d+)$/.exec(metrics?.protocol_version ?? "p1");
      version = current ? `p${Number(current[1]) + 1}` : "p2";
    }
    const row = await memory.insert("swarm_protocol_changes", { version, summary, issue: intOrNull(option("issue")), pr: intOrNull(option("pr")) });
    await memory.setSetting("protocol_version", version);
    out({ change: row }, `${green("protocol")} ${version} ${muted(summary)}`);
    return EXIT.OK;
  }
  if (sub === "verdict") {
    if (!id || (flag("kept") === flag("reverted"))) throw new UsageError("usage: swarm protocol verdict <id> --kept|--reverted");
    const row = await memory.update("swarm_protocol_changes", id, { kept: flag("kept") });
    out({ change: row }, `${green("verdict")} ${row.version}: ${row.kept ? "kept" : "reverted"}`);
    return EXIT.OK;
  }
  throw new UsageError("usage: swarm protocol change|verdict …");
};

const PRIORITIES = new Set(["p0", "p1", "p2", "p3"]);

commands.plan = async () => {
  const [file] = positionals();
  if (!file) throw new UsageError("usage: swarm plan <plan.json> [--dry-run]");
  const { config } = loadSwarmConfig();
  const targetIds = new Set(allTargets(config).map((t) => t.id));
  const plan = readJsonFile(resolve(cwd, file));
  const tasks = Array.isArray(plan) ? plan : plan.tasks;
  if (!Array.isArray(tasks) || tasks.length === 0) throw new UsageError("plan.json must be an array of tasks (or {tasks: [...]})");

  const problems = [];
  tasks.forEach((task, i) => {
    if (!task.title) problems.push(`task ${i}: title is required`);
    if (!task.body) problems.push(`task ${i}: body with acceptance criteria is required`);
    if (task.target && !targetIds.has(task.target)) problems.push(`task ${i}: unknown target "${task.target}"`);
    if (task.prio && !PRIORITIES.has(task.prio)) problems.push(`task ${i}: prio must be p0–p3`);
  });
  if (problems.length) throw new UsageError(problems.join("\n"));

  const created = [];
  for (const task of tasks) {
    const trailer = [
      task.target ? `Target: ${task.target}` : null,
      task.concept ? `Concept: ${task.concept}` : null,
      task.type ? `Type: ${task.type}` : null,
    ].filter(Boolean);
    const body = `${task.body.trim()}${trailer.length ? `\n\n${trailer.join("\n")}` : ""}`;
    const labels = [`prio:${task.prio ?? "p2"}`, ...(task.target ? [`target:${task.target}`] : []), ...(task.labels ?? [])];
    if (flag("dry-run")) {
      created.push({ title: task.title, labels, url: null });
      continue;
    }
    const args = ["issue", "create", "--title", task.title, "--body", body];
    for (const label of labels) args.push("--label", label);
    const url = gh(...args);
    created.push({ title: task.title, labels, url });
  }
  out({ created, dryRun: flag("dry-run") }, created.map((task) => `  ${flag("dry-run") ? muted("plan") : green("open")}  ${task.title} ${muted(task.labels.join(" "))}${task.url ? `\n        ${task.url}` : ""}`).join("\n"));
  return EXIT.OK;
};

const safeSelect = async (table, query) => {
  try {
    return await memory.select(table, query);
  } catch {
    return [];
  }
};

commands.brief = async () => {
  const { config } = loadSwarmConfig();
  const targets = allTargets(config);
  const [versions, buried, trials, concepts, metricsRows, retros] = await Promise.all([
    safeSelect("swarm_versions", { order: "created_at.desc", limit: 200 }),
    safeSelect("swarm_buried", { order: "created_at.desc", limit: 15 }),
    safeSelect("swarm_concept_trials", { order: "created_at.desc", limit: 500 }),
    safeSelect("swarm_concepts", { order: "created_at.asc" }),
    safeSelect("swarm_metrics"),
    safeSelect("swarm_retros", { order: "created_at.desc", limit: 8 }),
  ]);
  let issues = [];
  try {
    issues = ghJson("issue", "list", "--state", "open", "--json", "number,title,labels", "--limit", "500");
  } catch {
    issues = [];
  }
  const perTarget = targets.map((target) => {
    const latest = versions.find((v) => v.target === target.id) ?? null;
    const open = issues.filter((issue) => issue.labels.some((label) => label.name === `target:${target.id}`)).length;
    return { id: target.id, name: target.name, latest, open };
  });
  const matrix = concepts.map((concept) => ({
    id: concept.id,
    name: concept.name,
    byTarget: Object.fromEntries(
      targets.map((target) => {
        const t = trials.filter((trial) => trial.concept_id === concept.id && trial.target === target.id);
        return [target.id, t.length ? t[0].outcome : null];
      }),
    ),
  }));
  const data = { goal: config.goal, measure: config.measure, targets: perTarget, buried, concepts: matrix, metrics: metricsRows[0] ?? null, recentRetros: retros, openIssues: issues.length };
  const unit = config.measure.unit ? ` ${config.measure.unit}` : "";
  out(data, [
    strong(config.goal.title || "Untitled swarm"),
    config.goal.pitch || config.goal.statement || muted("(no pitch yet: run swarm genesis)"),
    muted(`measure: ${config.measure.mode}${config.measure.label ? ` · ${config.measure.label}` : ""}`),
    "",
    strong("Targets"),
    ...(perTarget.length
      ? perTarget.map((t) => `  ${t.id.padEnd(14)} ${t.latest ? `${t.latest.version}${t.latest.score !== null ? ` · ${t.latest.score}${unit}` : ""}` : muted("nothing shipped")}  ${muted(`${t.open} open`)}`)
      : [muted("  (no targets)")]),
    "",
    strong("Concepts (target: + gained, − lost, = neutral, · untried)"),
    ...(matrix.length
      ? matrix.map((c) => `  ${c.id.padEnd(22)} ${targets.map((t) => `${t.id}:${({ gained: "+", lost: "−", neutral: "=" })[c.byTarget[t.id]] ?? "·"}`).join("  ")}`)
      : [muted("  (none yet)")]),
    "",
    strong("Recently buried"),
    ...(buried.length ? buried.map((b) => `  ${b.target ?? "—"} · ${b.idea} ${muted(`— ${b.reason}`)}${b.lesson ? `\n      lesson: ${b.lesson}` : ""}`) : [muted("  (none)")]),
    "",
    muted(`${issues.length} open issues · prefer porting a concept that gained in one target to the targets that have not tried it`),
  ].join("\n"));
  return EXIT.OK;
};

commands.retros = async () => {
  const filters = {};
  if (flag("since-change")) {
    const [last] = await safeSelect("swarm_protocol_changes", { order: "created_at.desc", limit: 1 });
    if (last) filters.created_at = `gt.${last.created_at}`;
  }
  if (option("role")) filters.role = `eq.${option("role")}`;
  const rows = await memory.select("swarm_retros", { order: "created_at.desc", limit: Number(option("limit") ?? 50), filters });
  out({ retros: rows }, rows.length
    ? rows.map((r) => `${muted(`#${r.id} ${ago(r.created_at)} ${r.role ?? "—"} ${r.protocol_version ?? ""}`)}${r.went_well ? `\n  + ${r.went_well}` : ""}${r.friction ? `\n  − ${r.friction}` : ""}${r.suggestion ? `\n  → ${r.suggestion}` : ""}`).join("\n")
    : muted("no retros"));
  return EXIT.OK;
};

commands.metrics = async () => {
  const [metrics] = await memory.select("swarm_metrics");
  out({ metrics }, metrics
    ? [
        `protocol version       ${metrics.protocol_version}`,
        `shipped / buried       ${metrics.shipped} / ${metrics.buried}`,
        `ship rate              ${metrics.ship_rate === null ? "—" : `${Math.round(metrics.ship_rate * 100)}%`}`,
        `claim → close (median) ${metrics.median_claim_to_close_minutes ?? "—"} min`,
        `progress notes/session ${metrics.progress_per_session ?? "—"}`,
        `retros since change    ${metrics.retros_since_change}`,
        `sessions working       ${metrics.sessions_working}`,
      ].join("\n")
    : muted("no metrics yet"));
  return EXIT.OK;
};

commands.retro = async () => {
  const session = requireSession();
  const { config } = loadSwarmConfig();
  const well = option("well");
  const friction = option("friction");
  const suggest = option("suggest");
  if (!well && !friction && !suggest) throw new UsageError('usage: swarm retro --well "…" --friction "…" --suggest "…"');
  let protocolVersion = config.protocolVersion;
  try {
    const [metrics] = await memory.select("swarm_metrics");
    protocolVersion = metrics?.protocol_version ?? protocolVersion;
  } catch {
    // keep the configured version
  }
  const row = await memory.insert("swarm_retros", {
    session_id: session.id,
    role: session.role ?? null,
    protocol_version: protocolVersion,
    went_well: well ?? null,
    friction: friction ?? null,
    suggestion: suggest ?? null,
  });
  const now = new Date().toISOString();
  await memory.update("swarm_sessions", session.id, { status: "ended", ended_at: now, last_seen_at: now, summary: option("summary") ?? null });
  clearSession();
  out({ retro: row }, `${green("retro")} #${row.id} · session ended`);
  return EXIT.OK;
};

commands.end = async () => {
  const session = requireSession();
  const now = new Date().toISOString();
  await memory.update("swarm_sessions", session.id, { status: flag("abandon") ? "abandoned" : "ended", ended_at: now, last_seen_at: now });
  clearSession();
  out({ ended: session.id }, `${muted("session ended without a retro")} ${amber("(leave one next time: swarm retro)")}`);
  return EXIT.OK;
};

commands.status = async () => {
  const { config } = loadSwarmConfig();
  const loop = loadLoopConfig();
  const board = await gatherBoard(config, loop);
  const fleet = await safeSelect("swarm_fleet");
  const perTarget = Object.fromEntries(
    [null, ...allTargets(config).map((t) => t.id)].map((target) => {
      const queues = computeQueues({ ...board, labels: loop?.labels ?? {}, target, improverRetroThreshold: config.improverRetroThreshold });
      return [target ?? "*", Object.fromEntries(Object.entries(queues).map(([role, q]) => [role, q.count]))];
    }),
  );
  const data = { session: readSession(), fleet, queues: perTarget, metrics: board.metrics, conductor: config.conductor };
  console.log(JSON.stringify(data, null, 2));
  return EXIT.OK;
};

commands["ui-config"] = async () => {
  const { config } = loadSwarmConfig();
  const target = resolve(cwd, option("out") ?? (existsSync(join(cwd, "swarm-ui/app/swarm")) ? "swarm-ui/app/swarm/swarm.config.ts" : "app/swarm/swarm.config.ts"));
  if (existsSync(target) && !flag("force")) {
    out({ written: false, path: target }, `${muted("kept")} ${target} ${muted("(project-owned; pass --force to regenerate)")}`);
    return EXIT.OK;
  }
  let repository = process.env.RALLYPOINT_GITHUB_REPO ?? null;
  if (!repository) {
    try {
      repository = gh("repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner");
    } catch {
      repository = null;
    }
  }
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, renderUiConfig(config, { repository }));
  out({ written: true, path: target }, `${green("wrote")} ${target}`);
  return EXIT.OK;
};

// ---------------------------------------------------------------------------

const run = commands[command] ?? (command ? null : commands.help);
if (!run || flag("help")) {
  commands.help();
  process.exit(run || flag("help") ? EXIT.OK : EXIT.MISUSE);
}

try {
  process.exitCode = (await run()) ?? EXIT.OK;
} catch (error) {
  const code = error instanceof UsageError ? EXIT.MISUSE : EXIT.ERROR;
  const prefix = error instanceof MemoryError ? "memory" : error instanceof UsageError ? "usage" : "error";
  if (asJson) console.log(JSON.stringify({ ok: false, error: error.message }));
  else console.error(`${amber(`swarm ${prefix}:`)} ${error.message}`);
  process.exitCode = code;
}
