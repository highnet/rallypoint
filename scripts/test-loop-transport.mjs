#!/usr/bin/env node

// The loop's REST transport, end to end: `syncRequest()` in `request.mjs` runs
// `fetch-once.mjs` as a child process, and that pair is what every installed
// loop script uses when `gh` is not on PATH. The runner was once referenced and
// never shipped, so the first API call of any `gh`-less session — `claim.mjs`'s
// included — failed before reaching GitHub. These tests run the real pair
// against a local stub server. No network, no real GitHub.
//
//   npm run cli:test        (builds the registry first, then runs this)

import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const sourceRoot = resolve(root, "registry/rallypoint");
const libDir = resolve(sourceRoot, ".rallypoint/scripts/lib");
const runner = resolve(libDir, "fetch-once.mjs");

// The stub is on loopback, and `syncRequest` runs its child with
// NODE_USE_ENV_PROXY=1, so an agent session's HTTPS_PROXY would otherwise be
// asked to reach 127.0.0.1 on our behalf.
process.env.NO_PROXY = ["127.0.0.1", "localhost", process.env.NO_PROXY].filter(Boolean).join(",");
process.env.no_proxy = process.env.NO_PROXY;

const { syncRequest } = await import(pathToFileURL(resolve(libDir, "request.mjs")).href);
const { nextPathFrom } = await import(pathToFileURL(runner).href);
const { createTransport, fields, UnsupportedCommand } = await import(pathToFileURL(resolve(libDir, "api.mjs")).href);
const {
  emulateGitDataWrite,
  gitDataRequest,
  hideReleased,
  isReleasedMessage,
  RELEASED_MARK,
  transportChoice,
} = await import(pathToFileURL(resolve(libDir, "gh.mjs")).href);

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

/** Runs the runner directly, the way `syncRequest` does, and returns the raw result. */
const runRaw = (input) =>
  spawnSync(process.execPath, [runner], {
    input: JSON.stringify(input),
    encoding: "utf8",
    env: { ...process.env, NODE_USE_ENV_PROXY: "1" },
  });

// The stub runs in its own process. `syncRequest` blocks on `execFileSync`, so a
// server on this process's event loop could never answer it.
const stub = `
import { createServer } from "node:http";
const seen = [];
const commits = {};
const refs = [];
const server = createServer((request, response) => {
  let body = "";
  request.on("data", (chunk) => (body += chunk));
  request.on("end", () => {
    const { port } = server.address();
    if (request.url === "/__seen") {
      response.writeHead(200, { "Content-Type": "application/json" });
      return response.end(JSON.stringify(seen));
    }
    seen.push({ method: request.method, url: request.url, headers: request.headers, body });

    if (request.url === "/repos/o/r/issues?per_page=2") {
      response.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        Link:
          "<http://127.0.0.1:" + port + "/repos/o/r/issues?per_page=2&page=2>; rel=\\"next\\", " +
          "<http://127.0.0.1:" + port + "/repos/o/r/issues?per_page=2&page=3>; rel=\\"last\\"",
      });
      response.end(JSON.stringify([{ number: 1 }, { number: 2 }]));
    } else if (request.url === "/repos/o/r/issues?per_page=2&page=2") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify([{ number: 3 }]));
    } else if (request.url === "/repos/o/r/git/refs" && request.method === "POST") {
      response.writeHead(422, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ message: "Reference already exists" }));
    } else if (request.url === "/__commits" && request.method === "POST") {
      Object.assign(commits, JSON.parse(body));
      response.writeHead(204);
      response.end();
    } else if (request.url.startsWith("/repos/o/r/git/commits/") && commits[request.url.split("/").pop()]) {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ sha: request.url.split("/").pop(), message: commits[request.url.split("/").pop()] }));
    } else if (request.url.startsWith("/repos/o/r/git/matching-refs/heads/rallypoint-claims/")) {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify(refs));
    } else if (request.url === "/__refs" && request.method === "POST") {
      refs.splice(0, refs.length, ...JSON.parse(body));
      response.writeHead(204);
      response.end();
    } else if (request.url === "/repos/o/r/issues?state=open&per_page=100") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify([{ number: 7, title: "t", labels: [], assignees: [], state: "open" }]));
    } else if (request.url === "/plain") {
      response.writeHead(502, { "Content-Type": "text/html" });
      response.end("<h1>Bad gateway</h1>");
    } else if (request.url === "/empty") {
      response.writeHead(204);
      response.end();
    } else {
      response.writeHead(404, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ message: "Not Found" }));
    }
  });
});
server.listen(0, "127.0.0.1", () => console.log(server.address().port));
`;

const server = spawn(process.execPath, ["--input-type=module", "-e", stub], {
  stdio: ["ignore", "pipe", "inherit"],
});
const port = await new Promise((done, fail) => {
  server.once("exit", (code) => fail(new Error(`stub server exited ${code}`)));
  server.stdout.once("data", (chunk) => done(Number(String(chunk).trim())));
});
const baseUrl = `http://127.0.0.1:${port}`;

/** What the stub received, read asynchronously so nothing here blocks it. */
const seenRequests = async () => (await fetch(`${baseUrl}/__seen`)).json();

// A port nothing listens on: bind one, then release it.
const closedPort = await new Promise((done) => {
  const probe = createServer();
  probe.listen(0, "127.0.0.1", () => {
    const { port } = /** @type {import("node:net").AddressInfo} */ (probe.address());
    probe.close(() => done(port));
  });
});

const token = `ghp_${"a".repeat(36)}`;

try {
  await test("every loop script library file ships in the manifest", async () => {
    // The original defect: `request.mjs` names a sibling the manifest never
    // listed, so `add loop` installed a transport that could not run.
    const manifest = JSON.parse(await readFile(resolve(root, "registry/manifest.json"), "utf8"));
    const listed = new Set(manifest.items.find((item) => item.name === "loop").files.map((file) => file.source));
    for (const name of await readdir(libDir)) {
      if (!name.endsWith(".mjs")) continue;
      const source = relative(sourceRoot, resolve(libDir, name));
      assert.ok(listed.has(source), `${source} is not in the loop item of registry/manifest.json`);
    }
  });

  await test("a 200 JSON response is parsed and its Link next page becomes nextPath", async () => {
    const request = syncRequest({ token, baseUrl });
    const response = request({ method: "GET", path: "/repos/o/r/issues?per_page=2" });

    assert.deepEqual(response, {
      status: 200,
      body: [{ number: 1 }, { number: 2 }],
      nextPath: "/repos/o/r/issues?per_page=2&page=2",
    });

    // The path it returned is one the same request function can follow.
    const next = request({ method: "GET", path: response.nextPath });
    assert.deepEqual(next, { status: 200, body: [{ number: 3 }], nextPath: null });

    const sent = (await seenRequests()).find((entry) => entry.url === "/repos/o/r/issues?per_page=2");
    assert.equal(sent.headers.accept, "application/vnd.github+json");
    assert.equal(sent.headers["x-github-api-version"], "2022-11-28");
    assert.ok(sent.headers["user-agent"], "no User-Agent sent");
    assert.equal(sent.headers.authorization, `Bearer ${token}`);
  });

  await test("a 404 exits 0 and is reported as status 404", async () => {
    const result = runRaw({ method: "GET", path: "/repos/o/r/issues/999", baseUrl, token: "" });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), { status: 404, body: { message: "Not Found" }, nextPath: null });

    // And no Authorization header at all when there is no credential.
    const sent = (await seenRequests()).find((entry) => entry.url === "/repos/o/r/issues/999");
    assert.equal(sent.headers.authorization, undefined);
  });

  await test("a refused POST is a status, not a throw, and the body is sent as JSON", async () => {
    // `claim.mjs`'s reservation depends on this: the 422 has to reach
    // `api.mjs`, which is what turns it into "another session got there first".
    const response = syncRequest({ token, baseUrl })({
      method: "POST",
      path: "/repos/o/r/git/refs",
      body: { ref: "refs/heads/rallypoint-claims/issue-7", sha: "0".repeat(40) },
    });
    assert.equal(response.status, 422);
    assert.deepEqual(response.body, { message: "Reference already exists" });

    const sent = (await seenRequests()).find((entry) => entry.url === "/repos/o/r/git/refs");
    assert.equal(sent.headers["content-type"], "application/json");
    assert.deepEqual(JSON.parse(sent.body), { ref: "refs/heads/rallypoint-claims/issue-7", sha: "0".repeat(40) });
  });

  await test("a non-JSON body is returned as text and an empty one as null", async () => {
    const request = syncRequest({ token, baseUrl });
    assert.deepEqual(request({ method: "GET", path: "/plain" }), {
      status: 502,
      body: "<h1>Bad gateway</h1>",
      nextPath: null,
    });
    assert.deepEqual(request({ method: "DELETE", path: "/empty" }), { status: 204, body: null, nextPath: null });
  });

  await test("an unreachable host exits non-zero, and syncRequest throws", async () => {
    const unreachable = `http://127.0.0.1:${closedPort}`;
    const result = runRaw({ method: "GET", path: "/user", baseUrl: unreachable, token: "" });
    assert.notEqual(result.status, 0);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /fetch failed/);

    assert.throws(
      () => syncRequest({ baseUrl: unreachable, timeoutMs: 10_000 })({ method: "GET", path: "/user" }),
      /Could not reach the GitHub API for GET \/user:\n.*fetch failed/s,
    );
  });

  await test("nextPathFrom keeps an Enterprise base path and refuses another origin", async () => {
    const base = "https://ghe.example/api/v3";
    assert.equal(
      nextPathFrom('<https://ghe.example/api/v3/repos/o/r/pulls?page=2>; rel="next"', base),
      "/repos/o/r/pulls?page=2",
    );
    assert.equal(nextPathFrom('<https://elsewhere.example/x?page=2>; rel="next"', base), null);
    assert.equal(nextPathFrom('<https://ghe.example/api/v3/x?page=1>; rel="prev"', base), null);
    assert.equal(nextPathFrom(null, base), null);
  });

  // -------------------------------------------------------------------------
  // Transport choice, and the cloud-session behaviour of `lib/gh.mjs`
  // -------------------------------------------------------------------------

  await test("transportChoice: forced, fixture, cloud session, then gh on PATH", async () => {
    const yes = { hasGhBinary: () => true };
    const no = { hasGhBinary: () => false };
    assert.deepEqual(
      [
        transportChoice({ RALLYPOINT_TRANSPORT: "rest" }, yes),
        transportChoice({ RALLYPOINT_TRANSPORT: "gh", CLAUDE_CODE_REMOTE: "true" }, no),
        transportChoice({ RALLYPOINT_GH_SCRIPT: "/x.mjs", CLAUDE_CODE_REMOTE: "true" }, no),
        transportChoice({ CLAUDE_CODE_REMOTE: "true" }, yes),
        transportChoice({ CLAUDE_CODE_REMOTE: "false" }, yes),
        transportChoice({}, no),
      ].map(({ kind, emulateGitData }) => [kind, emulateGitData]),
      [
        ["rest", true],
        ["gh", false],
        ["gh", false],
        ["rest", true],
        ["gh", false],
        ["rest", false],
      ],
    );
  });

  await test("fields: -f strings, -F typed values, and key[] arrays", async () => {
    assert.deepEqual(
      fields(["api", "x", "-f", "message=a=b", "-f", "parents[]=p1", "-f", "parents[]=p2", "-F", "force=true", "-F", "n=3", "-F", "s=x"]),
      { message: "a=b", parents: ["p1", "p2"], force: true, n: 3, s: "x" },
    );
  });

  await test("gitDataRequest: ref and commit writes are routed, reads are not", async () => {
    const del = gitDataRequest(["api", "--method", "DELETE", "repos/o/r/git/refs/heads/rallypoint-claims/issue-7"]);
    assert.deepEqual([del.method, del.kind, del.rest], ["DELETE", "refs", "heads/rallypoint-claims/issue-7"]);
    const post = gitDataRequest(["api", "--method", "POST", "repos/o/r/git/refs", "-f", "ref=refs/heads/x", "-f", "sha=abc"]);
    assert.deepEqual([post.kind, post.rest, post.body], ["refs", undefined, { ref: "refs/heads/x", sha: "abc" }]);
    assert.equal(gitDataRequest(["api", "repos/o/r/git/matching-refs/heads/rallypoint-claims/issue-7"]), null);
    assert.equal(gitDataRequest(["api", "--method", "GET", "repos/o/r/git/ref/heads/main"]), null);
    assert.equal(gitDataRequest(["api", "--method", "POST", "repos/o/r/issues/7/labels"]), null);
  });

  await test("hideReleased: released coordination refs read as absent; everything else passes through", async () => {
    const table = { live: "rallypoint: reserve refs/heads/rallypoint-claims/issue-7 at t 1", gone: `${RELEASED_MARK} refs/heads/rallypoint-claims/issue-8 at t` };
    const read = (...args) => {
      const sha = args[1].split("/").pop();
      if (!(sha in table)) throw new Error("HTTP 404");
      return JSON.stringify({ sha, message: table[sha] });
    };
    const prefixes = ["rallypoint-claims/issue-", "rallypoint-sessions/"];
    const ref = (name, sha) => ({ ref: `refs/heads/${name}`, object: { sha } });
    const listing = JSON.stringify([ref("rallypoint-claims/issue-7", "live"), ref("rallypoint-claims/issue-8", "gone"), ref("rallypoint-claims/issue-9", "unreadable")]);
    const kept = JSON.parse(hideReleased(["api", "repos/o/r/git/matching-refs/heads/rallypoint-claims/issue-?per_page=100"], listing, read, { prefixes }));
    assert.deepEqual(kept.map((r) => r.object.sha), ["live", "unreadable"], "an unreadable marker stays visible");

    const slurped = JSON.stringify([[ref("rallypoint-claims/issue-8", "gone")], [ref("rallypoint-claims/issue-7", "live")]]);
    assert.deepEqual(JSON.parse(hideReleased(["api", "--paginate", "--slurp", "repos/o/r/git/matching-refs/heads/rallypoint-claims/"], slurped, read, { prefixes })).map((p) => p.length), [0, 1]);

    assert.throws(() => hideReleased(["api", "repos/o/r/git/ref/heads/rallypoint-claims/issue-8"], JSON.stringify(ref("rallypoint-claims/issue-8", "gone")), read, { prefixes }), /HTTP 404/);
    const other = JSON.stringify([ref("agent/8-x", "gone")]);
    assert.equal(hideReleased(["api", "repos/o/r/git/matching-refs/heads/agent/"], other, () => assert.fail("no read"), { prefixes }), other);
    assert.equal(hideReleased(["issue", "list"], "[]", () => assert.fail("no read")), "[]");
    assert.equal(isReleasedMessage("rallypoint: reserve x"), false);
  });

  await test("emulated git-data writes: create-only refs, release markers, takeover, forced moves", async () => {
    const work = await mkdtemp(resolve(tmpdir(), "rallypoint-gitdata-"));
    try {
      const origin = resolve(work, "origin.git");
      const run = (cwd) => (...args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.com" } }).trim();
      execFileSync("git", ["init", "-q", "--bare", "-b", "main", origin]);
      const a = resolve(work, "a");
      const b = resolve(work, "b");
      execFileSync("git", ["clone", "-q", origin, a], { stdio: "ignore" });
      run(a)("commit", "-q", "--allow-empty", "-m", "base");
      run(a)("push", "-q", "origin", "HEAD:refs/heads/main");
      execFileSync("git", ["clone", "-q", origin, b], { stdio: "ignore" });
      const base = run(a)("rev-parse", "HEAD");
      const ref = "refs/heads/rallypoint-claims/issue-7";
      const create = (cwd, options = {}) =>
        emulateGitDataWrite(["api", "--method", "POST", "repos/o/r/git/refs", "-f", `ref=${ref}`, "-f", `sha=${base}`], { git: run(cwd), ...options });
      const del = (cwd, name = ref) => emulateGitDataWrite(["api", "--method", "DELETE", `repos/o/r/git/${name}`], { git: run(cwd) });
      const remote = (name) => run(a)("ls-remote", "origin", name).split(/\s+/)[0] ?? "";
      const subject = (sha) => { run(a)("fetch", "-q", "origin", sha); return run(a)("log", "-1", "--format=%s", sha); };

      // A create pushes its own reserve commit on top of the requested SHA.
      const created = JSON.parse(create(a));
      assert.equal(remote(ref), created.object.sha);
      assert.match(subject(created.object.sha), /^rallypoint: reserve /);
      assert.equal(run(a)("rev-parse", `${created.object.sha}^`), base);

      // A second claimant — another clone — is refused, as `POST /git/refs` would.
      assert.throws(() => create(b), /HTTP 422: Reference already exists/);

      // A concurrent writer between the read and the push loses to the lease.
      del(a);
      assert.equal(remote(ref), "", "a permitted delete really deletes");
      let raced = false;
      const racing = (...args) => {
        const out = run(a)(...args);
        if (args[0] === "ls-remote" && !raced) {
          raced = true;
          create(b);
        }
        return out;
      };
      assert.throws(() => emulateGitDataWrite(["api", "--method", "POST", "repos/o/r/git/refs", "-f", `ref=${ref}`, "-f", `sha=${base}`], { git: racing }), /HTTP 422/);

      // Where the remote refuses deletes, a coordination ref is released to a
      // marker instead, reads as absent to the next create, and can be taken over.
      execFileSync("git", ["config", "receive.denyDeletes", "true"], { cwd: origin });
      assert.equal(del(a), "");
      const marker = remote(ref);
      assert.match(subject(marker), /^rallypoint: released refs\/heads\/rallypoint-claims\/issue-7 at /);
      assert.throws(() => del(a), /Reference does not exist/, "a released ref is already gone");
      const takeover = JSON.parse(create(a));
      assert.equal(remote(ref), takeover.object.sha);
      assert.equal(run(a)("rev-parse", `${takeover.object.sha}^`), base);

      // Anything that is not a coordination ref is never faked as deleted.
      run(a)("push", "-q", "origin", `${base}:refs/heads/agent/7-x`);
      assert.throws(() => del(a, "refs/heads/agent/7-x"), /HTTP 403: refs\/heads\/agent\/7-x could not be deleted/);
      assert.equal(remote("refs/heads/agent/7-x"), base);

      // A lease commit is pushed as itself, trailers intact, and PATCH forces
      // only when asked.
      const tree = run(a)("rev-parse", `${base}^{tree}`);
      const lease = JSON.parse(emulateGitDataWrite(["api", "--method", "POST", "repos/o/r/git/commits", "-f", "message=lease\n\nRallypoint-Lease-Role: janitor", "-f", `tree=${tree}`, "-f", `parents[]=${base}`], { git: run(a) })).sha;
      const leaseRef = "refs/heads/rallypoint-sessions/janitor";
      emulateGitDataWrite(["api", "--method", "POST", "repos/o/r/git/refs", "-f", `ref=${leaseRef}`, "-f", `sha=${lease}`], { git: run(a) });
      assert.equal(remote(leaseRef), lease);
      const sideways = run(a)("commit-tree", tree, "-m", "unrelated");
      const patch = (force) => emulateGitDataWrite(["api", "--method", "PATCH", `repos/o/r/git/${leaseRef}`, "-f", `sha=${sideways}`, ...(force ? ["-F", "force=true"] : [])], { git: run(a) });
      assert.throws(() => patch(false), /HTTP 422: Update is not a fast forward/);
      patch(true);
      assert.equal(remote(leaseRef), sideways);
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  });

  await test("a cloud session's `gh` is REST plus git: no gh binary, released claims hidden", async () => {
    const work = await mkdtemp(resolve(tmpdir(), "rallypoint-cloud-"));
    try {
      await writeFile(resolve(work, "gh"), `#!/bin/sh\\necho "$@" >> "${work}/gh.log"\\nexit 1\\n`, { mode: 0o755 });
      await fetch(`${baseUrl}/__commits`, { method: "POST", body: JSON.stringify({ c1live: "rallypoint: reserve x", c2gone: `${RELEASED_MARK} x` }) });
      await fetch(`${baseUrl}/__refs`, {
        method: "POST",
        body: JSON.stringify([
          { ref: "refs/heads/rallypoint-claims/issue-7", object: { sha: "c1live" } },
          { ref: "refs/heads/rallypoint-claims/issue-8", object: { sha: "c2gone" } },
        ]),
      });
      const probe = `
        const { gh } = await import(${JSON.stringify(pathToFileURL(resolve(libDir, "gh.mjs")).href)});
        const issues = JSON.parse(gh("issue", "list", "--state", "open", "--limit", "100", "--json", "number,state"));
        const refs = JSON.parse(gh("api", "repos/o/r/git/matching-refs/heads/rallypoint-claims/issue-"));
        console.log(JSON.stringify({ version: gh("--version"), issues, refs: refs.map((r) => r.ref) }));
      `;
      const result = spawnSync(process.execPath, ["--input-type=module", "-e", probe], {
        cwd: work,
        encoding: "utf8",
        env: {
          ...process.env,
          CLAUDE_CODE_REMOTE: "true",
          RALLYPOINT_GH_SCRIPT: "",
          RALLYPOINT_TRANSPORT: "",
          RALLYPOINT_GITHUB_API_URL: baseUrl,
          GITHUB_REPOSITORY: "o/r",
          GH_TOKEN: token,
          GITHUB_TOKEN: "",
          PATH: `${work}:${process.env.PATH}`,
        },
      });
      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(JSON.parse(result.stdout), {
        version: "gh (rallypoint REST transport)",
        issues: [{ number: 7, state: "OPEN" }],
        refs: ["refs/heads/rallypoint-claims/issue-7"],
      });
      assert.equal(await readFile(resolve(work, "gh.log"), "utf8").catch(() => ""), "", "the gh binary was never run");
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  });

  // -------------------------------------------------------------------------
  // The REST transport's command surface (api.mjs), against a fake request
  // -------------------------------------------------------------------------

  /** A fake `request` answering from `routes`, recording every call. */
  const fakeRequest = (routes) => {
    const calls = [];
    const request = (call) => {
      calls.push(call);
      const handler = routes[`${call.method} ${call.path}`];
      if (!handler) return { status: 404, body: { message: "Not Found" } };
      return typeof handler === "function" ? handler(call) : handler;
    };
    return { calls, request };
  };
  const pull = (number, extra = {}) => ({ number, title: `PR ${number}`, body: "", labels: [], draft: false, state: "open", head: { ref: `agent/${number}-x`, sha: `${number}`.repeat(40).slice(0, 40) }, base: { ref: "main" }, user: { login: "dependabot[bot]", type: "Bot" }, html_url: `https://github.com/o/r/pull/${number}`, ...extra });

  await test("api: issue list follows pages to --limit and drops pull requests; comments come in gh's shape", async () => {
    const { request, calls } = fakeRequest({
      "GET /repos/o/r/issues?state=open&per_page=3&labels=a%2Cb&assignee=*": { status: 200, body: [{ number: 1, labels: [] }, { number: 2, pull_request: {} }], nextPath: "/p2" },
      "GET /p2": { status: 200, body: [{ number: 3 }, { number: 4 }, { number: 5 }], nextPath: "/p3" },
      "GET /repos/o/r/issues/1/comments?per_page=100": { status: 200, body: [{ body: "hi", user: { login: "u" }, created_at: "t", html_url: "h" }] },
      "GET /repos/o/r/issues/3/comments?per_page=100": { status: 200, body: [] },
      "GET /repos/o/r/issues/4/comments?per_page=100": { status: 200, body: [] },
    });
    const gh = createTransport({ request, repository: "o/r" });
    const out = JSON.parse(gh("issue", "list", "--state", "open", "--label", "a,b", "--assignee", "*", "--limit", "3", "--json", "number,comments"));
    assert.deepEqual(out.map((i) => i.number), [1, 3, 4]);
    assert.equal(out[0].comments[0].author.login, "u");
    assert.equal(out[0].comments[0].createdAt, "t");
    assert.ok(!calls.some((c) => c.path === "/p3"), "stops paging once the limit is met");
  });

  await test("api: pr list, pr view by branch, merged state and merge commit", async () => {
    const merged = pull(5, { state: "closed", merged_at: "m", merge_commit_sha: "f".repeat(40), labels: [{ name: "x" }] });
    const { request } = fakeRequest({
      "GET /repos/o/r/pulls?state=closed&per_page=30&head=o%3Aagent%2F5-x": { status: 200, body: [merged, pull(6, { state: "closed" })] },
      "GET /repos/o/r/pulls?state=all&per_page=5&head=o%3Aagent%2F5-x": { status: 200, body: [merged] },
      "GET /repos/o/r/pulls/5": { status: 200, body: merged },
    });
    const gh = createTransport({ request, repository: "o/r" });
    assert.deepEqual(JSON.parse(gh("pr", "list", "--state", "merged", "--head", "agent/5-x", "--label", "x", "--json", "number,state,mergedAt,isDraft,author")), [
      { number: 5, state: "MERGED", mergedAt: "m", isDraft: false, author: { login: "dependabot[bot]", is_bot: true } },
    ]);
    assert.deepEqual(JSON.parse(gh("pr", "view", "agent/5-x", "--json", "number,mergeCommit,headRefName")), { number: 5, mergeCommit: { oid: "f".repeat(40) }, headRefName: "agent/5-x" });
    assert.throws(() => gh("pr", "view", "5", "--json", "number,closingIssuesReferences"), UnsupportedCommand, "GitHub's own linking is not faked from the body");
  });

  await test("api: pr create labels the new pull request; pr merge refuses what it cannot finish", async () => {
    const { request, calls } = fakeRequest({
      "POST /repos/o/r/pulls": { status: 201, body: { number: 9, html_url: "https://github.com/o/r/pull/9" } },
      "POST /repos/o/r/issues/9/labels": { status: 200, body: [] },
      "PUT /repos/o/r/pulls/9/merge": { status: 200, body: { merged: true } },
    });
    const gh = createTransport({ request, repository: "o/r" });
    assert.equal(gh("pr", "create", "--title", "T", "--body", "B", "--base", "main", "--head", "agent/9-x", "--label", "a,b", "--draft"), "https://github.com/o/r/pull/9");
    assert.deepEqual(calls[0].body, { title: "T", body: "B", base: "main", head: "agent/9-x", draft: true });
    assert.deepEqual(calls[1].body, { labels: ["a", "b"] });
    gh("pr", "merge", "9", "--squash", "--match-head-commit", "abc");
    assert.deepEqual(calls.at(-1).body, { merge_method: "squash", sha: "abc" });
    assert.throws(() => gh("pr", "merge", "9", "--merge", "--delete-branch"), UnsupportedCommand);
  });

  await test("api: labels, issue create, explicit assignees, typed api fields, and --jq refused", async () => {
    const { request, calls } = fakeRequest({
      "GET /repos/o/r/labels?per_page=100": { status: 200, body: [{ name: "a", color: "fff" }], nextPath: "/l2" },
      "GET /l2": { status: 200, body: [{ name: "b", color: "000", description: "d" }] },
      "POST /repos/o/r/labels": { status: 201, body: {} },
      "POST /repos/o/r/issues": { status: 201, body: { html_url: "https://github.com/o/r/issues/3" } },
      "DELETE /repos/o/r/issues/3/assignees": { status: 200, body: {} },
      "POST /repos/o/r/git/commits": { status: 201, body: { sha: "s" } },
    });
    const gh = createTransport({ request, repository: "o/r" });
    assert.deepEqual(JSON.parse(gh("label", "list", "--json", "name", "--limit", "500")), [{ name: "a" }, { name: "b" }]);
    gh("label", "create", "target:web", "--color", "#0f8a6a", "--description", "Web");
    assert.deepEqual(calls.at(-1).body, { name: "target:web", color: "0f8a6a", description: "Web" });
    assert.equal(gh("issue", "create", "--title", "T", "--body", "B", "--label", "prio:p1", "--label", "target:web"), "https://github.com/o/r/issues/3");
    assert.deepEqual(calls.at(-1).body, { title: "T", body: "B", labels: ["prio:p1", "target:web"] });
    gh("issue", "edit", "3", "--remove-assignee", "some-login");
    assert.deepEqual(calls.at(-1).body, { assignees: ["some-login"] });
    gh("api", "--method", "POST", "repos/o/r/git/commits", "-f", "tree=t", "-f", "parents[]=p", "-F", "force=true");
    assert.deepEqual(calls.at(-1).body, { tree: "t", parents: ["p"], force: true });
    assert.throws(() => gh("api", "user", "--jq", ".login"), UnsupportedCommand);
  });

  console.log(`Loop transport tests passed: ${passed} cases against a local stub server, local git remotes and fake requests.`);
} finally {
  server.kill();
}
