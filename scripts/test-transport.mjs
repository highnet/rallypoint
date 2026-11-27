#!/usr/bin/env node

// The loop's GitHub transport: which one `resolveTransport()` picks, the
// switch to REST when `gh` is refused GraphQL, every `gh` command the REST
// transport in `api.mjs` implements, and the Swarm runtime reaching GitHub
// through that same transport (doctor included). No network, no real GitHub:
// the REST transport runs against a stub `request`, and the end-to-end cases
// against a local stub server.
//
//   npm run cli:test        (builds the registry first, then runs this)

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const libDir = resolve(root, "registry/rallypoint/.rallypoint/scripts/lib");
const cli = resolve(root, "packages/cli/bin/rallypoint.mjs");

// The stub server is on loopback, and the REST child runs with
// NODE_USE_ENV_PROXY=1, so an agent session's HTTPS_PROXY would otherwise be
// asked to reach 127.0.0.1 on our behalf.
process.env.NO_PROXY = ["127.0.0.1", "localhost", process.env.NO_PROXY].filter(Boolean).join(",");
process.env.no_proxy = process.env.NO_PROXY;

const { createTransport, UnsupportedCommand, ApiError, applyJq } = await import(
  pathToFileURL(resolve(libDir, "api.mjs")).href
);
const { chooseTransport, isCloudSession, isGraphqlBlocked, withGraphqlFallback, resolveTransport } =
  await import(pathToFileURL(resolve(libDir, "gh.mjs")).href);

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

const GRAPHQL_403 =
  "HTTP 403: GitHub GraphQL is not available from Claude Code sessions; use the REST API (gh api repos/{owner}/{repo}/...)";

/** A `gh` failure the way `execFileSync` reports one. */
const ghFailure = (stderr) => Object.assign(new Error(`Command failed: gh\n${stderr}`), { status: 1, stderr });

// ---------------------------------------------------------------------------
// A stub GitHub for the REST transport: routes keyed by "METHOD path", each a
// response or a function of the call. Every call is recorded.
// ---------------------------------------------------------------------------

const stub = (routes) => {
  const calls = [];
  const request = (call) => {
    calls.push(call);
    const route = routes[`${call.method} ${call.path}`];
    if (route === undefined) return { status: 404, body: { message: `stub: no route for ${call.method} ${call.path}` } };
    const response = typeof route === "function" ? route(call) : route;
    return { status: 200, nextPath: null, ...response };
  };
  return { calls, gh: createTransport({ request, repository: "acme/app" }), request };
};

const ok = (body) => ({ status: 200, body });

const issue = (number, extra = {}) => ({
  number,
  node_id: `I_${number}`,
  title: `Issue ${number}`,
  body: `body ${number}`,
  state: "open",
  state_reason: null,
  html_url: `https://github.com/acme/app/issues/${number}`,
  labels: [{ id: 1, node_id: "LA_1", name: "status:claimed", color: "ededed", description: "claimed", default: false }],
  assignees: [{ login: "octo", node_id: "U_1", type: "User" }],
  user: { login: "octo", node_id: "U_1", type: "User" },
  created_at: "2026-11-01T00:00:00Z",
  updated_at: "2026-11-02T00:00:00Z",
  closed_at: null,
  ...extra,
});

const pull = (number, extra = {}) => ({
  number,
  node_id: `PR_${number}`,
  title: `Pull ${number}`,
  body: `Closes #${number - 100}`,
  state: "open",
  draft: false,
  html_url: `https://github.com/acme/app/pull/${number}`,
  labels: [{ id: 2, node_id: "LA_2", name: "review:approved", color: "0e8a16", description: "" }],
  assignees: [],
  user: { login: "dependabot[bot]", node_id: "B_1", type: "Bot" },
  head: { ref: `agent/${number - 100}-x`, sha: `sha${number}` },
  base: { ref: "main" },
  created_at: "2026-11-01T00:00:00Z",
  updated_at: "2026-11-03T00:00:00Z",
  closed_at: null,
  merged_at: null,
  merge_commit_sha: `merge${number}`,
  ...extra,
});

const throwsUnsupported = (fn, pattern) =>
  assert.throws(fn, (error) => error instanceof UnsupportedCommand && (pattern ? pattern.test(error.message) : true));

// ---------------------------------------------------------------------------
// transport choice
// ---------------------------------------------------------------------------

await test("chooseTransport: gh by default, REST without gh or in a cloud session", () => {
  const yes = () => true;
  const no = () => false;

  assert.equal(chooseTransport({ env: {}, hasGh: yes }).kind, "gh");
  assert.equal(chooseTransport({ env: {}, hasGh: no }).kind, "rest");
  assert.equal(chooseTransport({ env: { CLAUDE_CODE_REMOTE: "true" }, hasGh: yes }).kind, "rest");
  assert.equal(chooseTransport({ env: { CLAUDE_CODE_REMOTE: "1" }, hasGh: yes }).kind, "rest");
  assert.match(chooseTransport({ env: { CLAUDE_CODE_REMOTE: "true" }, hasGh: yes }).reason, /CLAUDE_CODE_REMOTE/);
  assert.equal(chooseTransport({ env: { CLAUDE_CODE_REMOTE: "false" }, hasGh: yes }).kind, "gh");
  assert.equal(chooseTransport({ env: { CLAUDE_CODE_REMOTE: "" }, hasGh: yes }).kind, "gh");
});

await test("chooseTransport: RALLYPOINT_TRANSPORT pins it; the test seam wins over cloud detection", () => {
  const yes = () => true;
  assert.equal(chooseTransport({ env: { RALLYPOINT_TRANSPORT: "rest" }, hasGh: yes }).kind, "rest");
  assert.equal(chooseTransport({ env: { RALLYPOINT_TRANSPORT: "GH", CLAUDE_CODE_REMOTE: "true" }, hasGh: yes }).kind, "gh");
  assert.throws(() => chooseTransport({ env: { RALLYPOINT_TRANSPORT: "graphql" }, hasGh: yes }), /must be "gh" or "rest"/);
  // A fixture that opted in to a fake `gh` must get it, even when the suite
  // itself runs inside a cloud session.
  assert.equal(
    chooseTransport({ env: { RALLYPOINT_GH_SCRIPT: "/fake.mjs", CLAUDE_CODE_REMOTE: "true" }, hasGh: () => false }).kind,
    "gh",
  );
});

await test("isCloudSession and isGraphqlBlocked", () => {
  assert.equal(isCloudSession({ CLAUDE_CODE_REMOTE: "true" }), true);
  assert.equal(isCloudSession({ CLAUDE_CODE_REMOTE: "TRUE" }), true);
  assert.equal(isCloudSession({}), false);
  assert.equal(isGraphqlBlocked(ghFailure(GRAPHQL_403)), true);
  assert.equal(isGraphqlBlocked(ghFailure("HTTP 403: Forbidden (https://api.github.com/graphql)")), true);
  assert.equal(isGraphqlBlocked(ghFailure("HTTP 403: Resource not accessible by integration (https://api.github.com/repos/a/b)")), false);
  assert.equal(isGraphqlBlocked(ghFailure("HTTP 422: Reference already exists")), false);
  assert.equal(isGraphqlBlocked(undefined), false);
});

await test("withGraphqlFallback: switches to REST for good on the GraphQL 403 and retries that call", () => {
  const primaryCalls = [];
  const fallbackCalls = [];
  let built = 0;
  const transport = withGraphqlFallback({
    primary: (...args) => {
      primaryCalls.push(args);
      if (args[0] === "pr") throw ghFailure(GRAPHQL_403);
      return "from-gh";
    },
    fallback: () => {
      built += 1;
      return (...args) => {
        fallbackCalls.push(args);
        return "from-rest";
      };
    },
  });

  assert.equal(transport("api", "user"), "from-gh");
  assert.equal(transport.switched(), false);
  assert.equal(transport("pr", "list"), "from-rest");
  assert.equal(transport.switched(), true);
  assert.equal(transport("api", "user"), "from-rest", "sticky after the switch");
  assert.equal(built, 1);
  assert.deepEqual(primaryCalls.map((args) => args[0]), ["api", "pr"]);
  assert.deepEqual(fallbackCalls.map((args) => args[0]), ["pr", "api"]);
});

await test("withGraphqlFallback: any other failure is thrown unchanged (claim atomicity)", () => {
  let built = false;
  const refused = ghFailure("HTTP 422: Reference already exists");
  const transport = withGraphqlFallback({
    primary: () => {
      throw refused;
    },
    fallback: () => {
      built = true;
      return () => "never";
    },
  });

  assert.throws(() => transport("api", "--method", "POST", "repos/acme/app/git/refs"), (error) => error === refused);
  assert.equal(built, false, "a refused reservation must not be retried elsewhere");
});

await test("resolveTransport: a cloud session goes straight to REST and never runs gh", () => {
  const { request, calls } = stub({ "GET /repos/acme/app": ok({ full_name: "acme/app", default_branch: "main" }) });
  const transport = resolveTransport({
    env: { CLAUDE_CODE_REMOTE: "true" },
    remote: "https://github.com/acme/app.git",
    probe: () => true,
    binary: () => assert.fail("gh must not run in a cloud session"),
    request,
  });

  assert.equal(transport.describe().kind, "rest");
  assert.equal(transport("repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"), "acme/app");
  assert.equal(calls.length, 1);
});

await test("resolveTransport: gh elsewhere, and REST from the first GraphQL 403", () => {
  const { request, calls } = stub({
    "GET /repos/acme/app/pulls?state=open&per_page=1": ok([pull(121)]),
  });
  const binaryCalls = [];
  const transport = resolveTransport({
    env: {},
    remote: "git@github.com:acme/app.git",
    probe: () => true,
    quiet: true,
    binary: (...args) => {
      binaryCalls.push(args);
      if (args[0] === "api") return "octo";
      throw ghFailure(GRAPHQL_403);
    },
    request,
  });

  assert.equal(transport.describe().kind, "gh");
  assert.equal(transport("api", "user", "--jq", ".login"), "octo");
  assert.equal(calls.length, 0);
  assert.deepEqual(JSON.parse(transport("pr", "list", "--limit", "1", "--json", "number")), [{ number: 121 }]);
  assert.equal(transport.describe().kind, "rest");
  assert.match(transport.describe().reason, /GraphQL/);
  assert.equal(binaryCalls.length, 2);
});

await test("resolveTransport: REST with no repository throws (or exits) by name", () => {
  const transport = resolveTransport({
    env: { CLAUDE_CODE_REMOTE: "true" },
    remote: "",
    probe: () => true,
    exitOnMissingRepository: false,
    request: () => assert.fail("no request without a repository"),
  });
  assert.throws(() => transport("repo", "view", "--json", "nameWithOwner"), /GITHUB_REPOSITORY/);
});

// ---------------------------------------------------------------------------
// api.mjs: the contract
// ---------------------------------------------------------------------------

await test("contract: a refused request throws ApiError with the status", () => {
  const { gh } = stub({
    "POST /repos/acme/app/git/refs": { status: 422, body: { message: "Reference already exists" } },
  });
  assert.throws(
    () => gh("api", "--method", "POST", "repos/acme/app/git/refs", "-f", "ref=refs/heads/x", "-f", "sha=abc"),
    (error) => error instanceof ApiError && error.status === 422 && /Reference already exists/.test(error.message),
  );
});

await test("contract: unknown commands, flags and fields throw by name", () => {
  const { gh, calls } = stub({ "GET /repos/acme/app/pulls/5": ok(pull(5)), "GET /repos/acme/app/issues/5": ok(issue(5)) });
  throwsUnsupported(() => gh("release", "list"));
  throwsUnsupported(() => gh("workflow", "run", "x"));
  throwsUnsupported(() => gh("pr", "edit", "5", "--title", "x"), /unknown flag --title/);
  throwsUnsupported(() => gh("issue", "list", "--search", "x", "--json", "number"), /unknown flag --search/);
  throwsUnsupported(() => gh("issue", "view", "5", "--json", "number,projectItems"), /field projectItems/);
  throwsUnsupported(() => gh("issue", "view", "5"), /--json is required/);
  // GraphQL-only fields: no REST equivalent, so they throw rather than guess.
  throwsUnsupported(() => gh("issue", "view", "5", "--json", "state,closedByPullRequestsReferences"));
  throwsUnsupported(() => gh("pr", "view", "5", "--json", "number,closingIssuesReferences"));
  throwsUnsupported(() => gh("api", "graphql", "-f", "query=x", "--header", "X: y"), /unknown flag --header/);
  throwsUnsupported(() => gh("issue", "view", "5", "--json", "title", "--jq", ".title | length"), /--jq/);
  // Nothing was mutated on the way to any of those throws.
  assert.ok(calls.every((call) => call.method === "GET"));
});

// ---------------------------------------------------------------------------
// repo
// ---------------------------------------------------------------------------

await test("repo view --json [--jq]", () => {
  const { gh } = stub({
    "GET /repos/acme/app": ok({ full_name: "acme/app", name: "app", default_branch: "trunk", private: true, owner: { login: "acme" } }),
  });
  assert.deepEqual(JSON.parse(gh("repo", "view", "--json", "nameWithOwner,defaultBranchRef")), {
    nameWithOwner: "acme/app",
    defaultBranchRef: { name: "trunk" },
  });
  assert.equal(gh("repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"), "acme/app");
  assert.equal(JSON.parse(gh("repo", "view", "--json", "visibility")).visibility, "PRIVATE");
});

// ---------------------------------------------------------------------------
// issues
// ---------------------------------------------------------------------------

await test("issue list: gh's shapes, pull requests filtered out, labels and assignee passed through", () => {
  const { gh, calls } = stub({
    "GET /repos/acme/app/issues?state=open&per_page=30&labels=status%3Ablocked&assignee=*": ok([
      issue(1),
      { ...issue(2), pull_request: {} },
    ]),
  });
  const listed = JSON.parse(
    gh("issue", "list", "--state", "open", "--label", "status:blocked", "--assignee", "*", "--json", "number,title,labels,assignees,state,body"),
  );
  assert.equal(calls.length, 1);
  assert.deepEqual(listed, [
    {
      number: 1,
      title: "Issue 1",
      labels: [{ id: "LA_1", name: "status:claimed", description: "claimed", color: "ededed" }],
      assignees: [{ id: "U_1", login: "octo", name: "" }],
      state: "OPEN",
      body: "body 1",
    },
  ]);
});

await test("issue list: --limit beyond one page follows the pages and stops at the limit", () => {
  const page = (from, count) => Array.from({ length: count }, (_, index) => issue(from + index));
  const { gh, calls } = stub({
    "GET /repos/acme/app/issues?state=open&per_page=100": {
      body: [...page(1, 99), { ...issue(1000), pull_request: {} }],
      nextPath: "/page2",
    },
    "GET /page2": { body: page(100, 100), nextPath: "/page3" },
    "GET /page3": { body: page(200, 100), nextPath: null },
  });
  const listed = JSON.parse(gh("issue", "list", "--state", "open", "--limit", "150", "--json", "number"));
  assert.equal(listed.length, 150);
  assert.equal(listed.at(-1).number, 150);
  assert.ok(!listed.some((entry) => entry.number === 1000), "pull requests are not issues");
  assert.equal(calls.length, 2, "stops once the limit is in hand");
});

await test("issue list --json comments and issue view: comments in gh's shape", () => {
  const comment = {
    node_id: "IC_1",
    user: { login: "octo" },
    author_association: "owner",
    body: "<!-- rallypoint -->",
    created_at: "2026-11-05T00:00:00Z",
    updated_at: "2026-11-05T00:00:00Z",
    html_url: "https://github.com/acme/app/issues/7#issuecomment-1",
  };
  const { gh } = stub({
    "GET /repos/acme/app/issues/7": ok(issue(7, { state: "closed", state_reason: "completed", closed_at: "2026-11-06T00:00:00Z" })),
    "GET /repos/acme/app/issues/7/comments?per_page=100": { body: [comment], nextPath: "/c2" },
    "GET /c2": ok([{ ...comment, node_id: "IC_2", updated_at: "2026-11-07T00:00:00Z" }]),
  });
  const viewed = JSON.parse(gh("issue", "view", "7", "--json", "state,stateReason,closedAt,comments,labels,assignees"));
  assert.equal(viewed.state, "CLOSED");
  assert.equal(viewed.stateReason, "COMPLETED");
  assert.equal(viewed.closedAt, "2026-11-06T00:00:00Z");
  assert.deepEqual(viewed.comments[0], {
    id: "IC_1",
    author: { login: "octo" },
    authorAssociation: "OWNER",
    body: "<!-- rallypoint -->",
    createdAt: "2026-11-05T00:00:00Z",
    includesCreatedEdit: false,
    url: "https://github.com/acme/app/issues/7#issuecomment-1",
  });
  assert.equal(viewed.comments[1].includesCreatedEdit, true);
  assert.equal(viewed.comments.length, 2);
});

await test("issue view only fetches comments when asked", () => {
  const { gh, calls } = stub({ "GET /repos/acme/app/issues/8": ok(issue(8)) });
  assert.deepEqual(JSON.parse(gh("issue", "view", "8", "--json", "state")), { state: "OPEN" });
  assert.equal(calls.length, 1);
});

await test("issue create: labels and assignees, prints the issue URL", () => {
  const { gh, calls } = stub({
    "GET /user": ok({ login: "bot" }),
    "POST /repos/acme/app/issues": ok({ number: 99, html_url: "https://github.com/acme/app/issues/99" }),
  });
  const url = gh("issue", "create", "--title", "Faster parse", "--body", "Do it", "--label", "prio:p1", "--label", "target:api,type:feat", "--assignee", "@me");
  assert.equal(url, "https://github.com/acme/app/issues/99");
  assert.deepEqual(calls.at(-1).body, {
    title: "Faster parse",
    body: "Do it",
    labels: ["prio:p1", "target:api", "type:feat"],
    assignees: ["bot"],
  });
  throwsUnsupported(() => gh("issue", "create", "--body", "no title"), /--title/);
});

await test("issue edit: @me and named logins, labels added and removed, a missing label is not an error", () => {
  const { gh, calls } = stub({
    "GET /user": ok({ login: "bot" }),
    "POST /repos/acme/app/issues/3/assignees": ok({}),
    "DELETE /repos/acme/app/issues/3/assignees": ok({}),
    "POST /repos/acme/app/issues/3/labels": ok([]),
    "DELETE /repos/acme/app/issues/3/labels/status%3Aclaimed": { status: 404, body: { message: "Label does not exist" } },
  });
  assert.equal(
    gh("issue", "edit", "3", "--add-assignee", "@me", "--remove-assignee", "alice", "--remove-assignee", "bob", "--add-label", "status:blocked", "--remove-label", "status:claimed"),
    "",
  );
  const mutations = calls.filter((call) => call.method !== "GET");
  assert.deepEqual(mutations.map((call) => [call.method, call.path, call.body]), [
    ["POST", "/repos/acme/app/issues/3/assignees", { assignees: ["bot"] }],
    ["DELETE", "/repos/acme/app/issues/3/assignees", { assignees: ["alice", "bob"] }],
    ["POST", "/repos/acme/app/issues/3/labels", { labels: ["status:blocked"] }],
    ["DELETE", "/repos/acme/app/issues/3/labels/status%3Aclaimed", undefined],
  ]);
});

await test("issue edit: any other failure throws, so claim.mjs compensates", () => {
  const { gh } = stub({
    "POST /repos/acme/app/issues/3/labels": { status: 403, body: { message: "Resource not accessible" } },
  });
  assert.throws(() => gh("issue", "edit", "3", "--add-label", "status:claimed"), (error) => error instanceof ApiError && error.status === 403);
});

await test("issue comment prints the comment URL", () => {
  const { gh, calls } = stub({
    "POST /repos/acme/app/issues/4/comments": ok({ html_url: "https://github.com/acme/app/issues/4#issuecomment-9" }),
  });
  assert.equal(gh("issue", "comment", "4", "--body", "hello"), "https://github.com/acme/app/issues/4#issuecomment-9");
  assert.deepEqual(calls[0].body, { body: "hello" });
});

await test("issue close: comments first, then closes with the reason", () => {
  const { gh, calls } = stub({
    "POST /repos/acme/app/issues/5/comments": ok({}),
    "PATCH /repos/acme/app/issues/5": ok(issue(5, { state: "closed" })),
  });
  assert.equal(gh("issue", "close", "5", "--reason", "completed", "--comment", "Closed by #12"), "");
  assert.deepEqual(calls.map((call) => [call.method, call.path, call.body]), [
    ["POST", "/repos/acme/app/issues/5/comments", { body: "Closed by #12" }],
    ["PATCH", "/repos/acme/app/issues/5", { state: "closed", state_reason: "completed" }],
  ]);
  gh("issue", "close", "5", "--reason", "not planned");
  assert.deepEqual(calls.at(-1).body, { state: "closed", state_reason: "not_planned" });
  throwsUnsupported(() => gh("issue", "close", "5", "--reason", "duplicate"));
});

// ---------------------------------------------------------------------------
// pull requests
// ---------------------------------------------------------------------------

await test("pr list: the swarm's exact call, in gh's shape", () => {
  const { gh, calls } = stub({
    "GET /repos/acme/app/pulls?state=open&per_page=100": ok([pull(121, { draft: true }), pull(122)]),
  });
  const listed = JSON.parse(
    gh("pr", "list", "--state", "open", "--json", "number,title,labels,isDraft,body,headRefName", "--limit", "200"),
  );
  assert.equal(calls.length, 1);
  assert.deepEqual(listed[0], {
    number: 121,
    title: "Pull 121",
    labels: [{ id: "LA_2", name: "review:approved", description: "", color: "0e8a16" }],
    isDraft: true,
    body: "Closes #21",
    headRefName: "agent/21-x",
  });
});

await test("pr list: --head as owner:branch, --state all|merged, labels, author", () => {
  const { gh, calls } = stub({
    "GET /repos/acme/app/pulls?state=all&per_page=50&head=acme%3Aagent%2F4-x": ok([
      pull(130, { state: "closed", merged_at: "2026-11-04T00:00:00Z", closed_at: "2026-11-04T00:00:00Z" }),
    ]),
    "GET /repos/acme/app/pulls?state=closed&per_page=30": ok([
      pull(131, { state: "closed", closed_at: "2026-11-04T00:00:00Z" }),
      pull(132, { state: "closed", merged_at: "2026-11-04T00:00:00Z" }),
    ]),
    "GET /repos/acme/app/pulls?state=open&per_page=30": ok([pull(133), pull(134, { labels: [] })]),
  });
  assert.deepEqual(JSON.parse(gh("pr", "list", "--head", "agent/4-x", "--state", "all", "--limit", "50", "--json", "number,state,mergedAt,closedAt")), [
    { number: 130, state: "MERGED", mergedAt: "2026-11-04T00:00:00Z", closedAt: "2026-11-04T00:00:00Z" },
  ]);
  assert.deepEqual(JSON.parse(gh("pr", "list", "--state", "merged", "--json", "number")), [{ number: 132 }]);
  assert.deepEqual(JSON.parse(gh("pr", "list", "--state", "closed", "--json", "number,state")), [
    { number: 131, state: "CLOSED" },
    { number: 132, state: "MERGED" },
  ]);
  assert.deepEqual(JSON.parse(gh("pr", "list", "--label", "review:approved", "--json", "number,author,headRefOid,updatedAt")), [
    { number: 133, author: { id: "B_1", is_bot: true, login: "dependabot[bot]", name: "" }, headRefOid: "sha133", updatedAt: "2026-11-03T00:00:00Z" },
  ]);
  assert.equal(calls.length, 4);
});

await test("pr view: by number, URL or branch (the open one wins); state, mergeCommit, refs", () => {
  const merged = pull(140, { state: "closed", merged_at: "2026-11-04T00:00:00Z", mergeable: null, mergeable_state: "unknown" });
  const { gh } = stub({
    "GET /repos/acme/app/pulls/140": ok(merged),
    "GET /repos/acme/app/pulls?head=acme%3Aagent%2F40-x&state=all&per_page=100": ok([
      pull(139, { state: "closed" }),
      pull(141),
    ]),
    "GET /repos/acme/app/pulls?head=acme%3Agone&state=all&per_page=100": ok([]),
  });
  assert.deepEqual(JSON.parse(gh("pr", "view", "140", "--json", "state,mergedAt,mergeCommit,headRefName,headRefOid,baseRefName")), {
    state: "MERGED",
    mergedAt: "2026-11-04T00:00:00Z",
    mergeCommit: { oid: "merge140" },
    headRefName: "agent/40-x",
    headRefOid: "sha140",
    baseRefName: "main",
  });
  assert.equal(gh("pr", "view", "140", "--json", "mergeCommit", "--jq", ".mergeCommit.oid"), "merge140");
  assert.equal(JSON.parse(gh("pr", "view", "https://github.com/acme/app/pull/140", "--json", "number")).number, 140);
  assert.equal(JSON.parse(gh("pr", "view", "agent/40-x", "--json", "number")).number, 141);
  assert.throws(() => gh("pr", "view", "gone", "--json", "number"), /no pull requests found for branch "gone"/);
});

await test("pr view: an unmerged pull request's mergeCommit is null, and --jq prints nothing", () => {
  const { gh } = stub({ "GET /repos/acme/app/pulls/150": ok(pull(150, { mergeable: true, mergeable_state: "clean" })) });
  assert.equal(JSON.parse(gh("pr", "view", "150", "--json", "mergeCommit")).mergeCommit, null);
  assert.equal(gh("pr", "view", "150", "--json", "mergeCommit", "--jq", ".mergeCommit.oid"), "");
});

await test("pr view: the merger's mergeable, mergeStateStatus and statusCheckRollup, over REST", () => {
  const { gh, calls } = stub({
    "GET /repos/acme/app/pulls/160": ok(pull(160, { mergeable: false, mergeable_state: "dirty" })),
    "GET /repos/acme/app/commits/sha160/check-runs?per_page=100": ok({
      total_count: 2,
      check_runs: [
        {
          name: "Lint",
          status: "completed",
          conclusion: "success",
          started_at: "2026-11-01T00:00:00Z",
          completed_at: "2026-11-01T00:01:00Z",
          details_url: "https://ci/1",
          app: { slug: "github-actions" },
          check_suite: { id: 77 },
        },
        { name: "E2E", status: "in_progress", conclusion: null, started_at: "2026-11-01T00:00:00Z", completed_at: null, details_url: "", app: { slug: "github-actions" }, check_suite: { id: 78 } },
      ],
    }),
    "GET /repos/acme/app/actions/runs?head_sha=sha160&per_page=100": ok({ workflow_runs: [{ check_suite_id: 77, name: "CI" }] }),
    "GET /repos/acme/app/commits/sha160/status": ok({
      statuses: [{ context: "vercel", state: "failure", target_url: "https://vercel/1", created_at: "2026-11-01T00:00:00Z" }],
    }),
  });
  const view = JSON.parse(gh("pr", "view", "160", "--json", "mergeable,mergeStateStatus,statusCheckRollup"));
  assert.equal(view.mergeable, "CONFLICTING");
  assert.equal(view.mergeStateStatus, "DIRTY");
  assert.deepEqual(view.statusCheckRollup, [
    { __typename: "CheckRun", completedAt: "2026-11-01T00:01:00Z", conclusion: "SUCCESS", detailsUrl: "https://ci/1", name: "Lint", startedAt: "2026-11-01T00:00:00Z", status: "COMPLETED", workflowName: "CI" },
    { __typename: "CheckRun", completedAt: "0001-01-01T00:00:00Z", conclusion: "", detailsUrl: "", name: "E2E", startedAt: "2026-11-01T00:00:00Z", status: "IN_PROGRESS", workflowName: "" },
    { __typename: "StatusContext", context: "vercel", startedAt: "2026-11-01T00:00:00Z", state: "FAILURE", targetUrl: "https://vercel/1" },
  ]);
  assert.ok(!calls.some((call) => call.path.includes("graphql")), "never GraphQL");
});

await test("pr view: mergeable from a list record fetches the single route once", () => {
  const { gh, calls } = stub({
    "GET /repos/acme/app/pulls?state=open&per_page=30": ok([pull(170)]),
    "GET /repos/acme/app/pulls/170": ok(pull(170, { mergeable: null, mergeable_state: "unknown" })),
  });
  assert.deepEqual(JSON.parse(gh("pr", "list", "--json", "number,mergeable,mergeStateStatus")), [
    { number: 170, mergeable: "UNKNOWN", mergeStateStatus: "UNKNOWN" },
  ]);
  assert.equal(calls.length, 2);
});

await test("pr edit: labels through the issue routes", () => {
  const { gh, calls } = stub({
    "POST /repos/acme/app/issues/21/labels": ok([]),
    "DELETE /repos/acme/app/issues/21/labels/review%3Aapproved": ok(null),
  });
  gh("pr", "edit", "21", "--add-label", "status:changes-requested");
  gh("pr", "edit", "21", "--remove-label", "review:approved");
  assert.deepEqual(calls.map((call) => [call.method, call.path, call.body]), [
    ["POST", "/repos/acme/app/issues/21/labels", { labels: ["status:changes-requested"] }],
    ["DELETE", "/repos/acme/app/issues/21/labels/review%3Aapproved", undefined],
  ]);
});

await test("pr review: --comment, --approve and --request-changes as REST review events", () => {
  const { gh, calls } = stub({ "POST /repos/acme/app/pulls/21/reviews": ok({}) });
  gh("pr", "review", "21", "--comment", "--body", "verdict");
  gh("pr", "review", "21", "--approve");
  gh("pr", "review", "21", "--request-changes", "--body", "fix it");
  assert.deepEqual(calls.map((call) => call.body), [
    { event: "COMMENT", body: "verdict" },
    { event: "APPROVE" },
    { event: "REQUEST_CHANGES", body: "fix it" },
  ]);
  assert.throws(() => gh("pr", "review", "21", "--comment"), /body cannot be blank/);
  throwsUnsupported(() => gh("pr", "review", "21", "--approve", "--comment", "--body", "x"), /exactly one/);
  assert.equal(calls.length, 3);
});

await test("pr merge: PUT /pulls/{n}/merge with the method, subject, body and head guard", () => {
  const { gh, calls } = stub({ "PUT /repos/acme/app/pulls/21/merge": ok({ merged: true, sha: "m" }) });
  assert.equal(gh("pr", "merge", "21", "--merge"), "");
  gh("pr", "merge", "21", "--squash", "--subject", "feat: x", "--body", "details", "--match-head-commit", "abc");
  gh("pr", "merge", "21", "--rebase");
  assert.deepEqual(calls.map((call) => [call.method, call.path, call.body]), [
    ["PUT", "/repos/acme/app/pulls/21/merge", { merge_method: "merge" }],
    ["PUT", "/repos/acme/app/pulls/21/merge", { merge_method: "squash", commit_title: "feat: x", commit_message: "details", sha: "abc" }],
    ["PUT", "/repos/acme/app/pulls/21/merge", { merge_method: "rebase" }],
  ]);
  assert.throws(() => gh("pr", "merge", "21"), /--merge, --rebase, or --squash required/);
  throwsUnsupported(() => gh("pr", "merge", "21", "--merge", "--delete-branch"), /delete-merged-branch/);
});

await test("pr merge: a refused merge throws (branch protection, conflicts, stale head)", () => {
  const { gh } = stub({
    "PUT /repos/acme/app/pulls/21/merge": { status: 409, body: { message: "Head branch was modified. Review and try the merge again." } },
  });
  assert.throws(() => gh("pr", "merge", "21", "--merge", "--match-head-commit", "old"), (error) => error instanceof ApiError && error.status === 409);
});

await test("pr merge --auto: REST only — the cloud proxy's route where it exists, a named refusal elsewhere", () => {
  const plain = stub({});
  throwsUnsupported(() => plain.gh("pr", "merge", "21", "--auto", "--squash"), /auto-merge only through GraphQL/);
  throwsUnsupported(() => plain.gh("pr", "merge", "21", "--disable-auto"), /auto-merge only through GraphQL/);
  assert.equal(plain.calls.length, 0);

  const calls = [];
  const gh = createTransport({
    repository: "acme/app",
    autoMergeRoute: true,
    request: (call) => {
      calls.push(call);
      return { status: 200, body: {} };
    },
  });
  gh("pr", "merge", "21", "--auto", "--squash", "--subject", "feat: x");
  gh("pr", "merge", "21", "--disable-auto");
  assert.deepEqual(calls.map((call) => [call.method, call.path, call.body]), [
    ["PUT", "/repos/acme/app/pulls/21/ccr/auto_merge", { merge_method: "squash", commit_title: "feat: x" }],
    ["DELETE", "/repos/acme/app/pulls/21/ccr/auto_merge", undefined],
  ]);
});

// ---------------------------------------------------------------------------
// labels
// ---------------------------------------------------------------------------

await test("label list --json name --limit 500 reads every page up to the limit", () => {
  const labels = (from, count) => Array.from({ length: count }, (_, index) => ({ name: `l${from + index}`, color: "000000", node_id: `L${from + index}`, default: false }));
  const { gh, calls } = stub({
    "GET /repos/acme/app/labels?per_page=100": { body: labels(0, 100), nextPath: "/labels2" },
    "GET /labels2": { body: labels(100, 20), nextPath: null },
  });
  const listed = JSON.parse(gh("label", "list", "--json", "name", "--limit", "500"));
  assert.equal(listed.length, 120);
  assert.deepEqual(listed[0], { name: "l0" });
  assert.equal(calls.length, 2);
  assert.deepEqual(JSON.parse(stub({ "GET /repos/acme/app/labels?per_page=30": ok(labels(0, 1)) }).gh("label", "list", "--json", "name,color,isDefault")), [
    { name: "l0", color: "000000", isDefault: false },
  ]);
});

await test("label create: color without #, description; --force updates an existing label", () => {
  const { gh, calls } = stub({
    "POST /repos/acme/app/labels": (call) =>
      call.body.name === "exists" ? { status: 422, body: { message: "Validation Failed" } } : { status: 201, body: {} },
    "PATCH /repos/acme/app/labels/exists": ok({}),
  });
  assert.equal(gh("label", "create", "target:api", "--color", "#0e8a16", "--description", "Backend"), "");
  assert.deepEqual(calls[0].body, { name: "target:api", color: "0e8a16", description: "Backend" });
  assert.throws(() => gh("label", "create", "exists", "--color", "ffffff"), (error) => error instanceof ApiError && error.status === 422);
  gh("label", "create", "exists", "--color", "ffffff", "--force");
  assert.deepEqual(calls.at(-1), { method: "PATCH", path: "/repos/acme/app/labels/exists", body: { name: "exists", color: "ffffff" } });
});

// ---------------------------------------------------------------------------
// gh api
// ---------------------------------------------------------------------------

await test("api: GET, --jq, {owner}/{repo}, and a 204 printing nothing", () => {
  const { gh, calls } = stub({
    "GET /user": ok({ login: "swarm-bot" }),
    "GET /repos/acme/app/git/ref/heads/main": ok({ object: { sha: "abc" } }),
    "DELETE /repos/acme/app/git/refs/heads/rallypoint-claims/issue-4": { status: 204, body: null },
  });
  assert.equal(gh("api", "user", "--jq", ".login"), "swarm-bot");
  assert.deepEqual(JSON.parse(gh("api", "repos/{owner}/{repo}/git/ref/heads/main")), { object: { sha: "abc" } });
  assert.equal(gh("api", "--method", "DELETE", "repos/acme/app/git/refs/heads/rallypoint-claims/issue-4"), "");
  assert.deepEqual(calls.map((call) => call.method), ["GET", "GET", "DELETE"]);
});

await test("api: -f strings, -F typed values, key[] arrays (lease.mjs), and POST implied by fields", () => {
  const { gh, calls } = stub({
    "POST /repos/acme/app/git/commits": ok({ sha: "c1" }),
    "PATCH /repos/acme/app/git/refs/heads/lease": ok({}),
    "POST /repos/acme/app/git/refs": ok({}),
  });
  gh("api", "--method", "POST", "repos/acme/app/git/commits", "-f", "message=lease", "-f", "tree=t1", "-f", "parents[]=p1");
  gh("api", "--method", "PATCH", "repos/acme/app/git/refs/heads/lease", "-f", "sha=c1", "-F", "force=true");
  gh("api", "repos/acme/app/git/refs", "-f", "ref=refs/heads/x", "-F", "count=3", "-F", "nothing=null", "-F", "word=text");
  assert.deepEqual(calls.map((call) => [call.method, call.body]), [
    ["POST", { message: "lease", tree: "t1", parents: ["p1"] }],
    ["PATCH", { sha: "c1", force: true }],
    ["POST", { ref: "refs/heads/x", count: 3, nothing: null, word: "text" }],
  ]);
});

await test("api: GET with fields sends them as the query string", () => {
  const { gh, calls } = stub({ "GET /repos/acme/app/pulls?state=closed&per_page=100": ok([]) });
  gh("api", "--method", "GET", "repos/acme/app/pulls", "-f", "state=closed", "-F", "per_page=100");
  assert.equal(calls[0].body, undefined);
});

await test("api: --paginate concatenates array pages; --slurp keeps them apart", () => {
  const routes = {
    "GET /repos/acme/app/issues/4/events?per_page=100": { body: [{ id: 1 }], nextPath: "/events2" },
    "GET /events2": { body: [{ id: 2 }], nextPath: null },
  };
  assert.deepEqual(JSON.parse(stub(routes).gh("api", "--paginate", "repos/acme/app/issues/4/events?per_page=100")), [{ id: 1 }, { id: 2 }]);
  assert.deepEqual(JSON.parse(stub(routes).gh("api", "--paginate", "--slurp", "repos/acme/app/issues/4/events?per_page=100")), [[{ id: 1 }], [{ id: 2 }]]);
  throwsUnsupported(() => stub(routes).gh("api", "--slurp", "repos/acme/app/issues/4/events"), /--slurp needs --paginate/);
});

await test("applyJq: the path subset gh --jq output, strings raw, null empty", () => {
  const data = { login: "octo", nested: { list: [{ name: "a" }, { name: "b" }] }, nothing: null, count: 3 };
  assert.equal(applyJq(data, ".login", []), "octo");
  assert.equal(applyJq(data, ".nothing", []), "");
  assert.equal(applyJq(data, ".missing.deeper", []), "");
  assert.equal(applyJq(data, ".count", []), "3");
  assert.equal(applyJq(data, ".nested.list[].name", []), "a\nb");
  assert.equal(applyJq(data, ".nested.list[1]", []), '{"name":"b"}');
  assert.equal(applyJq([{ name: "x" }], ".[].name", []), "x");
  assert.equal(applyJq(data, ".", []), JSON.stringify(data));
  throwsUnsupported(() => applyJq(data, ".nested | keys", []));
  throwsUnsupported(() => applyJq(data, 'map(.name)', []));
});

// ---------------------------------------------------------------------------
// Coverage: every `gh` call the scripts and the swarm make is one of the
// commands above. A call added later that this file does not know fails here,
// not in a cloud session.
// ---------------------------------------------------------------------------

await test("coverage: every gh subcommand in .rallypoint/scripts and swarm.mjs is implemented", async () => {
  const { readdir } = await import("node:fs/promises");
  const sources = [];
  const walk = async (dir) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = resolve(dir, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.name.endsWith(".mjs")) sources.push(path);
    }
  };
  await walk(resolve(root, "registry/rallypoint/.rallypoint/scripts"));
  await walk(resolve(root, "registry/rallypoint/swarm"));

  const implemented = new Set([
    "repo view", "issue list", "issue view", "issue create", "issue edit", "issue comment", "issue close",
    "pr list", "pr view", "pr edit", "pr review", "pr merge", "label list", "label create",
  ]);
  const found = new Set();
  for (const path of sources) {
    if (path.endsWith("/lib/api.mjs")) continue;
    const source = await readFile(path, "utf8");
    // `gh("pr", "view"`, `ghJson("label", "list"`, `run("gh", "issue", "view"`,
    // `execute("gh", "issue", "edit"` — across line breaks too.
    for (const match of source.matchAll(/\b(?:gh|ghJson|run|execute)\(\s*(?:"gh",\s*)?"(repo|issue|pr|label|run|release|workflow|secret|search|project|cache|gist|ruleset|variable)",\s*"([a-z-]+)"/g)) {
      found.add(`${match[1]} ${match[2]}`);
    }
  }

  assert.ok(found.size >= 10, `scanner found too little: ${[...found].join(", ")}`);
  const missing = [...found].filter((command) => !implemented.has(command));
  assert.deepEqual(missing, [], "add these to api.mjs");
  const gh = createTransport({ repository: "acme/app", request: () => assert.fail("no request for a bad flag") });
  for (const command of implemented) {
    // Each one is wired to a handler, which rejects a flag it was not taught
    // before making any request.
    const [group, sub] = command.split(" ");
    throwsUnsupported(() => gh(group, sub, "--bogus-flag"), /unknown flag --bogus-flag/);
  }
});

// ---------------------------------------------------------------------------
// End to end: the installed loop and swarm, in a "cloud session", with a `gh`
// that is refused GraphQL and a stub GitHub REST API.
// ---------------------------------------------------------------------------

const fixture = await mkdtemp(resolve(tmpdir(), "rallypoint-transport-"));
const fakeGh = resolve(fixture, "..", `fake-gh-graphql-403-${process.pid}.mjs`);
const ghLog = resolve(fixture, ".gh-log.jsonl");

// Every REST request the runtime makes, answered by path.
const seen = [];
const server = createServer((request, response) => {
  seen.push(`${request.method} ${request.url}`);
  const url = new URL(request.url, "http://stub");
  const reply = (status, body) => {
    response.writeHead(status, { "content-type": "application/json" });
    response.end(JSON.stringify(body));
  };
  if (url.pathname === "/user") return reply(200, { login: "swarm-bot" });
  if (url.pathname === "/repos/acme/app") return reply(200, { full_name: "acme/app", default_branch: "main" });
  if (url.pathname === "/repos/acme/app/pulls") return reply(200, [pull(121)]);
  if (url.pathname === "/repos/acme/app/issues") return reply(200, [issue(21, { labels: [] })]);
  return reply(404, { message: `stub: ${request.url}` });
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const apiUrl = `http://127.0.0.1:${server.address().port}`;

await writeFile(
  fakeGh,
  `
import { appendFileSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(${JSON.stringify(ghLog)}, JSON.stringify(args) + "\\n");
if (args[0] === "--version") { console.log("gh version 2.89.0"); process.exit(0); }
if (args[0] === "api") { console.log("swarm-bot"); process.exit(0); }
console.error(${JSON.stringify(GRAPHQL_403)});
process.exit(1);
`,
);

const baseEnv = {
  ...process.env,
  GITHUB_REPOSITORY: "acme/app",
  RALLYPOINT_GITHUB_API_URL: apiUrl,
  GH_TOKEN: "",
  GITHUB_TOKEN: "",
  RALLYPOINT_SUPABASE_URL: "",
  RALLYPOINT_SUPABASE_KEY: "",
};
delete baseEnv.RALLYPOINT_GH_SCRIPT;
delete baseEnv.RALLYPOINT_TRANSPORT;

const runNode = (args, env) =>
  new Promise((done) => {
    const child = spawn(process.execPath, args, { cwd: fixture, env });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("close", (status) => done({ status, stdout, stderr }));
  });

try {
  spawnSync("git", ["init", "-q", "-b", "main"], { cwd: fixture });
  for (const item of ["loop", "swarm"]) {
    const installed = spawnSync(process.execPath, [cli, "add", item], { cwd: fixture, encoding: "utf8" });
    assert.equal(installed.status, 0, installed.stderr);
  }
  const swarm = resolve(fixture, ".rallypoint/swarm/swarm.mjs");
  const ghScript = resolve(fixture, ".rallypoint/scripts/gh.mjs");

  await test("e2e: in a cloud session the swarm reaches GitHub over REST, and doctor says so", async () => {
    seen.length = 0;
    const { stdout } = await runNode([swarm, "doctor", "--json"], { ...baseEnv, CLAUDE_CODE_REMOTE: "true" });
    const checks = JSON.parse(stdout).checks;
    const transport = checks.find((check) => check.name === "transport");
    assert.equal(transport.ok, true, transport.detail);
    assert.match(transport.detail, /^rest: can list pull requests \(Claude Code cloud session/);
    assert.equal(checks.find((check) => check.name === "gh").detail, "authenticated as swarm-bot");
    assert.ok(seen.some((line) => line.startsWith("GET /repos/acme/app/pulls?")), seen.join("\n"));
  });

  await test("e2e: a gh refused GraphQL falls back to REST mid-command (RALLYPOINT_GH_SCRIPT seam kept)", async () => {
    seen.length = 0;
    await rm(ghLog, { force: true });
    const { stdout, stderr } = await runNode([swarm, "doctor", "--json"], { ...baseEnv, CLAUDE_CODE_REMOTE: "", RALLYPOINT_GH_SCRIPT: fakeGh });
    const transport = JSON.parse(stdout).checks.find((check) => check.name === "transport");
    assert.equal(transport.ok, true, transport.detail);
    assert.match(transport.detail, /^rest: .*GraphQL is blocked here/);
    assert.match(stderr, /using the REST transport/);
    const ghCalls = (await readFile(ghLog, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
    assert.deepEqual(ghCalls.map((args) => args.slice(0, 2).join(" ")), ["--version", "api user", "pr list"]);
  });

  await test("e2e: doctor fails the transport check when nothing can list pull requests", async () => {
    const { stdout } = await runNode([swarm, "doctor", "--json"], {
      ...baseEnv,
      CLAUDE_CODE_REMOTE: "",
      RALLYPOINT_TRANSPORT: "gh",
      RALLYPOINT_GH_SCRIPT: resolve(fixture, "missing-gh.mjs"),
    });
    const transport = JSON.parse(stdout).checks.find((check) => check.name === "transport");
    assert.equal(transport.ok, false);
    assert.match(transport.detail, /cannot list pull requests/);
  });

  await test("e2e: scripts/gh.mjs runs role-prompt gh commands through the same transport", async () => {
    const env = { ...baseEnv, CLAUDE_CODE_REMOTE: "true" };
    const which = await runNode([ghScript, "--which"], env);
    assert.match(which.stdout, /^rest \(Claude Code cloud session/);
    const listed = await runNode([ghScript, "pr", "list", "--json", "number,headRefName"], env);
    assert.equal(listed.status, 0, listed.stderr);
    assert.deepEqual(JSON.parse(listed.stdout), [{ number: 121, headRefName: "agent/21-x" }]);
    const unknown = await runNode([ghScript, "release", "create", "v1"], env);
    assert.equal(unknown.status, 1);
    assert.match(unknown.stderr, /does not implement `gh release create v1`/);
  });
} finally {
  server.close();
  await rm(fixture, { recursive: true, force: true });
  await rm(fakeGh, { force: true });
}

console.log(`Transport tests passed: ${passed} cases (transport choice, GraphQL fallback, every api.mjs command, swarm doctor and scripts/gh.mjs end to end).`);
