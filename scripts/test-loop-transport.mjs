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
import { spawn, spawnSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { relative, resolve, sep } from "node:path";
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
      // Manifest sources use `/`; `relative` answers with `\` on Windows.
      const source = relative(sourceRoot, resolve(libDir, name)).split(sep).join("/");
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

  console.log(`Loop transport tests passed: ${passed} cases against a local stub server.`);
} finally {
  server.kill();
}
