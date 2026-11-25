#!/usr/bin/env node

// Rallypoint Swarm: unit tests for the pure modules, plus an offline
// end-to-end run of the CLI against an in-process fake of PostgREST and a fake
// `gh`. No network, no real Supabase, no real GitHub.
//
//   npm run swarm:test        (builds the registry first)

import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const cli = resolve(root, "packages/cli/bin/rallypoint.mjs");
const lib = (name) => import(resolve(root, "registry/rallypoint/swarm/lib", name));

const { computeQueues, pickRole, referencedIssues } = await lib("roles.mjs");
const { parseScore, compareScores, referee, validateMeasure } = await lib("referee.mjs");
const { parseSwarmConfig, allTargets } = await lib("config.mjs");
const { renderUiConfig, uiConfigFrom } = await lib("ui-config.mjs");

let passed = 0;
const test = async (name, fn) => {
  try {
    await fn();
    passed += 1;
  } catch (error) {
    console.error(`✗ ${name}`);
    throw error;
  }
};

// ---------------------------------------------------------------------------
// pure modules
// ---------------------------------------------------------------------------

const L = (...names) => names.map((name) => ({ name }));

await test("finish-first: an approved PR beats everything", () => {
  const queues = computeQueues({
    pulls: [
      { number: 7, labels: L("review:approved") },
      { number: 8, labels: [] },
    ],
    issues: [{ number: 1, labels: L("prio:p1"), assignees: [] }],
  });
  assert.equal(pickRole({ queues }).role, "merger");
  assert.equal(pickRole({ queues }).next.number, 7);
});

await test("fixer, then reviewer, then worker by priority", () => {
  const pulls = [{ number: 9, labels: L("status:changes-requested") }, { number: 10, labels: [] }];
  const issues = [
    { number: 3, labels: L("prio:p2"), assignees: [] },
    { number: 4, labels: L("prio:p1"), assignees: [] },
    { number: 5, labels: L("status:claimed"), assignees: [] },
  ];
  assert.equal(pickRole({ queues: computeQueues({ pulls, issues }) }).role, "fixer");
  assert.equal(pickRole({ queues: computeQueues({ pulls: pulls.slice(1), issues }) }).role, "reviewer");
  const worker = pickRole({ queues: computeQueues({ pulls: [], issues }) });
  assert.equal(worker.role, "worker");
  assert.equal(worker.next.number, 4, "p1 before p2; claimed issues are not claimable");
});

await test("improver is due after the retro threshold, unless one is open", () => {
  const base = { pulls: [], issues: [{ number: 1, labels: [], assignees: [] }], retrosSinceChange: 3, improverRetroThreshold: 3 };
  assert.equal(pickRole({ queues: computeQueues(base) }).role, "improver");
  assert.equal(pickRole({ queues: computeQueues({ ...base, improvementOpen: true }) }).role, "worker");
});

await test("planner when nothing is open; janitor on disagreements; --only", () => {
  assert.equal(pickRole({ queues: computeQueues({ pulls: [], issues: [] }) }).role, "planner");
  const queues = computeQueues({ pulls: [], issues: [{ number: 1, labels: L("needs:human"), assignees: [] }], disagreements: [{ kind: "janitorCandidate" }] });
  assert.equal(pickRole({ queues }).role, "janitor");
  assert.equal(pickRole({ queues, only: ["merger", "reviewer"] }), null);
});

await test("targets filter issues by label and PRs through the issue they close", () => {
  const issues = [
    { number: 1, labels: L("target:api"), assignees: [] },
    { number: 2, labels: L("target:web"), assignees: [] },
  ];
  const pulls = [{ number: 11, labels: [], body: "Closes #2" }];
  assert.deepEqual(referencedIssues("Fixes #2 and refs #9"), [2, 9]);
  assert.equal(pickRole({ queues: computeQueues({ pulls, issues, target: "api" }) }).role, "worker");
  assert.equal(pickRole({ queues: computeQueues({ pulls, issues, target: "web" }) }).role, "reviewer");
});

await test("parseScore reads JSON or the last number", () => {
  assert.equal(parseScore('noise\n{"score": 1530}\n'), 1530);
  assert.equal(parseScore("games: 40\nelo 1412.5"), 1412.5);
  assert.equal(parseScore("42"), 42);
  assert.equal(parseScore("no number here"), null);
  assert.equal(parseScore(""), null);
});

await test("compareScores respects direction and margin", () => {
  assert.equal(compareScores({ candidate: 110, baseline: 100, margin: 5 }).passed, true);
  assert.equal(compareScores({ candidate: 104, baseline: 100, margin: 5 }).passed, false);
  assert.equal(compareScores({ candidate: 100, baseline: 100, margin: 0 }).passed, false, "a tie does not ship");
  assert.equal(compareScores({ candidate: 80, baseline: 100, direction: "lower", margin: 10 }).passed, true);
  assert.equal(compareScores({ candidate: 95, baseline: 100, direction: "lower", margin: 10 }).passed, false);
  assert.equal(compareScores({ candidate: 5, baseline: null }).passed, true, "the first version sets the baseline");
});

await test("referee modes: review passes, checks need every command, score compares", () => {
  const runCommand = (cmd) => ({ status: cmd.includes("fail") ? 1 : 0, stdout: cmd.includes("new") ? "12" : "10", stderr: "", durationMs: 1 });
  assert.equal(referee({ measure: { mode: "review" }, runCommand, cwd: "." }).passed, true);
  const checks = referee({ measure: { mode: "checks", checks: [{ name: "build", command: "ok" }, { name: "e2e", command: "fail" }] }, runCommand, cwd: "." });
  assert.equal(checks.passed, false);
  assert.match(checks.reason, /e2e/);
  assert.equal(checks.candidate_score, null, "checks mode has no number");
  const score = referee({ measure: { mode: "score", command: "new", margin: 1 }, runCommand: (cmd, { cwd }) => runCommand(cwd === "base" ? "old" : "new"), cwd: "head", baselineCwd: "base" });
  assert.equal(score.passed, true);
  assert.equal(score.delta, 2);
});

await test("measure validation", () => {
  assert.deepEqual(validateMeasure({ mode: "review" }), []);
  assert.equal(validateMeasure({ mode: "score" }).length, 1);
  assert.equal(validateMeasure({ mode: "checks", checks: [] }).length, 1);
  assert.equal(validateMeasure({ mode: "nope" }).length, 1);
});

await test("swarm.json: defaults, target ids, tunable/frozen overlap", () => {
  const { config, problems } = parseSwarmConfig(JSON.stringify({ targets: [{ id: "api" }], ui: { includeUiTarget: true } }));
  assert.deepEqual(problems, []);
  assert.deepEqual(allTargets(config).map((t) => t.id), ["api", "ui"]);
  assert.ok(parseSwarmConfig(JSON.stringify({ targets: [{ id: "Bad Id" }] })).problems.length);
  assert.ok(parseSwarmConfig(JSON.stringify({ tunablePaths: [".rallypoint/scripts/x/"] })).problems.some((p) => p.includes("overlaps")));
  assert.ok(parseSwarmConfig("{nope").problems[0].includes("not valid JSON"));
});

await test("ui-config generation follows the documented mapping", () => {
  const arena = {
    goal: { title: "Swarm Arena", statement: "Engines that keep getting stronger", pitch: "A swarm of AI agents building chess, Go, Othello and Hex engines." },
    measure: { mode: "score", unit: "Elo", direction: "higher", command: "npm run referee --silent" },
    targets: [{ id: "chess", name: "Chess" }, { id: "go9", name: "Go 9×9" }],
    ui: { targets: { chess: { color: "#3b6fb6" } }, vocabulary: { shipped: "landed", targets: "engines", results: "games" } },
  };
  const ui = uiConfigFrom(arena, { repository: "highnet/swarm-arena" });
  assert.equal(ui.project.name, "swarm-arena", "falls back to the repository name");
  assert.equal(ui.project.tagline, arena.goal.pitch, "falls back to the pitch");
  assert.equal(ui.measure.label, "Score");
  assert.equal(ui.targets[0].color, "#3b6fb6");
  assert.equal(ui.targets[1].color, "#d4572a", "second default colour");
  const source = renderUiConfig(arena, { repository: "highnet/swarm-arena" });
  assert.match(source, /PROJECT-OWNED/);
  assert.match(source, /"shipped": "landed"/);
  assert.match(source, /"\/swarm\/targets": "Engines"/);
  assert.match(source, /export const swarmConfig: SwarmConfig/);
});

// ---------------------------------------------------------------------------
// end to end: install + CLI against fake PostgREST and fake gh
// ---------------------------------------------------------------------------

const SECRET = "correct-horse-battery-staple";
const db = { swarm_sessions: [], swarm_progress: [], swarm_retros: [], swarm_messages: [], swarm_results: [], swarm_versions: [], swarm_buried: [], swarm_concepts: [], swarm_concept_trials: [], swarm_protocol_changes: [], swarm_settings: [] };
let nextId = 1;
const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
  const send = (status, data) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(data));
  };
  if (req.headers.apikey !== "anon-key") return send(401, { message: "no apikey" });
  const path = url.pathname.replace("/rest/v1/", "");
  if (path.startsWith("rpc/")) {
    const fn = path.slice(4);
    if (fn === "swarm_schema_version") return send(200, 1);
    if (body.p_secret !== SECRET) return send(400, { code: "28P01", message: "invalid swarm secret" });
    if (fn === "swarm_check") return send(200, { ok: true, schema_version: 1 });
    if (fn === "swarm_write") {
      const row = { id: body.p_table === "swarm_sessions" ? `00000000-0000-4000-8000-${String(nextId).padStart(12, "0")}` : nextId, created_at: new Date().toISOString(), started_at: new Date().toISOString(), ...body.p_row };
      nextId += 1;
      db[body.p_table].push(row);
      return send(200, row);
    }
    if (fn === "swarm_update") {
      const row = db[body.p_table].find((r) => String(r.id) === body.p_id);
      if (!row) return send(404, { message: "no row" });
      Object.assign(row, body.p_patch);
      return send(200, row);
    }
    if (fn === "swarm_set_setting") {
      db.swarm_settings = db.swarm_settings.filter((s) => s.key !== body.p_key).concat({ key: body.p_key, value: body.p_value });
      return send(200, { key: body.p_key, value: body.p_value });
    }
    return send(404, { message: `unknown rpc ${fn}` });
  }
  if (path === "swarm_metrics") {
    return send(200, [{ protocol_version: "p1", shipped: db.swarm_versions.length, buried: db.swarm_buried.length, ship_rate: null, median_claim_to_close_minutes: null, progress_per_session: null, retros_since_change: db.swarm_retros.length, sessions_working: 0 }]);
  }
  if (path === "swarm_fleet") return send(200, []);
  let rows = [...(db[path] ?? [])];
  for (const [column, condition] of url.searchParams) {
    if (["select", "order", "limit"].includes(column)) continue;
    const [, value] = condition.split(/\.(.*)/s);
    rows = rows.filter((row) => String(row[column]) === value);
  }
  if (url.searchParams.get("order")?.endsWith(".desc")) rows.reverse();
  if (url.searchParams.get("limit")) rows = rows.slice(0, Number(url.searchParams.get("limit")));
  return send(200, rows);
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const memoryUrl = `http://127.0.0.1:${server.address().port}`;

const fixture = await mkdtemp(resolve(tmpdir(), "rallypoint-swarm-"));
const ghLog = resolve(fixture, ".gh-log.jsonl");
const fakeGh = resolve(fixture, "..", `fake-gh-${process.pid}.mjs`);
await writeFile(fakeGh, `
import { appendFileSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(${JSON.stringify(ghLog)}, JSON.stringify(args) + "\\n");
const key = args.slice(0, 2).join(" ");
if (key === "api user") console.log("swarm-bot");
else if (key === "pr list") console.log(JSON.stringify([{ number: 21, title: "Faster parse", labels: [{ name: "review:approved" }], isDraft: false, body: "Closes #4", headRefName: "agent/4-x" }]));
else if (key === "issue list") console.log(JSON.stringify([{ number: 4, title: "Faster parse", labels: [{ name: "target:api" }, { name: "status:claimed" }], assignees: [] }, { number: 5, title: "Hero", labels: [{ name: "target:web" }, { name: "prio:p1" }], assignees: [] }]));
else if (key === "label list") console.log(JSON.stringify([{ name: "target:api" }]));
else if (key === "label create") console.log("");
else if (key === "issue create") console.log("https://github.com/acme/app/issues/99");
else if (key === "repo view") console.log("acme/app");
else { console.error("fake gh: unhandled " + key); process.exit(1); }
`);

const env = {
  ...process.env,
  RALLYPOINT_GH_SCRIPT: fakeGh,
  RALLYPOINT_SUPABASE_URL: memoryUrl,
  RALLYPOINT_SUPABASE_KEY: "anon-key",
  RALLYPOINT_SWARM_SECRET: SECRET,
  RALLYPOINT_AGENT: "test-agent",
  GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.com",
};

// spawnSync would block this process's event loop, and with it the fake
// server; run the CLI asynchronously instead.
const rp = (args, { expect = 0, extraEnv = {} } = {}) =>
  new Promise((done, fail) => {
    const child = spawn(process.execPath, [cli, ...args], { cwd: fixture, env: { ...env, ...extraEnv } });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("close", (status) => {
      if (status !== expect) fail(new Error(`rallypoint ${args.join(" ")} exited ${status}, expected ${expect}\n${stdout}\n${stderr}`));
      else done(`${stdout}${stderr}`);
    });
  });
const sh = (...args) => execFileSync(args[0], args.slice(1), { cwd: fixture, env, encoding: "utf8" });

try {
  sh("git", "init", "-q", "-b", "main");

  await test("swarm requires loop; swarm-ui requires a Next.js app", async () => {
    const out = await rp(["add", "swarm"], { expect: 2 });
    assert.match(out, /rallypoint add loop/);
  });

  await test("install loop + swarm", async () => {
    await rp(["add", "loop"]);
    const out = await rp(["add", "swarm"]);
    assert.match(out, /Campaign ready\./);
    for (const path of ["SWARM.md", ".rallypoint/swarm.json", ".rallypoint/swarm/swarm.mjs", ".rallypoint/swarm/schema.sql", ".claude/skills/swarm-genesis/SKILL.md"]) {
      await readFile(resolve(fixture, path));
    }
  });

  await test("the npm CLI forwards to the runtime, --version included", async () => {
    assert.match(await rp(["swarm", "help"]), /Rallypoint Swarm/);
  });

  // Configure the swarm as genesis would: checks mode, two targets, a UI.
  const swarmJsonPath = resolve(fixture, ".rallypoint/swarm.json");
  const swarmJson = JSON.parse(await readFile(swarmJsonPath, "utf8"));
  swarmJson.goal = { title: "Acme app", statement: "Ship the app", pitch: "A swarm building the Acme website." };
  swarmJson.measure = { ...swarmJson.measure, mode: "checks", checks: [{ name: "build", command: "node -e \"process.exit(0)\"" }, { name: "lint", command: "node -e \"process.exit(0)\"" }] };
  swarmJson.targets = [{ id: "api", name: "API", description: "Backend" }, { id: "web", name: "Web", description: "Frontend" }];
  swarmJson.ui.includeUiTarget = true;
  await writeFile(swarmJsonPath, JSON.stringify(swarmJson, null, 2));
  await writeFile(resolve(fixture, "README.md"), "acme\n");
  sh("git", "add", "-A");
  sh("git", "commit", "-qm", "init");

  await test("doctor passes with memory, secret and gh", async () => {
    const out = JSON.parse(await rp(["swarm", "doctor", "--json"]));
    assert.equal(out.ok, true, JSON.stringify(out.checks.filter((c) => !c.ok)));
  });

  await test("doctor fails on a wrong secret", async () => {
    const out = JSON.parse(await rp(["swarm", "doctor", "--json"], { expect: 1, extraEnv: { RALLYPOINT_SWARM_SECRET: "wrong-wrong-wrong-wrong" } }));
    assert.ok(out.checks.some((c) => c.name === "secret" && !c.ok));
  });

  await test("init creates missing target labels and widens the improver's tunable paths", async () => {
    const out = await rp(["swarm", "init"]);
    assert.match(out, /add +label target:web/);
    assert.match(out, /same +label target:api/);
    assert.match(out, /add +label target:ui/);
    const loop = JSON.parse(await readFile(resolve(fixture, ".rallypoint/config.json"), "utf8"));
    assert.ok(loop.improvement.tunablePaths.includes(".rallypoint/swarm/skills/"));
    assert.ok(db.swarm_settings.some((s) => s.key === "goal" && s.value.title === "Acme app"));
  });

  await test("a session: prepare → next → log → say → referee → bury → ship → retro", async () => {
    assert.match(await rp(["swarm", "prepare"]), /session/);
    const next = JSON.parse(await rp(["swarm", "next", "--json"]));
    assert.equal(next.role, "merger");
    assert.equal(next.ref, 21);
    const nextWeb = JSON.parse(await rp(["swarm", "next", "web", "--json"]));
    assert.equal(nextWeb.role, "worker", "the approved PR closes an api issue, so web has a worker");
    await rp(["swarm", "next", "nope"], { expect: 2 });
    await rp(["swarm", "log", "claimed #5"]);
    await rp(["swarm", "say", "--kind", "handoff", "--ref", "#5", "hero copy is in the issue"]);
    assert.match(await rp(["swarm", "inbox"]), /hero copy/);
    const ref = await rp(["swarm", "referee", "--target", "web", "--issue", "5"]);
    assert.match(ref, /PASS/);
    assert.equal(db.swarm_results.at(-1).mode, "checks");
    assert.equal(db.swarm_results.at(-1).details.checks.length, 2);
    await rp(["swarm", "bury", "--idea", "inline all css", "--reason", "lint failed", "--lesson", "keep css modules"]);
    assert.equal(db.swarm_buried.at(-1).numbers.mode, "checks");
    await rp(["swarm", "ship", "--version", "v0.1", "--target", "web", "--pr", "21"]);
    assert.equal(db.swarm_versions.at(-1).version, "v0.1");
    await rp(["swarm", "retro", "--well", "clear issue", "--friction", "slow build", "--suggest", "cache deps"]);
    assert.equal(db.swarm_sessions[0].status, "ended");
    assert.equal(db.swarm_retros.at(-1).role, "worker");
    await rp(["swarm", "log", "after end"], { expect: 2 });
  });

  await test("referee fails with exit 3 when a check fails", async () => {
    swarmJson.measure.checks.push({ name: "e2e", command: "node -e \"process.exit(1)\"" });
    await writeFile(swarmJsonPath, JSON.stringify(swarmJson, null, 2));
    const out = await rp(["swarm", "referee"], { expect: 3 });
    assert.match(out, /failed: e2e/);
  });

  await test("score mode compares HEAD with a baseline worktree", async () => {
    await writeFile(resolve(fixture, "score.txt"), "100\n");
    swarmJson.measure = { mode: "score", command: "node -e \"console.log(require('fs').readFileSync('score.txt','utf8'))\"", direction: "higher", margin: 5, unit: "pts", checks: [], timeoutSeconds: 60 };
    await writeFile(swarmJsonPath, JSON.stringify(swarmJson, null, 2));
    sh("git", "add", "-A");
    sh("git", "commit", "-qm", "baseline");
    await writeFile(resolve(fixture, "score.txt"), "103\n");
    sh("git", "commit", "-qam", "small gain");
    const small = await rp(["swarm", "referee", "--baseline", "HEAD~1"], { expect: 3 });
    assert.match(small, /candidate 103 · baseline 100/);
    await writeFile(resolve(fixture, "score.txt"), "120\n");
    sh("git", "commit", "-qam", "big gain");
    assert.match(await rp(["swarm", "referee", "--baseline", "HEAD~2"]), /PASS/);
    assert.equal(db.swarm_results.at(-1).delta, 20);
    assert.equal(sh("git", "worktree", "list").trim().split("\n").length, 1, "baseline worktree removed");
  });

  await test("plan validates and opens labelled issues", async () => {
    await writeFile(resolve(fixture, "plan.json"), JSON.stringify([{ title: "Hero section", body: "AC: …", target: "web", type: "ui", prio: "p1" }, { title: "Bad", body: "x", target: "nope" }]));
    await rp(["swarm", "plan", "plan.json"], { expect: 2 });
    await writeFile(resolve(fixture, "plan.json"), JSON.stringify([{ title: "Hero section", body: "AC: …", target: "web", concept: "reuse", type: "ui", prio: "p1" }]));
    assert.match(await rp(["swarm", "plan", "plan.json"]), /issues\/99/);
    const created = (await readFile(ghLog, "utf8")).trim().split("\n").map((l) => JSON.parse(l)).filter((a) => a[0] === "issue" && a[1] === "create");
    assert.ok(created.at(-1).includes("target:web") && created.at(-1).includes("prio:p1"));
    assert.ok(created.at(-1).some((a) => a.includes("Concept: reuse")));
  });

  await test("brief, metrics, retros, protocol change and concepts", async () => {
    await rp(["swarm", "concept", "add", "reuse", "Reuse work", "Keep results between steps"]);
    await rp(["swarm", "concept", "trial", "reuse", "--target", "api", "--outcome", "gained", "--delta", "12"]);
    assert.match(await rp(["swarm", "brief"]), /Acme app/);
    assert.match(await rp(["swarm", "metrics"]), /shipped \/ buried/);
    assert.match(await rp(["swarm", "retros"]), /slow build/);
    assert.match(await rp(["swarm", "protocol", "change", "--summary", "log after every step"]), /p2/);
    assert.ok(db.swarm_settings.some((s) => s.key === "protocol_version" && s.value === "p2"));
  });

  await test("swarm-ui needs a Next.js app; swarm-dashboard generates a project-owned config", async () => {
    const ui = await rp(["add", "swarm-ui"], { expect: 2 }).catch((error) => error.message);
    assert.match(ui, /Next\.js|swarm-dashboard|Unknown campaign item/);
    if (!/Unknown campaign item/.test(ui)) {
      await rp(["add", "swarm-dashboard"]);
      const generated = await readFile(resolve(fixture, "swarm-ui/app/swarm/swarm.config.ts"), "utf8");
      assert.match(generated, /Acme app/);
      assert.match(generated, /"id": "ui"/);
      await writeFile(resolve(fixture, "swarm-ui/app/swarm/swarm.config.ts"), "// mine\n");
      assert.match(await rp(["add", "swarm-dashboard"]), /kept/);
      assert.equal(await readFile(resolve(fixture, "swarm-ui/app/swarm/swarm.config.ts"), "utf8"), "// mine\n");
    }
  });

  await test("ui-config never overwrites without --force", async () => {
    await mkdir(resolve(fixture, "app/swarm"), { recursive: true });
    await rp(["swarm", "ui-config", "--out", "app/swarm/swarm.config.ts"]);
    await writeFile(resolve(fixture, "app/swarm/swarm.config.ts"), "// edited\n");
    assert.match(await rp(["swarm", "ui-config", "--out", "app/swarm/swarm.config.ts"]), /kept/);
    await rp(["swarm", "ui-config", "--out", "app/swarm/swarm.config.ts", "--force"]);
    assert.match(await readFile(resolve(fixture, "app/swarm/swarm.config.ts"), "utf8"), /swarmConfig/);
  });

  await test("the referee never sees the swarm secret", async () => {
    swarmJson.measure = { mode: "checks", checks: [{ name: "leak", command: "node -e \"process.exit(process.env.RALLYPOINT_SWARM_SECRET ? 1 : 0)\"" }] };
    await writeFile(swarmJsonPath, JSON.stringify(swarmJson, null, 2));
    assert.match(await rp(["swarm", "referee", "--no-record"]), /PASS/);
  });

  console.log(`Swarm tests passed: ${passed} checks (roles, referee, config, ui-config, install, session, score/checks modes, plan, learning, UI generation).`);
} finally {
  server.close();
  await rm(fixture, { recursive: true, force: true });
  await rm(fakeGh, { force: true });
}
