#!/usr/bin/env node

// Rallypoint Swarm: unit tests for the pure modules, plus an offline
// end-to-end run of the CLI against an in-process fake of PostgREST and a fake
// `gh`. No network, no real Supabase, no real GitHub.
//
//   npm run swarm:test        (builds the registry first)

import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { chmod, mkdtemp, readdir, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { createServer } from "node:http";
import { register } from "node:module";
import { tmpdir } from "node:os";
import { delimiter, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const cli = resolve(root, "packages/cli/bin/rallypoint.mjs");
const lib = (name) => import(pathToFileURL(resolve(root, "registry/rallypoint/swarm/lib", name)).href);

const { computeQueues, pickRole, referencedIssues } = await lib("roles.mjs");
const { parseScore, compareScores, referee, validateMeasure } = await lib("referee.mjs");
const { parseSwarmConfig, allTargets } = await lib("config.mjs");
const { renderUiConfig, uiConfigFrom } = await lib("ui-config.mjs");
const { dispatchCodexCloud } = await lib("codex-cloud.mjs");
const { dispatchLocal, doctorRuntime } = await lib("local-runtime.mjs");

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

const cloudUrl = "https://chatgpt.com/codex/tasks/task_i_test";

await test("Codex Cloud dispatch submits once and waits through a nonzero pending status", async () => {
  const calls = [];
  const responses = [
    { status: 0, stdout: `Using Codex Cloud\nTask created: ${cloudUrl}\n` },
    { status: 1, stdout: "[PENDING] CMS worker\n" },
    { status: 0, stdout: "[READY] CMS worker\n" },
  ];
  const result = await dispatchCodexCloud({
    cwd: "/test", environment: "Vienna", branch: "main", prompt: "$swarm-agent",
    onSubmitted: (url) => calls.push(url),
  }, {
    run: (args, options) => {
      calls.push([args, options]);
      return responses.shift();
    },
    wait: async (delay) => calls.push(delay),
  });
  assert.deepEqual(result, { taskUrl: cloudUrl, status: "ready" });
  assert.deepEqual(calls, [
    [["cloud", "exec", "--env", "Vienna", "--branch", "main", "--attempts", "1", "-"],
      { cwd: "/test", input: "$swarm-agent" }],
    cloudUrl,
    [["cloud", "status", cloudUrl], { cwd: "/test", timeout: 60_000 }],
    15_000,
    [["cloud", "status", cloudUrl], { cwd: "/test", timeout: 60_000 }],
  ]);
});

await test("Codex Cloud dispatch stops after three unknown statuses and retains the task URL", async () => {
  const responses = [{ status: 0, stdout: cloudUrl }, ...Array(3).fill({ status: 1, stdout: "" })];
  await assert.rejects(dispatchCodexCloud({
    environment: "Vienna", branch: "main", prompt: "$swarm-agent", onSubmitted: () => {},
  }, { run: () => responses.shift(), wait: async () => {} }), (error) => error.message.includes(cloudUrl));
  assert.equal(responses.length, 0);
});

await test("Codex Cloud dispatch retries status failures without resubmitting", async () => {
  const responses = [
    { status: 0, stdout: cloudUrl },
    { status: 1 },
    { status: 1 },
    { status: 0, stdout: "[READY] CMS worker" },
  ];
  const result = await dispatchCodexCloud({
    environment: "Vienna", branch: "main", prompt: "$swarm-agent", onSubmitted: () => {},
  }, { run: () => responses.shift(), wait: async () => {} });
  assert.equal(result.status, "ready");
  assert.equal(responses.length, 0);
});

await test("Codex Cloud dispatch stops polling when the wait limit expires", async () => {
  let now = 0;
  const timeouts = [];
  await assert.rejects(dispatchCodexCloud({
    environment: "Vienna", branch: "main", prompt: "$swarm-agent", onSubmitted: () => {},
    maxWaitMs: 20_000,
  }, {
    run: (args, { timeout }) => {
      if (args[1] === "exec") return { status: 0, stdout: cloudUrl };
      timeouts.push(timeout);
      return { status: 1, stdout: "[PENDING] CMS worker" };
    },
    now: () => now,
    wait: async (delay) => { now += delay; },
  }), /Keep the slot reserved/);
  assert.equal(now, 20_000);
  assert.deepEqual(timeouts, [20_000, 5_000]);
});

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
  assert.equal(parseScore("elo 1530 ± 40"), 1530, "the first number, not the error bar");
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
  const noBaseline = referee({ measure: { mode: "score", command: "new" }, runCommand, cwd: "head" });
  assert.equal(noBaseline.passed, false, "score mode fails closed without a baseline");
  assert.equal(referee({ measure: { mode: "score", command: "new" }, runCommand, cwd: "head", requireBaseline: false }).passed, true, "--first");
  const brokenBaseline = referee({ measure: { mode: "score", command: "new" }, runCommand: (cmd, { cwd }) => (cwd === "base" ? { status: 2, stdout: "", stderr: "boom", durationMs: 1 } : runCommand("new")), cwd: "head", baselineCwd: "base" });
  assert.equal(brokenBaseline.passed, false, "a baseline that cannot be measured is not beaten");
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

// #70: the scaffold must build with Next.js 16 Cache Components on and off,
// as installed. Route segment config like `dynamic` fails that build, a page
// needs a Suspense boundary in its own folder so a navigation between two
// /swarm pages is instant, and nothing may read request data in the layout
// outside <Suspense>.
await test("swarm-ui builds under Cache Components: no segment config, a boundary per route", async () => {
  const app = resolve(root, "registry/rallypoint/swarm-ui/app/swarm");
  const files = (await readdir(app, { recursive: true })).map((file) => file.split("\\").join("/"));
  const pages = files.filter((file) => /(^|\/)page\.tsx$/.test(file) && !file.startsWith("_"));
  assert.ok(pages.length >= 18, `expected the scaffold's pages, found ${pages.length}`);
  for (const file of files.filter((name) => /\.(ts|tsx)$/.test(name))) {
    const source = await readFile(resolve(app, file), "utf8");
    assert.doesNotMatch(source, /^export const (dynamic|revalidate|fetchCache|dynamicParams)\b/m, `${file} exports route segment config`);
  }
  for (const page of pages) {
    const folder = page.replace(/\/?page\.tsx$/, "");
    const loading = folder ? `${folder}/loading.tsx` : "loading.tsx";
    assert.ok(files.includes(loading), `${page} has no ${loading}`);
  }
  const queries = await readFile(resolve(app, "_lib/queries.ts"), "utf8");
  assert.match(queries, /getSwarmContext = cache\(async \(\): Promise<SwarmContext> => \{\r?\n  await connection\(\);/, "getSwarmContext waits for a request first");
  const layout = await readFile(resolve(app, "layout.tsx"), "utf8");
  assert.match(layout, /export default function SwarmLayout/, "the layout itself does not await");
  assert.match(layout, /<Suspense fallback=\{null\}>\s*<TopBarStatus \/>/, "the top bar's request-time part streams in its own boundary");
  const nav = await readFile(resolve(app, "_components/nav.tsx"), "utf8");
  assert.match(nav, /<Suspense fallback=\{<NavLinks \{\.\.\.props\} pathname=\{null\} \/>\}>/, "usePathname() sits behind a Suspense boundary");
  const manifest = JSON.parse(await readFile(resolve(root, "registry/manifest.json"), "utf8"));
  for (const name of ["swarm-ui", "swarm-dashboard"]) {
    const sources = new Set(manifest.items.find((item) => item.name === name).files.map((file) => file.source));
    for (const file of files.filter((entry) => entry.endsWith("loading.tsx") || entry === "sign-in/sign-out.tsx")) {
      assert.ok(sources.has(`swarm-ui/app/swarm/${file}`), `${name} does not ship ${file}`);
    }
  }
});

// With Cache Components, pages you leave stay mounted but hidden (React
// <Activity>), so nothing may assume a page unmounts.
await test("swarm-ui does not assume a page unmounts", async () => {
  const app = resolve(root, "registry/rallypoint/swarm-ui/app/swarm");
  const skills = await readFile(resolve(app, "skills/page.tsx"), "utf8");
  assert.doesNotMatch(skills, /id="file"|\}#file`/, "the skills viewer's anchor is unique per file");
  const signOut = await readFile(resolve(app, "sign-in/sign-out.tsx"), "utf8");
  assert.match(signOut, /window\.location\.assign/, "signing out is a full page load");
  const layout = await readFile(resolve(app, "layout.tsx"), "utf8");
  assert.doesNotMatch(layout, /action=\{signOut\}/, "the top bar signs out through <SignOut>");
});

await test("swarm.css keeps the main column's padding when a hidden overview stays mounted", async () => {
  // Under Cache Components a page navigated away from stays mounted in <main>,
  // hidden by <Activity>. A selector keyed on <main> containing the overview
  // keeps matching it, and strips every other page's padding.
  const css = (await readFile(resolve(root, "registry/rallypoint/swarm-ui/app/swarm/swarm.css"), "utf8")).replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(css, /:has\(\s*>?\s*\.rp-overview\b/, "no rule may key the main column on the overview being mounted");
  const overview = css.match(/\.rp-main\s*>\s*\.rp-overview\s*\{([^}]*)\}/);
  assert.ok(overview, "the overview cancels the padding itself");
  assert.match(overview[1], /margin:\s*calc\(-1 \* var\(--rp-main-top\)\) calc\(-1 \* var\(--rp-gutter\)\) calc\(-1 \* var\(--rp-main-bottom\)\)/);
});

await test("swarm-ui: one header badge — Live while a session works, Idle otherwise", async () => {
  const swarmDir = resolve(root, "registry/rallypoint/swarm-ui/app/swarm");
  const layout = await readFile(resolve(swarmDir, "layout.tsx"), "utf8");
  assert.doesNotMatch(layout, /\{working\} working\r?\n/, "the activity badge no longer reads \"N working\"");
  assert.match(layout, /className="rp-live rp-live-on"[\s\S]*?\r?\n\s*Live\r?\n/, "a working swarm reads Live");
  assert.match(layout, /className="rp-live"[\s\S]*?\r?\n\s*Idle\r?\n/, "an idle swarm reads Idle");
  const live = await readFile(resolve(swarmDir, "_components/live.tsx"), "utf8");
  assert.match(live, /if \(shown === "live"\) \{\s*return \(\s*<span className="rp-visually-hidden" role="status">/, "a healthy connection shows no second badge");
});

await test("swarm-ui: every prompt, command and file block has a copy button", async () => {
  const swarmDir = resolve(root, "registry/rallypoint/swarm-ui/app/swarm");
  const files = (await readdir(swarmDir, { recursive: true }))
    .map((file) => file.split("\\").join("/"))
    .filter((f) => f.endsWith(".tsx"));
  const copy = await readFile(resolve(swarmDir, "_components/copy.tsx"), "utf8");
  assert.match(copy, /^"use client";/, "only the button is a client component");
  assert.match(copy, /navigator\.clipboard\?\.writeText/);
  assert.match(copy, /selectNodeContents/, "falls back to selecting the shown text");
  assert.match(copy, /aria-live="polite"/);
  assert.match(copy, /<button aria-label=\{label\}[^>]*type="button"/);
  for (const file of files) {
    const source = await readFile(resolve(swarmDir, file), "utf8");
    const pres = source.match(/<pre\b/g)?.length ?? 0;
    if (file === "_components/states.tsx") {
      assert.equal(pres, 1, "states.tsx renders <pre> only inside CopyBlock");
      assert.match(source, /<CopyButton label=\{label\} targetId=\{id\} text=\{text\} \/>[\s\S]*<pre className=\{className\} id=\{id\}/);
      assert.doesNotMatch(source, /"use client"/, "CopyBlock stays server-rendered");
    } else {
      assert.equal(pres, 0, `${file} renders a <pre> without a copy button; use CopyBlock`);
    }
  }
  for (const page of ["protocol/page.tsx", "skills/page.tsx"]) {
    const source = await readFile(resolve(swarmDir, page), "utf8");
    assert.match(source, /<CopyBlock/, `${page} uses CopyBlock`);
    assert.doesNotMatch(source, /"use client"/, `${page} stays server-rendered`);
  }
  const protocol = await readFile(resolve(swarmDir, "protocol/page.tsx"), "utf8");
  assert.match(protocol, /text=\{data\.repoUrl \? `Repository: \$\{data\.repoUrl\}\\n\$\{prompt\.prompt\}` : prompt\.prompt\}/, "copies the prompt with its Repository: line");
});

// The message board's grouping and filters live in a type-only TypeScript
// module so the dashboard and this script share one implementation. Node 22.18+
// strips the types; CI runs Node 24.
const threads = await import(pathToFileURL(resolve(root, "registry/rallypoint/swarm-ui/app/swarm/_lib/threads.ts")).href);

const msg = (id, minute, extra = {}) => ({
  id,
  thread_id: null,
  session_id: null,
  author: "worker-1",
  kind: "note",
  ref: null,
  topic: null,
  body: `message ${id}`,
  created_at: `2026-11-26T10:${String(minute).padStart(2, "0")}:00Z`,
  ...extra,
});

await test("message board: threads group replies of replies under their root, newest activity first", () => {
  const rows = [
    msg(1, 0, { kind: "question", topic: "Which cache?", ref: "#12" }),
    msg(2, 5, { kind: "handoff", author: "planner-1", body: "Take #14 next\nsecond line" }),
    msg(3, 10, { thread_id: 1, kind: "answer", author: "reviewer-1" }),
    msg(4, 20, { thread_id: 3, author: "worker-2", body: "see pr#15" }),
    msg(5, 15, { thread_id: 99, body: "orphan: parent outside the page" }),
  ];
  const built = threads.buildThreads([...rows].reverse());
  assert.deepEqual(built.map((t) => t.root.id), [1, 5, 2], "newest activity first; an orphan starts its own thread");
  const [first] = built;
  assert.deepEqual(first.replies.map((m) => m.id), [3, 4], "replies of replies join the root, oldest first");
  assert.equal(first.lastAt, rows[3].created_at);
  assert.deepEqual(first.authors, ["worker-1", "reviewer-1", "worker-2"]);
  assert.deepEqual(first.refs, ["#12", "#15"], "the ref column and refs cited in bodies");
  assert.equal(first.waiting, null, "an answered question waits for nothing");
  const handoff = built.find((t) => t.root.id === 2);
  assert.equal(handoff.waiting, "unacknowledged");
  assert.equal(threads.threadTitle(handoff.root), "Take #14 next", "the first line when there is no topic");
  assert.equal(threads.threadTitle(first.root), "Which cache?");
  assert.equal(threads.threadHeading(handoff.root), "Hand-off from planner-1", "a thread page without a topic names who posted what");
  assert.equal(threads.threadHeading(first.root), "Which cache?");
  assert.equal(threads.buildThreads([msg(1, 0, { kind: "question" })])[0].waiting, "unanswered");
  const pickedUp = threads.buildThreads([
    msg(1, 0, { kind: "handoff", author: "reviewer-cms-25", ref: "#25" }),
    msg(2, 5, { kind: "handoff", author: "fixer-cms-25", ref: "#25" }),
    msg(3, 6, { kind: "handoff", author: "fixer-cms-25", ref: "PR #25" }),
  ]);
  assert.equal(pickedUp.find((t) => t.root.id === 1).waiting, null, "a later message by another agent on the same ref picks a hand-off up");
  assert.equal(pickedUp.find((t) => t.root.id === 3).waiting, "unacknowledged", "the newest hand-off on a ref still waits");
  const known = ["reviewer", "worker"];
  assert.equal(threads.roleOf({ author: "reviewer-cms-25b", session_id: "s1" }, {}, known), "reviewer", "the author's role prefix");
  assert.equal(threads.roleOf({ author: "reviewer-cms-25b", session_id: "s1" }, { s1: "merger" }, known), "merger", "the session's role wins");
  assert.equal(threads.roleOf({ author: "operator", session_id: null }, {}, known), null);
  const cycle = threads.buildThreads([msg(1, 0, { thread_id: 2 }), msg(2, 1, { thread_id: 1 })]);
  assert.equal(cycle.length, 1, "a thread_id cycle cannot loop forever");
});

await test("message board: kind and ref filters come from the URL and match whole threads", () => {
  const built = threads.buildThreads([
    msg(1, 0, { kind: "question", ref: "PR #12" }),
    msg(2, 1, { thread_id: 1, kind: "answer" }),
    msg(3, 2, { kind: "proposal", body: "about #7" }),
  ]);
  assert.deepEqual(threads.parseThreadFilter({ kind: "answer", ref: "12" }), { kind: "answer", ref: "#12" });
  assert.deepEqual(threads.parseThreadFilter({ kind: "nonsense", ref: ["#7", "8"] }), { ref: "#7" });
  assert.deepEqual(threads.parseThreadFilter({}), {});
  const ids = (filter) => threads.filterThreads(built, filter).map((t) => t.root.id);
  assert.deepEqual(ids({ kind: "answer" }), [1], "a kind matches when any message in the thread has it");
  assert.deepEqual(ids({ kind: "proposal" }), [3]);
  assert.deepEqual(ids({ ref: "#12" }), [1], "`PR #12` and `12` are the same ref");
  assert.deepEqual(ids({ ref: "#7" }), [3], "a ref cited only in the body counts");
  assert.deepEqual(ids({ kind: "question", ref: "#7" }), []);
  assert.equal(threads.threadFilterHref({ kind: "question", ref: "#12" }), "/swarm/messages?kind=question&ref=12");
  assert.equal(threads.threadFilterHref({}), "/swarm/messages");
  assert.deepEqual(threads.refCounts(built), [["#7", 1], ["#12", 1]]);
  assert.equal(threads.kindCounts(built).question, 1);
  assert.equal(threads.kindCounts(built).answer, 1);
  assert.equal(threads.refKey("  "), null);
  assert.equal(threads.refKey("design-doc"), "design-doc");
});

await test("message board: bodies link #n and msg#n, and leave entities and URLs alone", () => {
  const segments = threads.textSegments("Fixes #12 (see pr#3, msg#40) at https://x.test/a#9 &#39;ok&#39; #4");
  assert.deepEqual(
    segments.filter((s) => s.type !== "text").map((s) => [s.type, s.text]),
    [["issue", "#12"], ["issue", "pr#3"], ["message", "msg#40"], ["issue", "#4"]],
  );
  assert.equal(segments.map((s) => s.text).join(""), "Fixes #12 (see pr#3, msg#40) at https://x.test/a#9 &#39;ok&#39; #4");
});

// The swarm UI's fleet graph adapter is TypeScript that a Next.js app compiles.
// Node strips its types (on by default since Node 22.18 / 23.6); its relative
// imports are extensionless, as the app's bundler expects, so resolve them to
// the .ts file here.
if (process.features.typescript) {
  register(
    `data:text/javascript,${encodeURIComponent(`
      export async function resolve(specifier, context, next) {
        try {
          return await next(specifier, context);
        } catch (error) {
          if (/^\\.\\.?\\//.test(specifier) && context.parentURL?.endsWith(".ts")) return next(specifier + ".ts", context);
          throw error;
        }
      }
    `)}`,
  );
  const ui = (name) => import(pathToFileURL(resolve(root, "registry/rallypoint/swarm-ui/app/swarm", name)).href);
  const { toSwarmInput, OTHER_SECTOR } = await ui("_lib/fleet-graph.ts");
  const { buildSwarmGraph } = await ui("_graph/model.ts");
  const { planReplay } = await ui("_graph/replay.ts");

  const NOW = Date.parse("2026-11-26T12:00:00Z");
  const ago = (hours) => new Date(NOW - hours * 3_600_000).toISOString();
  const target = (id) => ({ id, name: id.toUpperCase(), color: "#123456", description: "" });
  const session = (id, fields) => ({
    id, agent: null, role: null, target: null, issue: null, pr: null, status: "ended", summary: null,
    started_at: ago(10), last_seen_at: ago(9), ended_at: ago(9), ...fields,
  });
  const gh = (number, fields) => ({
    number, title: `Item ${number}`, url: `https://github.com/o/r/issues/${number}`, isPullRequest: false, state: "open",
    stateReason: null, mergedAt: null, labels: [], author: null, updatedAt: ago(5), createdAt: ago(20), closedAt: null, closes: [], ...fields,
  });
  const labels = (...names) => names.map((name) => ({ name, color: "ededed" }));
  const empty = { sessions: [], progress: [], results: [], versions: [], buried: [], protocolChanges: [] };

  await test("fleet graph: GitHub labels stage the work, sessions place the agents", () => {
    const input = toSwarmInput({
      ...empty,
      now: NOW,
      integrationBranch: "release",
      targets: [target("api"), target("web")],
      sessions: [
        session("s1", { agent: "ada", role: "worker", target: "api", issue: 1, status: "working", started_at: ago(1), last_seen_at: ago(0.1), ended_at: null }),
        session("s0", { agent: "ada", role: "planner", started_at: ago(30), last_seen_at: ago(29), ended_at: ago(29) }),
        session("s2", { agent: "bo", role: "reviewer", target: "web", issue: 2, pr: 5, status: "working", started_at: ago(5), last_seen_at: ago(3), ended_at: null }),
      ],
      progress: [{ id: 1, session_id: "s1", note: "Token bucket in place", created_at: ago(0.2) }],
      results: [{ id: 7, session_id: "s2", target: "web", issue: 2, pr: 5, passed: false, delta: null, created_at: ago(4) }],
      versions: [{ id: 3, target: "web", version: "v1", pr: 6, created_at: ago(2) }],
      buried: [{ id: 4, target: "api", issue: 3, pr: null, idea: "Cache everything", created_at: ago(8) }],
      protocolChanges: [{ id: 2, version: "1.1", summary: "Name the criterion", created_at: ago(12) }],
      github: [
        gh(1, { labels: labels("target:api", "status:claimed") }),
        gh(2, { labels: labels("target:web") }),
        gh(3, { state: "closed", stateReason: "not_planned", closedAt: ago(8) }),
        gh(4, { labels: labels("status:blocked") }),
        gh(5, { isPullRequest: true, closes: [2], labels: labels("status:changes-requested") }),
        gh(6, { isPullRequest: true, state: "closed", mergedAt: ago(2), closedAt: ago(2), closes: [7] }),
        gh(7, { labels: labels("target:web"), state: "closed", stateReason: "completed", closedAt: ago(2) }),
      ],
    });
    assert.equal(input.integrationBranch, "release");
    assert.equal(input.asOf, new Date(NOW).toISOString());
    assert.deepEqual(input.sectors.map((s) => s.id), ["api", "web", OTHER_SECTOR], "targets, then Other for #4");
    const stage = Object.fromEntries(input.workItems.map((w) => [w.id, w.stage]));
    assert.deepEqual(stage, { "issue-1": "claimed", "issue-2": "changes", "issue-3": "closed", "issue-4": "held", "issue-7": "merged" });
    const one = input.workItems.find((w) => w.id === "issue-1");
    assert.equal(one.branch, "agent/1-item-1", "the branch claim.mjs prescribes");
    assert.equal(input.workItems.find((w) => w.id === "issue-2").pr, 5, "joined by Closes #2");
    assert.equal(input.workItems.find((w) => w.id === "issue-7").sector, "web");
    const ada = input.agents.find((a) => a.id === "ada");
    assert.equal(ada.status, "working");
    assert.equal(ada.role, "worker", "the latest session's role");
    assert.equal(ada.workItem, "issue-1");
    assert.equal(ada.activity, "Token bucket in place");
    assert.equal(input.agents.find((a) => a.id === "bo").status, "idle", "working but silent for over two hours");
    const ids = new Set(input.events.map((e) => e.id));
    for (const id of ["session:s1:start", "progress:1", "result:7", "version:3", "buried:4", "protocol:2", "gh:pr:5:changes", "gh:pr:6:merged", "gh:issue:1:claimed"])
      assert.ok(ids.has(id), `event ${id}`);
    assert.ok(!ids.has("gh:issue:3:opened"), "a not-planned issue is not history");
    assert.equal(input.events.find((e) => e.id === "result:7").outcome, "loss");
    assert.equal(input.events.find((e) => e.id === "result:7").workItem, "issue-2");
    assert.equal(input.sectors.find((s) => s.id === "web").count.value, 1, "one merged pull request");

    const graph = buildSwarmGraph(input);
    assert.ok(graph.nodes.some((n) => n.id === "hub:release"));
    assert.ok(graph.flows.some((f) => f.kind === "merge"), "the merge flows through the trunk");
    const whole = planReplay(graph.flows, graph.hubId, { mode: "all" });
    assert.equal(whole.flows.length, graph.flows.length, "the whole run replays every flow");
    assert.equal(whole.startAt, graph.flows[0].at);
  });

  await test("fleet graph degrades: no GitHub, no memory, one target", () => {
    const bare = toSwarmInput({ ...empty, now: NOW, integrationBranch: "main", targets: [], github: null });
    assert.deepEqual(bare.sectors, [], "nothing to place, nothing invented");
    assert.equal(bare.events.length, 0);
    assert.ok(buildSwarmGraph(bare).nodes.some((n) => n.kind === "hub"), "still draws the trunk");

    const memoryOnly = toSwarmInput({
      ...empty,
      now: NOW,
      integrationBranch: "main",
      targets: [target("main")],
      github: null,
      sessions: [session("s1", { agent: "ada", role: "worker", issue: 9, status: "working", last_seen_at: ago(0.5), ended_at: null })],
      versions: [{ id: 1, target: "main", version: "v2", pr: 3, created_at: ago(1) }],
    });
    assert.deepEqual(memoryOnly.workItems.map((w) => [w.id, w.stage, w.sector]), [["issue-9", "claimed", "main"]], "the one target takes untargeted work");
    assert.deepEqual(memoryOnly.sectors[0].count, { value: 1, unit: "shipped", recent: 1, recentUnit: "today" });
    assert.ok(memoryOnly.events.some((e) => e.id === "version:1"));
  });

  await test("fleet progress, sector classification, and quiet past effort", async () => {
    const { deliveryOf } = await ui("_lib/github.ts");
    const selected = [
      gh(1, { labels: labels("target:api", "status:claimed") }),
      gh(2, { state: "closed", stateReason: "completed" }),
      gh(3, { state: "closed", stateReason: "not_planned" }),
      gh(4, {}),
      gh(5, {}),
      gh(6, {}),
      gh(7, { isPullRequest: true, closes: [4], labels: labels("review:approved") }),
      gh(8, { isPullRequest: true, closes: [5] }),
      gh(9, { isPullRequest: true, closes: [2], state: "closed", mergedAt: ago(1) }),
      gh(10, { isPullRequest: true, labels: labels("documentation") }),
      gh(11, { isPullRequest: true, closes: [1] }),
      gh(12, { isPullRequest: true }),
      gh(13, { isPullRequest: true }),
      gh(14, { labels: labels("status:claimed") }),
    ];

    assert.deepEqual(deliveryOf(selected), {
      total: 6, merged: 1, approved: 1, inReview: 2, inBranch: 1, open: 1,
    });
    const input = toSwarmInput({
      ...empty, now: NOW, integrationBranch: "main",
      targets: [target("api")],
      fleetSectors: [
        { id: "site", match: { paths: ["app/swarm/**"] } },
        { id: "protocol", match: { labels: ["documentation"] } },
      ],
      changedPaths: new Map([[8, ["app/swarm/fleet/page.tsx"]], [10, ["app/swarm/page.tsx"]], [11, ["app/swarm/page.tsx"]]]),
      sessions: [
        session("past", { agent: "past", target: "api", issue: 1 }),
        session("live", { agent: "live", target: "api", status: "working", last_seen_at: ago(0.01), ended_at: null }),
      ],
      github: selected,
      versions: [{ id: 1, target: "api", version: "v2", score: 1680, created_at: ago(1) }],
    });
    const work = new Map(input.workItems.map((item) => [item.id, item]));
    assert.equal(work.get("issue-5").sector, "site");
    assert.equal(work.get("pr-10").sector, "protocol");
    assert.equal(work.get("issue-1").sector, "api");
    assert.equal(work.get("pr-12").sector, OTHER_SECTOR);
    assert.equal(input.sectors[0].score, 1680);
    assert.equal(input.sectors[0].version, "v2");

    const graph = buildSwarmGraph(input, { hideIdleAgents: true, groupPullRequests: true });
    assert.deepEqual(graph.nodes.filter((node) => node.kind === "agent").map((node) => node.agent.id), ["live"]);
    assert.equal(graph.nodes.find((node) => node.id === "sector:api").pastAgents, 1);
    const grouped = graph.nodes.find((node) => node.workItem?.groupedPullRequests);
    assert.ok(grouped, "same-sector pull requests with the same stage share a marker");
    assert.ok(graph.flows.some((flow) => flow.path.includes(grouped.id)), "replay routes events through the grouped marker");
  });

  const { ANIMALS, animalOf, assignAnimals, preferredAnimalIndex } = await ui("_lib/animals.ts");

  await test("fleet graph animals: stable per id, distinct within a fleet, order-free", () => {
    assert.ok(ANIMALS.length >= 64, "Arena's set");
    assert.equal(new Set(ANIMALS.map((a) => a.name)).size, ANIMALS.length, "every animal has its own name");
    for (const a of ANIMALS) assert.match(a.d, /^[Mm]/, `${a.slug} is one SVG path`);

    const fleet = [
      "worker-cms-6", "worker-cms-7", "worker-leads-12", "worker-outreach-3", "worker-seo-9", "worker-2", "worker",
      "reviewer-outreach-24", "reviewer-cms-8", "reviewer-leads-13", "reviewer-2",
      "fixer-leads-26b", "fixer-cms-14", "fixer-seo-31", "merger-cms-25", "merger-leads-27",
      "planner", "janitor", "steward", "strategist", "session 1a2b3c4d",
    ];
    const assigned = assignAnimals(fleet);
    assert.equal(assigned.size, fleet.length);
    assert.equal(new Set(assigned.values()).size, fleet.length, "no two agents in one fleet share an animal");
    assert.deepEqual([...assignAnimals([...fleet].reverse(), undefined)], [...assigned], "the order rows arrive in does not matter");
    assert.deepEqual([...assignAnimals([...fleet, "worker-cms-6"])], [...assigned], "a repeated id is one agent");
    assert.equal(animalOf("worker-cms-6", assigned), animalOf("worker-cms-6", assignAnimals(fleet)), "the same on every load");
    assert.equal(animalOf("chess/search"), animalOf("chess-search"), "Arena's two spellings of a seat agree");

    // Two ids wanting one animal: the one that sorts first keeps it, the other probes to a free one.
    const ids = Array.from({ length: 400 }, (_, i) => `worker-${i}`);
    const [a, b] = ids.filter((id) => preferredAnimalIndex(id) === preferredAnimalIndex(ids[0])).sort();
    const pair = assignAnimals([b, a]);
    assert.equal(pair.get(a), preferredAnimalIndex(a));
    assert.notEqual(pair.get(b), pair.get(a));

    // An agent arriving later never displaces one already on screen.
    const shown = assignAnimals([b]);
    const later = assignAnimals([a, b], shown);
    assert.equal(later.get(b), shown.get(b));
    assert.notEqual(later.get(a), later.get(b));

    // More agents than animals: every one still gets an animal, the first ANIMALS.length all distinct.
    const crowd = assignAnimals(ids);
    assert.equal(crowd.size, ids.length);
    assert.equal(new Set(crowd.values()).size, ANIMALS.length);
  });
} else {
  console.log("(skipping the fleet graph adapter tests: this Node cannot strip TypeScript types)");
}

// ---------------------------------------------------------------------------
// swarm-ui setup and error banners (the TypeScript is loaded through Node's
// type stripping; the scaffold's own imports are extensionless, so the two
// modules are copied side by side with the import rewritten)
// ---------------------------------------------------------------------------

const uiLib = resolve(root, "registry/rallypoint/swarm-ui/app/swarm/_lib");
const uiTmp = await mkdtemp(resolve(tmpdir(), "rallypoint-swarm-ui-lib-"));
await writeFile(resolve(uiTmp, "package.json"), '{ "type": "module" }\n');
await writeFile(resolve(uiTmp, "guidance.ts"), await readFile(resolve(uiLib, "guidance.ts"), "utf8"));
await writeFile(
  resolve(uiTmp, "github.ts"),
  (await readFile(resolve(uiLib, "github.ts"), "utf8")).replace('from "./guidance"', 'from "./guidance.ts"'),
);
const guidance = await import(pathToFileURL(resolve(uiTmp, "guidance.ts")).href);
const FAKE_TOKEN = "github_pat_11FAKEFAKEFAKE_do-not-print-me";
const bannerText = (g) => JSON.stringify(g);
const noToken = (g, label) => {
  const text = bannerText(g);
  assert.ok(!text.includes(FAKE_TOKEN) && !text.includes("do-not-print-me") && !text.includes("11FAKE"), `${label}: never shows the token`);
  assert.ok(g.title && g.problem && g.steps.length > 0 && g.after, `${label}: what, steps and when`);
};

await test("GitHub banners: the cause, the steps and when it applies, never the token", () => {
  const repo = "acme/app";
  const anon404 = guidance.githubFailureGuidance({ status: 404, repo, token: undefined });
  noToken(anon404, "404 without token");
  assert.match(anon404.problem, /acme\/app/);
  assert.match(anon404.problem, /private or the name is wrong/);
  assert.ok(anon404.steps.some((s) => s.includes("https://github.com/settings/personal-access-tokens/new")));
  assert.ok(anon404.steps.some((s) => /Only select repositories → `acme\/app`/.test(s)));
  assert.ok(anon404.steps.some((s) => /Contents\*\*, \*\*Issues\*\* and \*\*Pull requests\*\* to Read-only/.test(s)));
  assert.ok(anon404.steps.some((s) => /RALLYPOINT_GITHUB_TOKEN/.test(s) && /Vercel/.test(s) && /Sensitive/.test(s) && /\.env\.local/.test(s)));
  assert.match(anon404.after, /redeploy/);

  const token404 = guidance.githubFailureGuidance({ status: 404, repo, token: FAKE_TOKEN });
  noToken(token404, "404 with token");
  assert.match(token404.problem, /token has no access to this repository, or the name is wrong/);
  assert.notEqual(token404.title, anon404.title);

  const bad = guidance.githubFailureGuidance({ status: 401, repo, token: FAKE_TOKEN });
  noToken(bad, "401");
  assert.match(bad.problem, /invalid, expired or revoked/);

  const limited = guidance.githubFailureGuidance({ status: 403, repo, token: FAKE_TOKEN, rateLimitRemaining: "0" });
  noToken(limited, "403 rate limited");
  assert.match(limited.title, /rate limit/);
  assert.doesNotMatch(limited.title, /permission/);
  const limitedAnon = guidance.githubFailureGuidance({ status: 403, repo, token: null, rateLimitRemaining: "0" });
  assert.match(limitedAnon.problem, /60 requests an hour/);

  const denied = guidance.githubFailureGuidance({ status: 403, repo, token: FAKE_TOKEN, rateLimitRemaining: "4999", resource: "contents" });
  noToken(denied, "403 permission");
  assert.match(denied.title, /permission/);
  assert.match(denied.problem, /Contents/);

  const noRepo = guidance.githubNoRepoGuidance(false);
  noToken(noRepo, "no repo");
  assert.match(noRepo.problem, /RALLYPOINT_GITHUB_REPO/);

  for (const g of [
    guidance.supabaseMissingGuidance(["NEXT_PUBLIC_RALLYPOINT_SUPABASE_URL"]),
    guidance.supabaseNoSchemaGuidance("x"),
    guidance.supabaseUnreachableGuidance("x"),
    guidance.privateGuidance(),
    guidance.notAllowedGuidance(),
    guidance.signInGuidance("Invalid login credentials"),
  ]) noToken(g, g.title);
  assert.ok(guidance.privateGuidance().steps.some((s) => s.includes("Authentication → Users → Add user")));
  assert.ok(guidance.privateGuidance().steps.some((s) => s.includes("Authentication → URL Configuration")));
  assert.ok(guidance.notAllowedGuidance().steps.some((s) => s.includes("swarm_readers")));
});

await test("Skills: an empty folder and a refused read are told apart", async () => {
  const github = await import(pathToFileURL(resolve(uiTmp, "github.ts")).href);
  const realFetch = globalThis.fetch;
  const saved = { repo: process.env.RALLYPOINT_GITHUB_REPO, token: process.env.RALLYPOINT_GITHUB_TOKEN };
  const respond = (routes) => {
    globalThis.fetch = async (url, init) => {
      const path = new URL(url).pathname;
      if (init?.headers?.Authorization) assert.equal(init.headers.Authorization, `Bearer ${FAKE_TOKEN}`);
      const status = routes(path) ?? 404;
      return new Response(status === 200 ? "[]" : "{}", { status, headers: { "x-ratelimit-remaining": "4000" } });
    };
  };
  try {
    process.env.RALLYPOINT_GITHUB_REPO = "acme/app";
    process.env.RALLYPOINT_GITHUB_TOKEN = FAKE_TOKEN;

    // The folder is missing, the repository's files are readable: empty.
    respond((p) => (p === "/repos/acme/app/contents/" ? 200 : 404));
    assert.deepEqual(await github.listDirectory(".rallypoint/roles"), { ok: true, data: [], truncated: false });

    // The token sees the repository but not its files (no Contents permission).
    respond((p) => (p === "/repos/acme/app" ? 200 : 404));
    const denied = await github.listDirectory(".rallypoint/roles");
    assert.equal(denied.ok, false);
    assert.match(denied.guidance.problem, /Contents/);
    noToken(denied.guidance, "contents denied");

    // GitHub refuses outright with 403.
    respond(() => 403);
    const refused = await github.listDirectory(".rallypoint/roles");
    assert.equal(refused.ok, false);
    assert.match(refused.guidance.title, /permission/);
    const file = await github.readFile(".rallypoint/roles/worker.md");
    assert.equal(file.ok, false);
    assert.match(file.guidance.problem, /Contents/);

    // No token, private repository: everything 404s.
    delete process.env.RALLYPOINT_GITHUB_TOKEN;
    respond(() => 404);
    const anon = await github.listDirectory(".rallypoint/roles");
    assert.equal(anon.ok, false);
    assert.match(anon.guidance.problem, /private or the name is wrong/);
    const items = await github.listItems();
    assert.equal(items.ok, false);
    assert.equal(items.message.includes("`"), false, "the one-line message is plain text");

    process.env.RALLYPOINT_GITHUB_TOKEN = FAKE_TOKEN;
    for (const status of [401, 403, 404]) {
      respond(() => status);
      noToken((await github.listItems()).guidance, `listItems ${status}`);
    }
  } finally {
    globalThis.fetch = realFetch;
    if (saved.repo === undefined) delete process.env.RALLYPOINT_GITHUB_REPO;
    else process.env.RALLYPOINT_GITHUB_REPO = saved.repo;
    if (saved.token === undefined) delete process.env.RALLYPOINT_GITHUB_TOKEN;
    else process.env.RALLYPOINT_GITHUB_TOKEN = saved.token;
    await rm(uiTmp, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// end to end: install + CLI against fake PostgREST and fake gh
// ---------------------------------------------------------------------------

const SECRET = "correct-horse-battery-staple";
const db = { swarm_sessions: [], swarm_progress: [], swarm_retros: [], swarm_messages: [], swarm_results: [], swarm_versions: [], swarm_buried: [], swarm_concepts: [], swarm_concept_trials: [], swarm_protocol_changes: [], swarm_settings: [] };
// ---------------------------------------------------------------------------
// realtime SQL: static checks, plus an opt-in run against a real Postgres
// ---------------------------------------------------------------------------

const swarmDir = resolve(root, "registry/rallypoint/swarm");
const schemaSql = await readFile(resolve(swarmDir, "schema.sql"), "utf8");
const realtimeSql = await readFile(resolve(swarmDir, "realtime.sql"), "utf8");
const realtimeBlock = (sql) => {
  const start = sql.indexOf("-- >>> realtime");
  const end = sql.indexOf("-- <<< realtime");
  assert.ok(start >= 0 && end > start, "a -- >>> realtime … -- <<< realtime block");
  return sql.slice(start, end);
};
const wantedTables = (sql) => {
  const body = /function public\.swarm_realtime_wanted\(\)[\s\S]*?array\[([\s\S]*?)\]/.exec(sql);
  assert.ok(body, "swarm_realtime_wanted() lists its tables");
  return [...body[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
};

await test("realtime.sql is schema.sql's realtime block, byte for byte", () => {
  assert.equal(realtimeBlock(realtimeSql), realtimeBlock(schemaSql));
  assert.equal(schemaSql.match(/-- >>> realtime/g).length, 1);
});

await test("realtime SQL is idempotent and safe without the publication", () => {
  const block = realtimeBlock(schemaSql);
  const code = block.replace(/--.*$/gm, "");
  assert.equal((code.match(/alter publication/gi) ?? []).length, 1, "one alter publication, inside the guarded loop");
  const doBlock = /do \$\$([\s\S]*?)end;\s*\$\$;/.exec(block)?.[1] ?? "";
  const guard = doBlock.indexOf("from pg_publication where pubname = 'supabase_realtime'");
  const member = doBlock.indexOf("from pg_publication_tables");
  const alter = doBlock.search(/alter publication/i);
  assert.ok(guard >= 0 && doBlock.slice(guard - 40, guard).includes("if not exists"), "returns early without the publication");
  assert.ok(member >= 0 && member < alter, "checks membership before adding");
  assert.match(doBlock.slice(member - 60, alter), /if not exists \(/);
  assert.doesNotMatch(block, /^\s*alter publication/im, "no unguarded top-level alter");
  assert.match(block, /create or replace function public\.swarm_realtime_status\(\)/);
  assert.match(block, /grant execute on function public\.swarm_realtime_status\(\) to anon, authenticated/);
  assert.match(block, /RLS/, "says why private projects stay private");
});

await test("realtime publishes the memory tables and never the secret, readers or settings", async () => {
  const wanted = wantedTables(schemaSql);
  assert.ok(wanted.length >= 7);
  for (const table of ["swarm_sessions", "swarm_progress", "swarm_messages", "swarm_results", "swarm_versions", "swarm_retros", "swarm_buried"]) {
    assert.ok(wanted.includes(table), table);
  }
  for (const table of ["swarm_secret", "swarm_readers", "swarm_settings"]) assert.ok(!wanted.includes(table), table);
  // Every published table has the read policy, so Realtime has RLS to apply.
  const policed = /foreach t in array array\[([\s\S]*?)\] loop\s*execute format\('alter table public\.%I enable row level security'/.exec(schemaSql);
  for (const table of wanted) assert.ok(policed[1].includes(`'${table}'`), `${table} has RLS`);
  // The dashboard listens to exactly the published tables.
  const live = await readFile(resolve(root, "registry/rallypoint/swarm-ui/app/swarm/_lib/live.ts"), "utf8");
  const listed = [.../LIVE_TABLES = \[([\s\S]*?)\]/.exec(live)[1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
  assert.deepEqual(listed, wanted);
});

// RALLYPOINT_SWARM_TEST_DATABASE_URL=postgres://… npm run swarm:test applies
// schema.sql twice and realtime.sql twice to a scratch database, with and
// without a supabase_realtime publication. Use a throwaway database.
if (process.env.RALLYPOINT_SWARM_TEST_DATABASE_URL) {
  await test("schema.sql and realtime.sql apply twice on real Postgres", async () => {
    const url = process.env.RALLYPOINT_SWARM_TEST_DATABASE_URL;
    const psql = (...args) => execFileSync("psql", [url, "-v", "ON_ERROR_STOP=1", "-qAt", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    // What Supabase provides and plain Postgres lacks: the API roles and auth.*.
    psql("-c", `do $$ begin
      if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
      if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
      if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
      create schema if not exists auth;
      if to_regprocedure('auth.role()') is null then
        create function auth.role() returns text language sql as 'select null::text';
      end if;
      if to_regprocedure('auth.jwt()') is null then
        create function auth.jwt() returns jsonb language sql as 'select ''{}''::jsonb';
      end if;
    end $$;`);
    const status = () => JSON.parse(psql("-c", "select public.swarm_realtime_status()"));
    const schemaPath = resolve(swarmDir, "schema.sql");
    const realtimePath = resolve(swarmDir, "realtime.sql");
    const hadPublication = psql("-c", "select count(*) from pg_publication where pubname = 'supabase_realtime'").trim() === "1";
    if (!hadPublication) {
      psql("-f", schemaPath, "-f", schemaPath, "-f", realtimePath);
      assert.equal(status().publication, false);
      psql("-c", "create publication supabase_realtime");
      psql("-c", "alter publication supabase_realtime add table public.swarm_sessions");
    }
    psql("-f", realtimePath, "-f", schemaPath, "-f", realtimePath);
    assert.deepEqual(status(), { publication: true, missing: [] });
  });
}

// What swarm_realtime_status() answers; null = the function is missing.
let realtimeStatus = { publication: true, missing: [] };
let nextId = 1;
const reads = [];
const secretsSet = [];
const metricsRow = () => [{ protocol_version: "p1", shipped: db.swarm_versions.length, buried: db.swarm_buried.length, ship_rate: null, median_claim_to_close_minutes: null, progress_per_session: null, retros_since_change: db.swarm_retros.length, sessions_working: 0 }];
const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
  const send = (status, data) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(data));
  };
  if (req.headers.apikey === "service-key" && url.pathname === "/rest/v1/rpc/swarm_set_secret") {
    if (String(body.p_secret ?? "").length < 16) return send(400, { message: "the swarm secret must be at least 16 characters" });
    secretsSet.push(body.p_secret);
    return send(200, null);
  }
  if (req.headers.apikey !== "anon-key") return send(401, { message: "no apikey" });
  const path = url.pathname.replace("/rest/v1/", "");
  if (path.startsWith("rpc/")) {
    const fn = path.slice(4);
    if (fn === "swarm_schema_version") return send(200, 1);
    if (fn === "swarm_realtime_status") {
      return realtimeStatus === null ? send(404, { code: "PGRST202", message: "Could not find the function public.swarm_realtime_status" }) : send(200, realtimeStatus);
    }
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
    if (fn === "swarm_read") {
      if (body.p_table === "swarm_metrics") return send(200, metricsRow());
      let rows = [...(db[body.p_table] ?? [])];
      for (const [column, condition] of Object.entries(body.p_filters ?? {})) {
        const [op, value] = condition.split(/\.(.*)/s);
        rows = rows.filter((row) => (op === "gt" ? String(row[column]) > value : String(row[column]) === value));
      }
      if (body.p_order?.endsWith(".desc")) rows.reverse();
      if (body.p_limit) rows = rows.slice(0, body.p_limit);
      reads.push(body.p_table);
      return send(200, rows);
    }
    if (fn === "swarm_set_setting") {
      db.swarm_settings = db.swarm_settings.filter((s) => s.key !== body.p_key).concat({ key: body.p_key, value: body.p_value });
      return send(200, { key: body.p_key, value: body.p_value });
    }
    return send(404, { message: `unknown rpc ${fn}` });
  }
  if (path === "swarm_metrics") return send(200, metricsRow());
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
// The loop's transport probes \`gh --version\` before its first call.
if (key === "--version") console.log("gh version 0.0.0-fake");
else if (key === "api user") console.log("swarm-bot");
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
const rp = (args, { expect = 0, extraEnv = {}, input = "", stdoutOnly = false } = {}) =>
  new Promise((done, fail) => {
    const childEnv = Object.fromEntries(Object.entries({ ...env, ...extraEnv }).filter(([, v]) => v !== undefined));
    const child = spawn(process.execPath, [cli, ...args], { cwd: fixture, env: childEnv });
    child.stdin.end(input);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("close", (status) => {
      if (expect !== null && status !== expect) fail(new Error(`rallypoint ${args.join(" ")} exited ${status}, expected ${expect}\n${stdout}\n${stderr}`));
      else done(stdoutOnly ? stdout : `${stdout}${stderr}`);
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
    for (const path of ["SWARM.md", ".rallypoint/swarm.json", ".rallypoint/swarm/swarm.mjs", ".rallypoint/swarm/schema.sql", ".rallypoint/swarm/realtime.sql", ".claude/skills/swarm-genesis/SKILL.md"]) {
      await readFile(resolve(fixture, path));
    }
  });

  await test("foreground local runtimes stream output, receive prompts on stdin, and report child codes without colliding with Swarm exit codes", async () => {
    const bin = await mkdtemp(resolve(fixture, "runtime-bin-"));
    const source = String.raw`#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
if (args[0] === "--version") process.exit(0);
if (args.join(" ") === "login status" || args.join(" ") === "auth status") {
  process.exit(Number(process.env.FAKE_RUNTIME_AUTH ?? 0));
}
let prompt = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (data) => { prompt += data; });
process.stdin.on("end", () => {
  if (prompt === "hang") {
    fs.writeFileSync(process.env.FAKE_RUNTIME_PID, String(process.pid));
    setInterval(() => {}, 1000);
    return;
  }
  console.log(JSON.stringify({ prompt, args, cwd: process.cwd() }));
  console.error("role stderr");
  process.exitCode = Number(process.env.FAKE_RUNTIME_EXIT ?? 4);
});
`;
    for (const [name, packageName] of [["claude", "@anthropic-ai/claude-code"], ["codex", "@openai/codex"]]) {
      const packageDir = resolve(bin, "node_modules", packageName);
      await mkdir(packageDir, { recursive: true });
      await writeFile(resolve(packageDir, "package.json"), JSON.stringify({ bin: { [name]: "fake.cjs" } }));
      await writeFile(resolve(packageDir, "fake.cjs"), source);
      // A command-shell launch would run this stub and fail. Windows must
      // invoke the package entrypoint using Node instead.
      await writeFile(resolve(bin, `${name}.cmd`), "@exit /b 99");
      if (process.platform !== "win32") {
        const executable = resolve(bin, name);
        await writeFile(executable, source);
        await chmod(executable, 0o755);
      }
    }
    const pathKey = Object.keys(process.env).find((key) => key.toUpperCase() === "PATH") ?? "PATH";
    const runtimeEnv = { ...process.env, [pathKey]: [bin, process.env[pathKey]].join(delimiter) };
    const prompt = "Read this literally: & | %PATH% $HOME `command`\nThen finish.";
    for (const [runtime, args] of [["claude-local", ["-p", "--permission-mode", "bypassPermissions"]], ["codex-local", ["exec", "--full-auto", "-"]]]) {
      const output = await rp(["swarm", "dispatch", "--runtime", runtime, "--prompt", prompt], {
        expect: 1, extraEnv: { [pathKey]: runtimeEnv[pathKey] },
      });
      const result = JSON.parse(output.split("\n").find((line) => line.startsWith("{")));
      assert.equal(result.prompt, prompt);
      assert.deepEqual(result.args, args);
      assert.equal(resolve(result.cwd), resolve(sh("git", "rev-parse", "--show-toplevel").trim()));
      assert.match(output, /role stderr/);
      assert.ok(output.includes(`${runtime} exited with code 4.`));
      for (const childStatus of [0, 4]) {
        const json = await rp(["swarm", "dispatch", "--runtime", runtime, "--prompt", prompt, "--json"], {
          expect: childStatus === 0 ? 0 : 1,
          extraEnv: { [pathKey]: runtimeEnv[pathKey], FAKE_RUNTIME_EXIT: String(childStatus) },
          stdoutOnly: true,
        });
        assert.deepEqual(JSON.parse(json), { runtime, childStatus });
      }
      assert.equal(doctorRuntime(runtime, { env: runtimeEnv }).ok, true);
    }

    assert.equal(doctorRuntime("codex-local", {
      env: { ...runtimeEnv, FAKE_RUNTIME_AUTH: "1" },
    }).ok, false);

    const pidFile = resolve(bin, "child.pid");
    const timeout = await rp(["swarm", "dispatch", "--runtime", "codex-local", "--prompt", "hang",
      "--max-wait-seconds", "2"], {
      expect: 1, extraEnv: { [pathKey]: runtimeEnv[pathKey], FAKE_RUNTIME_PID: pidFile },
    });
    assert.match(timeout, /timed out.*Inspect/);
    const pid = Number(await readFile(pidFile, "utf8"));
    assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });

    const missingEnv = { ...process.env, [pathKey]: resolve(bin, "missing") };
    const missing = doctorRuntime("claude-local", { cwd: bin, env: missingEnv });
    assert.equal(missing.ok, false);
    assert.match(missing.detail, /claude CLI was not found on PATH/);
    await assert.rejects(dispatchLocal({
      runtime: "claude-local", cwd: bin, prompt: "unused", maxWaitMs: 1000, env: missingEnv,
    }), /claude CLI was not found on PATH/);

    const windowsStatus = await dispatchLocal({
      runtime: "codex-local", cwd: bin, prompt: "Windows shim probe", maxWaitMs: 3000,
      env: { ...runtimeEnv, [pathKey]: bin }, platform: "win32",
    });
    assert.equal(windowsStatus, 4);
    assert.match(await rp(["swarm", "dispatch", "--prompt", prompt], {
      expect: 2, extraEnv: { RALLYPOINT_CODEX_CLOUD_ENV: undefined },
    }), /requires --runtime/);
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

  await test("doctor checks realtime and names realtime.sql when it is missing, as a warning", async () => {
    const realtimeCheck = async () => {
      const out = JSON.parse(await rp(["swarm", "doctor", "--json"]));
      assert.equal(out.ok, true, "realtime never fails doctor");
      return out.checks.find((c) => c.name === "realtime");
    };
    try {
      assert.equal((await realtimeCheck()).level, "ok");
      realtimeStatus = { publication: true, missing: ["swarm_messages", "swarm_progress"] };
      const partial = await realtimeCheck();
      assert.equal(partial.level, "warn");
      assert.match(partial.detail, /swarm_messages, swarm_progress/);
      assert.match(partial.detail, /\.rallypoint\/swarm\/realtime\.sql/);
      realtimeStatus = null;
      const older = await realtimeCheck();
      assert.equal(older.level, "warn");
      assert.match(older.detail, /\.rallypoint\/swarm\/realtime\.sql/);
      realtimeStatus = { publication: false, missing: ["swarm_sessions"] };
      assert.match((await realtimeCheck()).detail, /no supabase_realtime publication/);
      assert.match(await rp(["swarm", "doctor"]), /warn {2}realtime/);
    } finally {
      realtimeStatus = { publication: true, missing: [] };
    }
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
    assert.ok(reads.includes("swarm_messages"), "with the secret, reads go through swarm_read (private-mode safe)");
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
    const sessionId = db.swarm_retros.at(-1).session_id;
    const matching = JSON.parse(await rp(["swarm", "retros", "--session", sessionId, "--limit", "1", "--json"]));
    assert.equal(matching.retros[0].session_id, sessionId);
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
    assert.match(await rp(["swarm", "referee", "--baseline", "HEAD"], { expect: 3 }), /FAIL/, "HEAD cannot beat itself");
    assert.match(await rp(["swarm", "referee", "--baseline", "no-such-ref"], { expect: 3 }), /FAIL/, "no baseline, no pass");
    assert.match(await rp(["swarm", "referee", "--baseline", "no-such-ref", "--first", "--no-record"]), /PASS/);
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

  await test("plan creates missing priority and target labels before opening issues", async () => {
    await writeFile(resolve(fixture, "plan.json"), JSON.stringify([{ title: "Polish", body: "AC: …", target: "web", prio: "p3" }]));
    const dry = await rp(["swarm", "plan", "plan.json", "--dry-run"]);
    assert.match(dry, /add +label prio:p3/);
    assert.match(dry, /add +label target:web/);
    const before = (await readFile(ghLog, "utf8")).trim().split("\n").length;
    await rp(["swarm", "plan", "plan.json"]);
    const calls = (await readFile(ghLog, "utf8")).trim().split("\n").slice(before).map((l) => JSON.parse(l));
    const firstIssue = calls.findIndex((a) => a[0] === "issue" && a[1] === "create");
    const labelCreates = calls.map((a, i) => (a[0] === "label" && a[1] === "create" ? [a[2], i] : null)).filter(Boolean);
    assert.deepEqual(labelCreates.map(([name]) => name).sort(), ["prio:p3", "target:web"]);
    assert.ok(labelCreates.every(([, i]) => i < firstIssue), "labels exist before the first issue");
    await writeFile(resolve(fixture, "plan.json"), JSON.stringify([{ title: "X", body: "AC", labels: ["needs:design"] }]));
    assert.match(await rp(["swarm", "plan", "plan.json"], { expect: 2 }), /needs:design/);
  });

  await test("connect prompts, sets the secret, and writes gitignored env files", async () => {
    await mkdir(resolve(fixture, "swarm-ui"), { recursive: true });
    await writeFile(resolve(fixture, "swarm-ui/package.json"), "{}\n");
    const short = await rp(["swarm", "connect"], { expect: 1, input: `${memoryUrl}\nanon-key\nshort\n` });
    assert.match(short, /at least 16 characters/);
    assert.equal(secretsSet.length, 0);

    const wrongKey = await rp(["swarm", "connect"], { expect: 1, input: `${memoryUrl}\nanon-key\n${SECRET}\nnot-the-service-key\n` });
    assert.match(wrongKey, /Re-apply .rallypoint\/swarm\/schema.sql/);
    assert.match(wrongKey, /Nothing was written/);

    const out = await rp(["swarm", "connect"], { input: `${memoryUrl}\nanon-key\n${SECRET}\nservice-key\n` });
    assert.deepEqual(secretsSet, [SECRET]);
    assert.ok(!out.includes(SECRET), "connect never prints the secret");
    assert.ok(!out.includes("service-key\n"), "connect never prints the service-role key");
    const agentEnv = await readFile(resolve(fixture, ".rallypoint/swarm/.env.local"), "utf8");
    assert.match(agentEnv, new RegExp(`^RALLYPOINT_SWARM_SECRET=${SECRET}$`, "m"));
    assert.match(agentEnv, /^RALLYPOINT_SUPABASE_KEY=anon-key$/m);
    assert.ok(!agentEnv.includes("service-key"), "the service-role key is never saved");
    const uiEnv = await readFile(resolve(fixture, "swarm-ui/.env.local"), "utf8");
    assert.match(uiEnv, /^NEXT_PUBLIC_RALLYPOINT_SUPABASE_KEY=anon-key$/m);
    assert.match(uiEnv, /^RALLYPOINT_GITHUB_REPO=acme\/app$/m);
    assert.ok(!uiEnv.includes(SECRET), "the dashboard never gets the secret");
    assert.match(await readFile(resolve(fixture, ".gitignore"), "utf8"), /^\/\.rallypoint\/swarm\/\.env\.local$/m);
    sh("git", "check-ignore", "-q", ".rallypoint/swarm/.env.local");
    sh("git", "check-ignore", "-q", "swarm-ui/.env.local");

    // The runtime reads the file when the environment does not set a value.
    const withoutEnv = { RALLYPOINT_SUPABASE_URL: undefined, RALLYPOINT_SUPABASE_KEY: undefined, RALLYPOINT_SWARM_SECRET: undefined };
    const doctor = await rp(["swarm", "doctor", "--json"], { extraEnv: withoutEnv, expect: null });
    assert.match(doctor, /set \(agents only\)/);

    await rm(resolve(fixture, "swarm-ui"), { recursive: true, force: true });
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

  await test("swarm-ui follows src/app instead of shadowing it with a root app/", async () => {
    const pkgPath = resolve(fixture, "package.json");
    await writeFile(pkgPath, JSON.stringify({ dependencies: { next: "16.2.6" } }));
    await mkdir(resolve(fixture, "src/app"), { recursive: true });
    const out = await rp(["add", "swarm-ui"]);
    assert.match(out, /src\/app detected/);
    assert.match(out, /npm install @supabase\/realtime-js@"\^2/, "names live updates' missing dependency");
    assert.match(out, /npm install .*\bd3@"\^7/, "names the fleet graph's missing dependency");
    assert.match(out, /npm install --save-dev @types\/d3@/);
    await readFile(resolve(fixture, "src/app/swarm/_graph/render.ts"));
    await readFile(resolve(fixture, "src/app/swarm/page.tsx"));
    await readFile(resolve(fixture, "src/app/swarm/swarm.config.ts"));
    await assert.rejects(readFile(resolve(fixture, "app/swarm/page.tsx")), "no root app/ was created");
  });

  await test("every swarm-ui source file ships in both UI items", async () => {
    // A file the scaffold imports but the manifest does not list installs a
    // UI that cannot compile (guidance.ts once shipped this way).
    const { readdir } = await import("node:fs/promises");
    const { relative } = await import("node:path");
    const sourceRoot = resolve(root, "registry/rallypoint");
    const walk = async (dir) =>
      (await readdir(dir, { withFileTypes: true })).flatMap((entry) => [resolve(dir, entry.name), entry.isDirectory()]);
    const files = [];
    const pending = [resolve(sourceRoot, "swarm-ui/app")];
    while (pending.length) {
      const pairs = await walk(pending.pop());
      for (let i = 0; i < pairs.length; i += 2) (pairs[i + 1] ? pending : files).push(pairs[i]);
    }
    const manifest = JSON.parse(await readFile(resolve(root, "registry/manifest.json"), "utf8"));
    for (const name of ["swarm-ui", "swarm-dashboard"]) {
      const item = manifest.items.find((entry) => entry.name === name);
      const listed = new Set(item.files.map((file) => file.source));
      for (const file of files) {
        const source = relative(sourceRoot, file).replace(/\\/g, "/");
        if (source.endsWith("/swarm.config.ts")) continue; // generated by ui-config
        assert.ok(listed.has(source), `${source} is not in the ${name} item of registry/manifest.json`);
      }
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

  console.log(`Swarm tests passed: ${passed} checks (roles, referee, config, ui-config, message board, UI banners, realtime SQL, install, doctor, session, score/checks modes, plan, labels, connect, learning, UI generation, fleet graph).`);
} finally {
  server.close();
  await rm(fixture, { recursive: true, force: true });
  await rm(fakeGh, { force: true });
}
