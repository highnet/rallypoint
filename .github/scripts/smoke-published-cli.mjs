#!/usr/bin/env node

// Post-publish smoke test: runs the rallypoint package exactly as users get it
// from npm (npx rallypoint@<version>) in a throwaway git repository, against a
// fake `gh` (RALLYPOINT_GH_SCRIPT, as scripts/test-cli.mjs does) and a fake
// Supabase memory. No real GitHub or Supabase is touched.
//
//   node .github/scripts/smoke-published-cli.mjs 0.8.0
//
// Exits non-zero, with the failing step's full output, on the first failure.

import { execFileSync, spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const version = process.argv[2];
if (!version) {
  console.error("usage: smoke-published-cli.mjs <version>");
  process.exit(2);
}
const pkg = `rallypoint@${version}`;
const SECRET = "smoke-test-secret-0123456789";

// Fake Supabase: just enough PostgREST for `swarm doctor`.
const server = createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
  const send = (status, data) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(data));
  };
  if (req.headers.apikey !== "anon-key") return send(401, { message: "no apikey" });
  const path = new URL(req.url, "http://x").pathname;
  if (path === "/rest/v1/rpc/swarm_schema_version") return send(200, 1);
  if (path === "/rest/v1/rpc/swarm_check") {
    return body.p_secret === SECRET
      ? send(200, { ok: true, schema_version: 1 })
      : send(400, { code: "28P01", message: "invalid swarm secret" });
  }
  console.error(`fake memory: unhandled ${req.method} ${path}`);
  return send(404, { message: `fake memory: unhandled ${path}` });
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));

const repo = await mkdtemp(resolve(tmpdir(), "rallypoint-smoke-"));
const ghLog = resolve(repo, "..", `smoke-gh-log-${process.pid}.jsonl`);
const fakeGh = resolve(repo, "..", `smoke-fake-gh-${process.pid}.mjs`);
await writeFile(fakeGh, `
import { appendFileSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(${JSON.stringify(ghLog)}, JSON.stringify(args) + "\\n");
const key = args.slice(0, 2).join(" ");
if (args[0] === "--version") console.log("gh version 2.0.0");
else if (key === "api user") console.log("smoke-bot");
else if (key === "repo view") console.log(args.includes("--json") ? JSON.stringify({ nameWithOwner: "acme/app", defaultBranchRef: { name: "main" } }) : "acme/app");
// \`swarm doctor\` proves the transport can list pull requests.
else if (key === "pr list") console.log("[]");
else if (key === "issue list") console.log("[]");
else if (key === "label list") console.log("[]");
else if (key === "label create") console.log("");
else if (args[0] === "api" && String(args[1]).endsWith("/protection")) { console.error("HTTP 404: Branch not protected"); process.exit(1); }
else { console.error("fake gh: unhandled " + args.join(" ")); process.exit(1); }
`);

const env = {
  ...process.env,
  RALLYPOINT_GH_SCRIPT: fakeGh,
  RALLYPOINT_SUPABASE_URL: `http://127.0.0.1:${server.address().port}`,
  RALLYPOINT_SUPABASE_KEY: "anon-key",
  RALLYPOINT_SWARM_SECRET: SECRET,
  RALLYPOINT_AGENT: "smoke-test",
  NO_COLOR: "1",
  GIT_AUTHOR_NAME: "smoke", GIT_AUTHOR_EMAIL: "smoke@example.com",
  GIT_COMMITTER_NAME: "smoke", GIT_COMMITTER_EMAIL: "smoke@example.com",
};

// Asynchronous, so the fake memory server keeps serving while the CLI runs.
const npx = (...args) =>
  new Promise((done, fail) => {
    const child = spawn("npx", ["--yes", pkg, ...args], {
      cwd: repo,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      shell: process.platform === "win32",
    });
    let output = "";
    child.stdout.on("data", (d) => (output += d));
    child.stderr.on("data", (d) => (output += d));
    const timer = setTimeout(() => child.kill(), 5 * 60 * 1000);
    child.on("error", fail);
    child.on("close", (status) => {
      clearTimeout(timer);
      done({ status, output });
    });
  });

let failed = false;
const step = async (name, args, check = () => {}) => {
  const { status, output } = await npx(...args);
  let problem = status === 0 ? null : `exited ${status}`;
  if (!problem) {
    try {
      check(output);
    } catch (error) {
      problem = error.message;
    }
  }
  if (problem) {
    console.error(`::error title=Smoke test failed::npx ${pkg} ${args.join(" ")}: ${problem}`);
    console.error(output);
    throw new Error(`${name}: ${problem}`);
  }
  console.log(`ok  ${name}`);
};
const expect = (condition, message) => {
  if (!condition) throw new Error(message);
};

try {
  const git = (...args) => execFileSync("git", args, { cwd: repo, env, stdio: "pipe" });
  git("init", "-q", "-b", "main");
  await writeFile(resolve(repo, "README.md"), "smoke\n");
  git("add", "-A");
  git("commit", "-qm", "init");

  await step("--version", ["--version"], (out) => expect(out.includes(version), `printed ${out.trim()}, not ${version}`));
  await step("add loop", ["add", "loop"], (out) => expect(/Campaign ready\./.test(out), "no 'Campaign ready.'"));
  await step("init (fake gh)", ["init"]);
  await step("add swarm", ["add", "swarm"], (out) => expect(/Campaign ready\./.test(out), "no 'Campaign ready.'"));
  await step("swarm doctor", ["swarm", "doctor", "--json"], (out) => {
    const report = JSON.parse(out.slice(out.indexOf("{")));
    expect(report.ok === true, `doctor not ok: ${JSON.stringify(report.checks.filter((c) => c.level === "fail"))}`);
  });

  await writeFile(resolve(repo, "plan.json"), JSON.stringify([{ title: "Smoke task", body: "AC: it exists", prio: "p2" }]));
  await step("swarm plan --dry-run", ["swarm", "plan", "plan.json", "--dry-run"], (out) =>
    expect(out.includes("Smoke task"), "the planned task is missing from the output"),
  );
  const calls = (await readFile(ghLog, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
  expect(!calls.some((a) => a[0] === "issue" && a[1] === "create"), "plan --dry-run opened an issue");

  console.log(`\nSmoke test passed for ${pkg}.`);
} catch (error) {
  failed = true;
  console.error(`\n${error.message}`);
} finally {
  server.close();
  await rm(repo, { recursive: true, force: true });
  await rm(fakeGh, { force: true });
  await rm(ghLog, { force: true });
}
process.exit(failed ? 1 : 0);
