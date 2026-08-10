// The synchronous request runner the API transport is built on, plus the rules
// for deciding whether this environment has a credential worth sending.
//
// Kept apart from `api.mjs` so the transport's translation rules can be tested
// with a stub and no test can reach the network by importing one of them.

import { execFileSync } from "node:child_process";
import process from "node:process";

// What a GitHub credential looks like: the `gh*_` prefixed tokens GitHub issues
// today, the newer fine-grained form, or a classic 40-character hex PAT.
//
// This is a check for "is this a credential", not for "is this valid". It exists
// because environments hand these variables placeholder values — this one sets
// `GH_TOKEN=proxy-injected` — and sending a placeholder as a Bearer token turns a
// clear authorization failure into a misleading `401 Bad credentials`.
const TOKEN = /^(?:gh[pousr]_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{16,}|[0-9a-f]{40})$/;

/** @param {string | undefined} candidate */
export const looksLikeToken = (candidate) => TOKEN.test(candidate ?? "");

/**
 * The credential to send, or the empty string when there is none worth sending.
 * An empty string is not a failure: an environment may authenticate the request
 * some other way, and if nothing does, GitHub says so in a way worth reading.
 *
 * @param {Record<string, string | undefined>} [env]
 */
export const credential = (env = process.env) =>
  [env.GH_TOKEN, env.GITHUB_TOKEN].find(looksLikeToken) ?? "";

/**
 * `owner/repo` for the checkout this command runs in.
 *
 * `gh` infers this from the git remote, so this does too rather than requiring
 * configuration. The remote may be rewritten by a proxy — an agent session sees
 * `http://127.0.0.1:PORT/git/OWNER/REPO` — so the last two path segments are
 * what identify the repository, not the host.
 *
 * @param {{ env?: Record<string, string | undefined>, remote?: string }} [input]
 * @returns {string} `owner/repo`, or the empty string when it cannot be read.
 */
export const repositoryFrom = ({ env = process.env, remote } = {}) => {
  if (env.GITHUB_REPOSITORY) return env.GITHUB_REPOSITORY;

  const url = remote ?? "";
  const segments = url
    .replace(/\.git$/, "")
    .replace(/^git@[^:]+:/, "")
    .split("/")
    .filter((segment) => segment !== "");

  return segments.length >= 2 ? segments.slice(-2).join("/") : "";
};

/**
 * A `request` for `createTransport` that performs each call in a child process.
 *
 * @param {{
 *   token?: string,
 *   baseUrl?: string,
 *   timeoutMs?: number,
 * }} [options]
 * @returns {(call: { method: string, path: string, body?: unknown }) => { status: number, body: unknown, nextPath?: string | null }}
 */
export const syncRequest = ({ token, baseUrl, timeoutMs = 30_000 } = {}) => {
  const runner = new URL("./fetch-once.mjs", import.meta.url).pathname;

  return (call) => {
    try {
      const output = execFileSync(process.execPath, [runner], {
        input: JSON.stringify({
          ...call,
          baseUrl,
          token: token ?? credential(),
        }),
        encoding: "utf8",
        timeout: timeoutMs,
        // Node's built-in fetch ignores HTTPS_PROXY unless asked. Every agent
        // session routes outbound HTTPS through one, so without this the request
        // times out rather than failing usefully.
        env: { ...process.env, NODE_USE_ENV_PROXY: "1" },
        // The child's stderr is captured rather than inherited: proxy support is
        // still flagged experimental, so it emits a warning on every request, and
        // a claim makes several. It is surfaced below when it is actually needed.
        stdio: ["pipe", "pipe", "pipe"],
      });

      return JSON.parse(output);
    } catch (error) {
      // A child that could not complete is a transport failure, not an HTTP
      // result — an HTTP refusal exits 0 and is reported as a status. Keep
      // whatever it managed to say: this is the layer where a proxy or a TLS
      // problem surfaces, and those are diagnosed from the child's own words.
      const said = /** @type {{ stderr?: string }} */ (error).stderr?.trim();

      throw new Error(
        `Could not reach the GitHub API for ${call.method} ${call.path}` +
          (said ? `:\n${said}` : `: ${String(error)}`),
      );
    }
  };
};

export default syncRequest;
