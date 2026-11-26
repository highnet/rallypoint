#!/usr/bin/env node

// The child process `syncRequest()` in `request.mjs` runs for every API call:
// read one request as JSON on stdin, perform exactly one `fetch`, and print
// `{ status, body, nextPath }` as JSON on stdout.
//
// It exists because the transport seam is synchronous — `gh(...args) => string`
// — and `fetch` is not. Running the request in a child and blocking on it with
// `execFileSync` is what lets the REST transport stand in for `gh` without any
// script changing shape.
//
// The exit code is the contract `request.mjs` reads, so it is narrow on purpose:
//
//  - **Any HTTP response exits 0**, a 404 or a 422 included. Whether a status is
//    a failure is `api.mjs`'s decision, not this file's — `claim.mjs` treats a
//    refused reservation as "another session got there first", which only works
//    if the refusal arrives as a status rather than as a crash.
//  - **Only a transport failure exits non-zero**: no connection, a proxy or TLS
//    problem, unreadable input. The reason goes to stderr, which `request.mjs`
//    captures and puts in the error it throws, because that is where a proxy
//    failure is diagnosed from.
//
// Input, as `request.mjs` writes it:
//   { method, path, body?, baseUrl?, token? }
// `path` is relative to `baseUrl` (`/repos/o/r/issues?state=open`).

import process from "node:process";
import { pathToFileURL } from "node:url";

// What `gh` itself targets. `request.mjs` passes `baseUrl` through unset unless
// a caller chose one, so the default lives here, next to the one `fetch`.
const DEFAULT_BASE_URL = "https://api.github.com";

/** @returns {Promise<string>} */
const readStdin = async () => {
  let input = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) input += chunk;
  return input;
};

/**
 * The `rel="next"` target of a `Link` header, as a path relative to `baseUrl`,
 * so `api.mjs` can hand it straight back as the next call's `path`.
 *
 * GitHub returns absolute URLs here, and on GitHub Enterprise those carry the
 * `/api/v3` prefix that `baseUrl` already holds, so stripping the whole base —
 * not just the origin — is what keeps the next request from doubling it.
 *
 * @param {string | null} header
 * @param {string} baseUrl
 * @returns {string | null}
 */
export const nextPathFrom = (header, baseUrl) => {
  if (!header) return null;

  for (const part of header.split(",")) {
    const match = /<([^>]+)>\s*;(.*)$/.exec(part.trim());
    const rel = /\brel="?([^";]*)"?/.exec(match?.[2] ?? "")?.[1] ?? "";
    if (!match || !rel.split(/\s+/).includes("next")) continue;

    const target = match[1];
    const base = baseUrl.replace(/\/+$/, "");
    if (target.startsWith(`${base}/`) || target.startsWith(`${base}?`)) {
      return target.slice(base.length);
    }

    // A next link on another origin is not followed: the request would carry
    // this session's credential somewhere it was not issued for. Same origin
    // but outside the base path is still GitHub, and keeps its path.
    const url = new URL(target, `${base}/`);
    return url.origin === new URL(base).origin ? `${url.pathname}${url.search}` : null;
  }

  return null;
};

/**
 * JSON when the body is JSON, text when it is something else, `null` when there
 * is none — a 204 from a DELETE, say. Parsed by attempt rather than by trusting
 * `Content-Type`, because an error page from a proxy is often labelled neither.
 *
 * @param {string} text
 */
const parseBody = (text) => {
  if (text === "") return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

/**
 * @param {{ method?: string, path?: string, body?: unknown, baseUrl?: string, token?: string }} call
 */
export const fetchOnce = async ({ method = "GET", path, body, baseUrl, token }) => {
  if (typeof path !== "string" || path === "") {
    throw new Error("fetch-once: the request has no path");
  }

  const base = (baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, "");

  /** @type {Record<string, string>} */
  const headers = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    // GitHub rejects requests without one outright.
    "User-Agent": "rallypoint-loop",
  };
  // Only a non-empty token is sent: `request.mjs` passes the empty string when
  // the environment holds nothing that looks like a credential, and an empty
  // `Bearer ` header is a 401 where no header may be authenticated another way.
  if (token) headers.Authorization = `Bearer ${token}`;

  /** @type {RequestInit} */
  const init = { method, headers };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }

  const response = await fetch(`${base}${path.startsWith("/") ? "" : "/"}${path}`, init);

  return {
    status: response.status,
    body: parseBody(await response.text()),
    nextPath: nextPathFrom(response.headers.get("link"), base),
  };
};

const main = async () => {
  try {
    const call = JSON.parse(await readStdin());
    process.stdout.write(JSON.stringify(await fetchOnce(call)));
  } catch (error) {
    // `fetch` reports a refused connection or a proxy failure as a bare
    // "fetch failed" and keeps the useful part in `cause`, so print both.
    const cause = /** @type {{ cause?: unknown }} */ (error)?.cause;
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}` +
        (cause ? ` (${cause instanceof Error ? cause.message : String(cause)})` : "") +
        "\n",
    );
    process.exitCode = 1;
  }
};

// Importable for its helpers without performing a request.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
