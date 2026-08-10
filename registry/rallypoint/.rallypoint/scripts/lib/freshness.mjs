// Whether this checkout's copy of the coordination protocol is the one the
// integration branch currently defines.
//
// #586: a Merger session found its worktree missing `.rallypoint/roles/merger.md`
// entirely, and carrying `integrationBranch: "staging"` — the value retired when
// the integration branch moved to `release`. It was not a long-lived worktree
// that had drifted. Every `worktree-agent-*` branch on this machine is created
// at the tip of `main`, and `main` is the *tail* of the promotion chain
// (`release` -> `staging` -> `main`), hundreds of commits behind the branch the
// protocol is actually defined on. A session booting there reads a superseded
// role prompt, superseded docs, and a `.rallypoint/scripts/` directory missing
// entry points the role prompt tells it to run — a janitor's first instructed
// command died with `MODULE_NOT_FOUND` this way.
//
// Nothing in this repository creates those worktrees, so this cannot be fixed
// where it is caused. What it can do is refuse to proceed on a checkout whose
// protocol surface is stale, loudly and at the first command, instead of letting
// each role prompt ask sessions to verify by hand.
//
// The rule is deliberately narrower than "behind the integration branch". A
// worker branch is *supposed* to diverge — that is what a feature branch is —
// and being behind on `src/` is normal and harmless for a session that has just
// branched correctly. What is never acceptable is missing a commit that changed
// the coordination surface itself, so that is exactly what is measured:
// `HEAD..<remote>/<integrationBranch>` restricted to the paths below. Commits
// this branch adds to those paths are in the other direction and do not count,
// so the check does not fire on the very pull request that edits the protocol.
//
// #827: that commit-range measurement alone refused a whole legitimate class of
// session, unconditionally and by construction. A merger handling a promotion
// necessarily sits on the *base* branch (`staging` when promoting `release` ->
// `staging`, `main` when promoting `staging` -> `main`), so it lags the head
// branch by exactly the batch being promoted — coordination-surface commits
// included. No re-created worktree can make that pass, because moving to
// `release` would mean no longer being on the branch the promotion merges into.
// A check that always fails for a legitimate session class trains that class to
// proceed past it, which is worse than the inconvenience: #586's guarantee only
// holds while a refusal is believed.
//
// Two changes answer that, and both keep the substance of the question — is the
// protocol this session executes the one the integration branch defines? — by
// asking it of *content* rather than of commit identity:
//
//   1. A missing commit whose content the checkout already carries is not
//      drift. `HEAD...<ref>` restricted to the same paths is what several
//      reviewer sessions independently hand-rolled on 2026-08-02 to decide the
//      drift they were being refused over was benign. Three dots, not two: it
//      measures only what `<ref>` added since the merge base, so a branch's own
//      protocol edits are not counted against it.
//   2. `--promoting <head>` names the branch being merged in, so the comparison
//      is made against the batch rather than against a branch the checkout is
//      not supposed to be on. Promotion is established from that argument
//      through `isPromotionBranch`, never inferred from what the checkout
//      happens to be — inferring from the checkout is precisely what would let
//      a genuinely stale worktree excuse itself.
//
// A promotion whose batch genuinely changes the coordination surface is still
// surfaced, under its own exit code: the scripts and role prompts that session
// runs are the base branch's, and that is the substance of what the #811 merger
// checked by hand.

import { isPromotionBranch } from "../provenance.mjs";

/**
 * The files that define the protocol a session executes. A missing commit
 * touching any of them means this checkout is running instructions or tooling
 * that the integration branch has already replaced.
 *
 * `docs/` beyond `AGENT_LOOP.md` is deliberately absent: product and
 * architecture docs go stale harmlessly for the length of one session, and
 * including them would fire this check constantly for no protocol reason.
 */
export const COORDINATION_PATHS = [
  ".rallypoint",
  "docs/AGENT_LOOP.md",
  "AGENTIC_LOOP.md",
  "AGENTS.md",
];

export const EXIT = {
  ok: 0,
  usage: 1,
  // The checkout is provably behind on the coordination surface.
  stale: 2,
  // The comparison could not be established. Not "fresh": the same rule
  // `report.mjs`, `lease.mjs`, and `release-claim.mjs` keep — a lookup that
  // failed is never evidence of the reassuring answer.
  unknown: 3,
  // A promotion whose batch itself changes the coordination surface. Kept
  // distinct from `stale` because the two ask for opposite things: `stale`
  // says re-create the checkout from the integration branch, which for a
  // promotion session would abandon the promotion. This says read the diff —
  // the session's own tooling is the base branch's copy — and it is advisory,
  // not a re-created-worktree instruction.
  promotionCarriesProtocol: 4,
};

/**
 * `EX_TEMPFAIL` from sysexits.h: "temporary failure; the user is invited to
 * retry". Exactly right here — the checkout is not broken, it is behind, and
 * re-creating it from the integration branch makes the same command succeed.
 *
 * A separate code from every per-command exit table in `docs/AGENT_LOOP.md`
 * (none exceeds 11) and from `EXIT_MISSING_PREREQUISITE` (69), so a caller
 * branching on a claim's own exit codes cannot mistake a stale checkout for
 * "no issue available".
 */
export const EXIT_STALE_CHECKOUT = 75;

export const DEFAULT_REMOTE = "origin";

/** How many missing commits to name before summarising the rest. */
const SAMPLE_SIZE = 5;

/** @param {string[]} argv */
export const parseArgs = (argv) => {
  const promotingIndex = argv.indexOf("--promoting");

  return {
    allowStale: argv.includes("--allow-stale"),
    // A session working offline, or a test, can skip the network round trip and
    // compare against whatever the remote-tracking ref already says.
    fetch: !argv.includes("--no-fetch"),
    // The head branch of a promotion pull request this session is handling.
    // `undefined` when the flag is absent; the empty string when it was passed
    // without a value, which is a usage error rather than a missing flag.
    promoting: promotingIndex === -1 ? undefined : (argv[promotingIndex + 1] ?? ""),
  };
};

/**
 * @param {string} text
 * @returns {string[]}
 */
const lines = (text) =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

/**
 * What `git rev-parse --abbrev-ref HEAD` prints on a detached checkout. Git
 * refuses to create a branch of that name, so it is unambiguous.
 */
const DETACHED = "HEAD";

/**
 * How to name the checkout in a message.
 *
 * The refusal used to assert flatly that "worktrees here are created at the tip
 * of `main`", which is false for every promotion session — a `release` ->
 * `staging` merger is on `staging` — and whose remediation, followed
 * literally, abandons the promotion. Say what HEAD is actually on
 * instead, and let the reader judge.
 *
 * @param {(...args: string[]) => string} git
 * @returns {string}
 */
export const checkoutDescription = (git) => {
  /** @type {string | undefined} */
  let branch;

  try {
    branch = lines(git("rev-parse", "--abbrev-ref", "HEAD")).at(0);
  } catch {
    return "a checkout whose HEAD could not be read";
  }

  if (branch && branch !== DETACHED) return `the branch \`${branch}\``;

  try {
    const sha = lines(git("rev-parse", "--short", "HEAD")).at(0);
    return sha ? `a detached HEAD at \`${sha}\`` : "a detached HEAD";
  } catch {
    return "a detached HEAD";
  }
};

/**
 * The coordination-surface files `ref` carries that this checkout does not.
 *
 * `HEAD...<ref>` — three dots — diffs the merge base against `ref`, so it
 * reports only what `ref` added and never counts the checkout's own protocol
 * edits against it. This is the exact comparison reviewer and merger sessions
 * kept reinventing by hand.
 *
 * @param {(...args: string[]) => string} git
 * @param {string} ref
 * @returns {{ ok: true, files: string[] } | { ok: false, files: [] }}
 */
export const surfaceDiff = (git, ref) => {
  try {
    return {
      ok: true,
      files: lines(
        git("diff", "--name-only", `HEAD...${ref}`, "--", ...COORDINATION_PATHS),
      ),
    };
  } catch {
    return { ok: false, files: [] };
  }
};

/**
 * @param {{
 *   argv?: string[],
 *   config: { integrationBranch: string, promotionBranch?: string },
 *   git: (...args: string[]) => string,
 *   remote?: string,
 *   stdout?: (line: string) => void,
 *   stderr?: (line: string) => void,
 * }} input
 * @returns {{
 *   state: "fresh" | "equivalent" | "stale" | "unknown" | "promotion-clean" | "promotion-protocol",
 *   missing: string[],
 *   differing: string[],
 *   behind: number,
 * }}
 */
export const inspect = ({
  argv = [],
  config,
  git,
  remote = DEFAULT_REMOTE,
  stderr = console.error,
}) => {
  const { fetch, promoting } = parseArgs(argv);
  // A promotion is measured against the batch being merged in, not against a
  // branch the checkout is deliberately not on.
  const target = promoting || config.integrationBranch;
  const ref = `${remote}/${target}`;

  if (fetch) {
    try {
      git("fetch", "--quiet", remote, target);
    } catch {
      // A failed fetch is not a failed check: the remote-tracking ref this
      // clone already has is still evidence, just possibly older than the
      // truth. Under-reporting staleness is the safe direction here — it can
      // only miss a drift, never invent one — and failing closed would stop
      // every offline session dead.
      stderr(
        `Could not fetch \`${ref}\`; comparing against the last known ` +
          "remote-tracking ref instead.",
      );
    }
  }

  try {
    git("rev-parse", "--verify", `${ref}^{commit}`);
  } catch {
    return { state: "unknown", missing: [], differing: [], behind: 0 };
  }

  // A promotion session is behind the head branch by definition, so counting
  // the commits it lacks answers nothing. The only question worth asking is
  // whether the batch changes the protocol the session is executing.
  if (promoting) {
    const diff = surfaceDiff(git, ref);

    if (!diff.ok) {
      return { state: "unknown", missing: [], differing: [], behind: 0 };
    }

    return {
      state: diff.files.length === 0 ? "promotion-clean" : "promotion-protocol",
      missing: [],
      differing: diff.files,
      behind: 0,
    };
  }

  const range = `HEAD..${ref}`;

  try {
    const missing = lines(
      git("log", "--oneline", `--max-count=${SAMPLE_SIZE + 1}`, range, "--", ...COORDINATION_PATHS),
    );

    if (missing.length === 0) {
      return { state: "fresh", missing, differing: [], behind: 0 };
    }

    const behind = Number(lines(git("rev-list", "--count", range)).at(0) ?? "0");
    // Commit identity is the cheap trigger; content is the question. A commit
    // the checkout lacks that changed nothing it does not already carry — a
    // revert, a change the branch itself already made — is not drift.
    const diff = surfaceDiff(git, ref);

    if (!diff.ok) {
      return { state: "unknown", missing: [], differing: [], behind: 0 };
    }

    return {
      state: diff.files.length === 0 ? "equivalent" : "stale",
      missing,
      differing: diff.files,
      behind: Number.isFinite(behind) ? behind : 0,
    };
  } catch {
    return { state: "unknown", missing: [], differing: [], behind: 0 };
  }
};

/**
 * @param {{
 *   ref: string,
 *   checkout: string,
 *   missing: string[],
 *   differing: string[],
 *   behind: number,
 * }} input
 */
export const staleMessage = ({ ref, checkout, missing, differing, behind }) =>
  [
    `This checkout is on ${checkout}, and is missing commits to the ` +
      `Rallypoint coordination surface that \`${ref}\` already carries, so its ` +
      `role prompts, docs, and \`.rallypoint/scripts/\` entry points are not ` +
      `the ones this protocol currently defines.`,
    "",
    ...missing
      .slice(0, SAMPLE_SIZE)
      .map((line) => `  ${line}`)
      .concat(
        missing.length > SAMPLE_SIZE ? [`  ... and more (HEAD is ${behind} commits behind ${ref})`] : [],
      ),
    "",
    `Coordination files that differ from \`${ref}\`:`,
    "",
    ...differing.slice(0, SAMPLE_SIZE).map((file) => `  ${file}`),
    ...(differing.length > SAMPLE_SIZE
      ? [`  ... and ${differing.length - SAMPLE_SIZE} more`]
      : []),
    "",
    "Re-create this worktree from the integration branch, or move onto it:",
    "",
    `  git fetch ${DEFAULT_REMOTE}`,
    `  git checkout -B <your-branch> ${ref}`,
    "",
    "Re-read the role prompt afterwards: it may have changed. If you are",
    "handling a promotion pull request, do neither — moving off this branch",
    "would abandon the promotion. Pass `--promoting <head-branch>` instead.",
    "Pass `--allow-stale` only when an operator has decided the drift is",
    "irrelevant.",
  ].join("\n");

/**
 * @param {{
 *   ref: string,
 *   checkout: string,
 *   promoting: string,
 *   differing: string[],
 * }} input
 */
export const promotionProtocolMessage = ({
  ref,
  checkout,
  promoting,
  differing,
}) =>
  [
    `The batch being promoted from \`${promoting}\` changes the Rallypoint ` +
      `coordination surface. This checkout is on ${checkout}, so the role ` +
      `prompts, docs, and \`.rallypoint/scripts/\` entry points this session ` +
      `runs are the pre-promotion copies, not the ones \`${ref}\` defines.`,
    "",
    ...differing.slice(0, SAMPLE_SIZE).map((file) => `  ${file}`),
    ...(differing.length > SAMPLE_SIZE
      ? [`  ... and ${differing.length - SAMPLE_SIZE} more`]
      : []),
    "",
    "This is the batch itself, not a stale worktree: do not re-create this",
    "checkout from the integration branch, which would abandon the promotion.",
    "Read the diff before acting on anything the pre-promotion protocol says:",
    "",
    `  git diff HEAD...${ref} -- ${COORDINATION_PATHS.join(" ")}`,
    "",
    "The check is advisory here. Proceeding is legitimate once the diff has",
    "been read and found not to change what this session is about to do.",
  ].join("\n");

/**
 * The standalone command, and the guard the entry points call.
 *
 * @param {{
 *   argv?: string[],
 *   config: { integrationBranch: string, promotionBranch?: string },
 *   git: (...args: string[]) => string,
 *   remote?: string,
 *   stdout?: (line: string) => void,
 *   stderr?: (line: string) => void,
 * }} input
 * @returns {number} Process exit code.
 */
export const freshness = ({
  argv = [],
  config,
  git,
  remote = DEFAULT_REMOTE,
  stdout = console.log,
  stderr = console.error,
}) => {
  const { allowStale, promoting } = parseArgs(argv);

  // Promotion is established from the argument, through the same predicate
  // `preflight.mjs` and `notify-fixer.mjs` use, and never inferred from what
  // the checkout happens to be — inference from the checkout is exactly what
  // would let a genuinely stale worktree excuse itself.
  // A snapshot promotion head (`promotion/release-2026-08-09`, #1517) is
  // accepted here on containment alone: there is no pull request in view, so
  // there is no base to state and none to forge either — `baseRefName: null`
  // says exactly that. Containment is the whole guard, and it is a *stronger*
  // proof than the exact name ever was against #827's worry, a stale worktree
  // excusing itself: a head reachable from `origin/<snapshotted>` is by
  // definition carrying no protocol the batch does not already have.
  const promotionEvidence = {
    /** @type {string | null} */
    baseRefName: null,
    /** @param {string} snapshotted */
    containedIn: (snapshotted) => {
      try {
        git("merge-base", "--is-ancestor", "HEAD", `${remote}/${snapshotted}`);
        return true;
      } catch {
        return false;
      }
    },
  };

  if (
    promoting !== undefined &&
    !isPromotionBranch(promoting, config, promotionEvidence)
  ) {
    stderr(
      promoting === ""
        ? "Usage: freshness.mjs [--promoting <head-branch>] [--allow-stale] [--no-fetch]"
        : `\`--promoting ${promoting}\` does not name a promotion head branch. ` +
            `A promotion's head is \`${config.integrationBranch}\`` +
            (config.promotionBranch ? ` or \`${config.promotionBranch}\`` : "") +
            ". Run the check without `--promoting` for any other session.",
    );
    return EXIT.usage;
  }

  const ref = `${remote}/${promoting || config.integrationBranch}`;
  const { state, missing, differing, behind } = inspect({
    argv,
    config,
    git,
    remote,
    stdout,
    stderr,
  });
  const checkout = checkoutDescription(git);

  if (state === "unknown") {
    stderr(
      `Could not establish whether this checkout carries the current ` +
        `coordination protocol: \`${ref}\` could not be read. Fetch it, or ` +
        "pass `--allow-stale` to proceed without the check.",
    );
    return allowStale ? EXIT.ok : EXIT.unknown;
  }

  if (state === "fresh") {
    stdout(`Coordination protocol matches \`${ref}\`.`);
    return EXIT.ok;
  }

  if (state === "equivalent") {
    stdout(
      `Coordination protocol matches \`${ref}\`. This checkout is on ` +
        `${checkout} and lacks ${missing.length === 1 ? "a commit" : `${missing.length} commits`} ` +
        `touching the coordination surface, but the surface's content is ` +
        `identical, so the protocol this session executes is the current one.`,
    );
    return EXIT.ok;
  }

  if (state === "promotion-clean") {
    stdout(
      `Coordination protocol matches \`${ref}\`. This checkout is on ` +
        `${checkout}, the base of a promotion from \`${promoting}\`, and the ` +
        "batch being promoted changes nothing on the coordination surface, so " +
        "the protocol this session executes is the one being promoted.",
    );
    return EXIT.ok;
  }

  if (state === "promotion-protocol") {
    stderr(
      promotionProtocolMessage({
        ref,
        checkout,
        promoting: /** @type {string} */ (promoting),
        differing,
      }),
    );
    return allowStale ? EXIT.ok : EXIT.promotionCarriesProtocol;
  }

  stderr(staleMessage({ ref, checkout, missing, differing, behind }));
  return allowStale ? EXIT.ok : EXIT.stale;
};

export default freshness;
