// The self-improvement layer: what the loop measures about itself, and the
// rules a change to its own role prompts must pass before and after it merges.
//
// The role prompts were tuned by hand, from incidents an operator happened to
// notice. The improver role closes that loop: it reads the loop's own history,
// proposes one change to one tunable prompt, and lets the result decide whether
// the change stays. This module is every part of that the improver must not be
// trusted to judge for itself:
//
//  - **the metrics**, computed from merged and closed pull requests and the
//    verdicts `review.mjs` recorded on them, never from a session's account of
//    how its own work went;
//  - **the frozen paths**, which no improvement may touch without a person —
//    above all the reviewer's and merger's prompts and every script, because an
//    optimiser allowed to edit its own judge improves the score, not the work;
//  - **the before/after verdict** that decides whether a merged change is kept
//    or reverted, against a counter-metric the proposal had to name up front.
//
// One change at a time is a rule, not a preference. Two prompt changes under
// evaluation at once cannot be told apart, so `check` refuses a new proposal
// while the previous one is still being measured.
//
// The same rule as `lib/report.mjs` holds here: a source that could not be read
// is `unknown`, never "nothing there". A metric computed from a partial history
// is a wrong number with a confident face, and a wrong number decides a revert.
//
// Every `gh` call is injected. Only `evaluate --record` writes anything, and
// what it writes is one comment carrying the result.

import { parseVerdicts } from "../verdicts.mjs";

// Exit codes are a public interface, as they are for `review.mjs` and
// `report.mjs`. Keep these in sync with the tables in docs/AGENT_LOOP.md and
// `.rallypoint/roles/improver.md`.
export const EXIT = {
  ok: 0,
  usage: 1,
  // status: an evaluation or a revert is due · check: no valid improvement block
  // evaluate: the change is not kept, revert it
  second: 2,
  // status: the last change is still being measured · check: touches a path
  // that is not tunable · evaluate: inconclusive, not enough history yet
  third: 3,
  // status: an improvement pull request is already open · check: the previous
  // improvement has not been evaluated yet
  fourth: 4,
  // A source could not be read, so nothing was decided.
  unknown: 5,
};

export const MARKER = "rallypoint-improvement";
export const EVALUATION_MARKER = "rallypoint-evaluation";
/** The trailer, flush-left in a pull request body, that reverts a change. */
export const REVERT_TRAILER = "Reverts-Improvement";

/**
 * What the loop can measure about itself. `better` is the direction an
 * improvement has to move a metric in; nothing is "improved" by moving the
 * other way, however the proposal frames it.
 */
export const METRICS = {
  firstPassApprovalRate: {
    better: "up",
    describe: "share of merged pull requests that never drew a request-changes verdict",
  },
  meanReviewRounds: {
    better: "down",
    describe: "request-changes verdicts per merged pull request",
  },
  abandonRate: {
    better: "down",
    describe: "share of closed pull requests that closed without merging",
  },
  escalationRate: {
    better: "down",
    describe: "share of closed pull requests carrying the human label",
  },
  medianHoursToMerge: {
    better: "down",
    describe: "median hours from opening to merge",
  },
  mergedUnreviewedRate: {
    better: "down",
    describe: "share of merged pull requests labelled merged-unreviewed",
  },
};

/**
 * Checked on every evaluation whatever the proposal named. A change that
 * speeds the loop up by getting work merged past review has not improved it.
 */
const ALWAYS_GUARDED = "mergedUnreviewedRate";

/**
 * Paths no improvement may touch, whatever `improvement.tunablePaths` says.
 * Frozen wins over tunable: an operator widening the tunable set to
 * `.rallypoint/` must not thereby hand the improver the scripts that enforce
 * the protocol, the judge's own prompt, or this role's own boundaries.
 */
export const ALWAYS_FROZEN = [
  ".rallypoint/scripts/",
  ".rallypoint/config.json",
  ".rallypoint/roles/reviewer.md",
  ".rallypoint/roles/merger.md",
  ".rallypoint/roles/improver.md",
  ".github/",
  "AGENTIC_LOOP.md",
  "AGENTS.md",
  "docs/AGENT_LOOP.md",
];

const DEFAULTS = {
  label: "loop:improvement",
  tunablePaths: [".rallypoint/roles/"],
  evaluationSample: 10,
  windowDays: 14,
  counterTolerance: 0.1,
};

/**
 * The `improvement` settings with their defaults applied. Every field is
 * optional, so a config written before this layer existed keeps working.
 *
 * @param {{ labels?: Record<string, unknown>, improvement?: Record<string, unknown> }} config
 */
export const settings = (config) => {
  const improvement = config.improvement ?? {};
  return {
    label:
      typeof config.labels?.improvement === "string"
        ? config.labels.improvement
        : DEFAULTS.label,
    tunablePaths: Array.isArray(improvement.tunablePaths)
      ? /** @type {string[]} */ (improvement.tunablePaths)
      : DEFAULTS.tunablePaths,
    evaluationSample:
      typeof improvement.evaluationSample === "number"
        ? improvement.evaluationSample
        : DEFAULTS.evaluationSample,
    windowDays:
      typeof improvement.windowDays === "number"
        ? improvement.windowDays
        : DEFAULTS.windowDays,
    counterTolerance:
      typeof improvement.counterTolerance === "number"
        ? improvement.counterTolerance
        : DEFAULTS.counterTolerance,
  };
};

/**
 * Validation for the optional `improvement` block, called from
 * `lib/config.mjs`. Absent is fine; present and malformed is rejected, because
 * a sample size that reads as `undefined` would evaluate every change on no
 * history at all.
 *
 * @param {unknown} improvement
 * @returns {string[]} problems
 */
export const validateImprovement = (improvement) => {
  if (improvement === undefined) return [];
  if (typeof improvement !== "object" || improvement === null) {
    return ["`improvement` must be an object when present."];
  }

  const problems = [];
  const { tunablePaths, evaluationSample, windowDays, counterTolerance } =
    /** @type {Record<string, unknown>} */ (improvement);

  if (
    tunablePaths !== undefined &&
    (!Array.isArray(tunablePaths) ||
      !tunablePaths.every(
        (path) => typeof path === "string" && path.trim() !== "",
      ))
  ) {
    problems.push("`improvement.tunablePaths` must be an array of non-empty paths.");
  }

  for (const [key, value] of [
    ["evaluationSample", evaluationSample],
    ["windowDays", windowDays],
  ]) {
    if (value !== undefined && !(Number.isInteger(value) && Number(value) > 0)) {
      problems.push(`\`improvement.${key}\` must be a positive integer.`);
    }
  }

  if (
    counterTolerance !== undefined &&
    !(
      typeof counterTolerance === "number" &&
      counterTolerance >= 0 &&
      counterTolerance <= 1
    )
  ) {
    problems.push("`improvement.counterTolerance` must be a number from 0 to 1.");
  }

  return problems;
};

/**
 * @param {string} path
 * @param {string} entry A file, or a directory when it ends in `/`.
 */
const covers = (path, entry) =>
  entry.endsWith("/") ? path.startsWith(entry) : path === entry;

/**
 * Splits a pull request's changed files into the ones an improvement may make
 * and the ones that need a person. A file is tunable only when a tunable entry
 * covers it and no frozen entry does.
 *
 * @param {string[]} files
 * @param {string[]} tunablePaths
 */
export const classifyFiles = (files, tunablePaths) => {
  const frozen = files.filter((file) =>
    ALWAYS_FROZEN.some((entry) => covers(file, entry)),
  );
  const outside = files.filter(
    (file) =>
      !frozen.includes(file) &&
      !tunablePaths.some((entry) => covers(file, entry)),
  );
  return { frozen, outside };
};

/**
 * The single improvement block a proposal's pull request body must open with
 * a line of its own:
 *
 * ```text
 * <!-- rallypoint-improvement
 * metric: firstPassApprovalRate
 * counter-metric: medianHoursToMerge
 * baseline: 0.62
 * -->
 * ```
 *
 * `baseline` is what `retro` reported when the change was proposed. It is a
 * record for the reader, not an input to `evaluate`, which recomputes the
 * before window itself rather than trusting a number the proposer typed.
 *
 * @param {string | null | undefined} body
 * @returns {{ ok: true, metric: string, counterMetric: string, baseline: string | null }
 *   | { ok: false, reason: string }}
 */
export const parseImprovement = (body) => {
  const blocks = [
    ...(body ?? "").matchAll(new RegExp(`<!--\\s*${MARKER}\\b([\\s\\S]*?)-->`, "g")),
  ];

  if (blocks.length === 0) {
    return { ok: false, reason: `no \`${MARKER}\` block in the pull request body` };
  }
  if (blocks.length > 1) {
    return { ok: false, reason: `more than one \`${MARKER}\` block; there is no principled way to choose` };
  }

  /** @param {string} name */
  const field = (name) => {
    const found = [
      ...blocks[0][1].matchAll(new RegExp(`^[^\\S\\n]*${name}:[^\\S\\n]*(\\S+)[^\\S\\n]*$`, "gm")),
    ];
    return found.length === 1 ? found[0][1] : undefined;
  };

  const metric = field("metric");
  const counterMetric = field("counter-metric");

  if (!metric || !(metric in METRICS)) {
    return { ok: false, reason: `\`metric\` must name exactly one of: ${Object.keys(METRICS).join(", ")}` };
  }
  if (metric === ALWAYS_GUARDED) {
    return { ok: false, reason: `\`${ALWAYS_GUARDED}\` is guarded on every evaluation and cannot be the target` };
  }
  if (!counterMetric || !(counterMetric in METRICS)) {
    return { ok: false, reason: "`counter-metric` must name exactly one known metric" };
  }
  if (counterMetric === metric) {
    return { ok: false, reason: "`counter-metric` must differ from `metric`; a metric cannot audit itself" };
  }

  return { ok: true, metric, counterMetric, baseline: field("baseline") ?? null };
};

/**
 * @typedef {{
 *   number: number,
 *   title: string,
 *   body: string,
 *   headRefName: string,
 *   labels: string[],
 *   createdAt: string,
 *   closedAt: string | null,
 *   mergedAt: string | null,
 * }} Pull
 */

/**
 * @template T
 * @typedef {{ ok: true, value: T } | { ok: false, reason: string }} Lookup
 */

/**
 * @param {unknown} pull
 * @returns {Pull}
 */
const pullFields = (pull) => {
  const raw = /** @type {Record<string, any>} */ (pull);
  return {
    number: raw.number,
    title: raw.title ?? "",
    body: raw.body ?? "",
    headRefName: raw.head?.ref ?? "",
    labels: (raw.labels ?? []).map((/** @type {{ name: string }} */ label) => label.name),
    createdAt: raw.created_at,
    closedAt: raw.closed_at ?? null,
    mergedAt: raw.merged_at ?? null,
  };
};

/**
 * Every pull request in one state, through `gh api --paginate`, which both
 * transports implement and which reads every page rather than stopping at a
 * limit that could silently truncate the history.
 *
 * @param {(...args: string[]) => string} gh
 * @param {string} repository
 * @param {"open" | "closed"} state
 * @returns {Lookup<Pull[]>}
 */
export const listPulls = (gh, repository, state) => {
  try {
    const body = JSON.parse(
      gh(
        "api",
        "--paginate",
        `repos/${repository}/pulls?state=${state}&per_page=100&sort=created&direction=desc`,
      ),
    );
    if (!Array.isArray(body)) return { ok: false, reason: `${state} pull requests: not a list` };
    return { ok: true, value: body.map(pullFields) };
  } catch (error) {
    return { ok: false, reason: `${state} pull requests: ${String(/** @type {Error} */ (error).message ?? error).split("\n")[0]}` };
  }
};

/**
 * @param {(...args: string[]) => string} gh
 * @param {string} path
 * @param {string} what
 * @returns {Lookup<Record<string, any>[]>}
 */
const paginated = (gh, path, what) => {
  try {
    const body = JSON.parse(gh("api", "--paginate", path));
    if (!Array.isArray(body)) return { ok: false, reason: `${what}: not a list` };
    return { ok: true, value: body };
  } catch (error) {
    return { ok: false, reason: `${what}: ${String(/** @type {Error} */ (error).message ?? error).split("\n")[0]}` };
  }
};

/**
 * The verdicts and request-changes notes recorded on one pull request. Notes
 * are the `- ` lines `review.mjs record` writes under the block; only a review
 * that parses as a request-changes verdict contributes them, so ordinary
 * conversation never reads as reviewer friction.
 *
 * @param {(...args: string[]) => string} gh
 * @param {string} repository
 * @param {number} number
 * @returns {Lookup<{ requestChanges: number, notes: string[] }>}
 */
export const readReviews = (gh, repository, number) => {
  const reviews = paginated(gh, `repos/${repository}/pulls/${number}/reviews`, `reviews on #${number}`);
  if (!reviews.ok) return reviews;

  const shaped = reviews.value.map((review) => ({
    body: review.body ?? "",
    submittedAt: review.submitted_at ?? null,
    commitId: review.commit_id ?? null,
  }));

  const requestChanges = parseVerdicts(shaped).filter(
    (verdict) => verdict.verdict === "request-changes",
  ).length;

  const notes = shaped.flatMap((review) => {
    const [verdict] = parseVerdicts([review]);
    if (verdict?.verdict !== "request-changes") return [];
    const after = review.body.slice(review.body.indexOf("-->") + 3);
    return [...after.matchAll(/^- (.+)$/gm)].map((match) => match[1].trim());
  });

  return { ok: true, value: { requestChanges, notes } };
};

/**
 * Whether a pull request is agent work the loop should be measured on: an
 * issue branch under the configured prefix, and not itself an improvement,
 * which would have the loop grading its own tuning as delivery.
 *
 * @param {Pull} pull
 * @param {{ branchPrefix: string }} config
 * @param {string} label
 */
export const isMeasured = (pull, config, label) =>
  pull.headRefName.startsWith(config.branchPrefix) && !pull.labels.includes(label);

/** @param {number[]} values */
const median = (values) => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
};

/**
 * @param {number} part
 * @param {number} whole
 */
const share = (part, whole) => (whole === 0 ? null : part / whole);

/**
 * The metrics over a set of closed pull requests. A rate over an empty set is
 * `null` — not `0`, which would read as a perfect score.
 *
 * @param {Pull[]} pulls closed pull requests
 * @param {Map<number, { requestChanges: number }>} reviews by pull request
 * @param {{ human: string, mergedUnreviewed?: string }} labels
 */
export const measure = (pulls, reviews, labels) => {
  const merged = pulls.filter((pull) => pull.mergedAt);
  const rounds = merged.map((pull) => reviews.get(pull.number)?.requestChanges ?? 0);

  return {
    closed: pulls.length,
    merged: merged.length,
    metrics: {
      firstPassApprovalRate: share(rounds.filter((count) => count === 0).length, merged.length),
      meanReviewRounds:
        merged.length === 0 ? null : rounds.reduce((sum, count) => sum + count, 0) / merged.length,
      abandonRate: share(pulls.length - merged.length, pulls.length),
      escalationRate: share(
        pulls.filter((pull) => pull.labels.includes(labels.human)).length,
        pulls.length,
      ),
      medianHoursToMerge: median(
        merged.map(
          (pull) => (Date.parse(String(pull.mergedAt)) - Date.parse(pull.createdAt)) / 3_600_000,
        ),
      ),
      mergedUnreviewedRate: share(
        merged.filter((pull) => pull.labels.includes(labels.mergedUnreviewed ?? "merged:unreviewed")).length,
        merged.length,
      ),
    },
  };
};

/**
 * Request-changes notes that recur across pull requests: the friction a role
 * prompt could have prevented. Normalised so `src/a.ts` and `src/b.ts` in an
 * otherwise identical note count as one, and counted once per pull request so
 * a single long review cannot dominate.
 *
 * @param {Map<number, { notes: string[] }>} reviews
 * @param {number} [limit]
 */
export const recurringNotes = (reviews, limit = 10) => {
  /** @type {Map<string, { note: string, pulls: number[] }>} */
  const groups = new Map();

  for (const [number, { notes }] of reviews) {
    for (const note of new Set(notes)) {
      const key = note
        .toLowerCase()
        .replace(/`[^`]*`/g, "`…`")
        .replace(/#?\d+/g, "#")
        .replace(/[^\p{L}\p{N}`…#]+/gu, " ")
        .trim()
        .slice(0, 120);
      if (key === "") continue;
      const group = groups.get(key) ?? { note, pulls: [] };
      if (!group.pulls.includes(number)) group.pulls.push(number);
      groups.set(key, group);
    }
  }

  return [...groups.values()]
    .filter((group) => group.pulls.length >= 2)
    .sort((left, right) => right.pulls.length - left.pulls.length)
    .slice(0, limit);
};

/**
 * Compares a metric before and after a change.
 *
 * @param {string} metric
 * @param {number | null} before
 * @param {number | null} after
 * @param {number} tolerance relative worsening allowed before it counts
 * @returns {"better" | "same" | "worse" | "unknown"}
 */
export const movement = (metric, before, after, tolerance = 0) => {
  if (before === null || after === null) return "unknown";
  const direction = METRICS[/** @type {keyof typeof METRICS} */ (metric)].better === "up" ? 1 : -1;
  const delta = (after - before) * direction;
  const scale = Math.max(Math.abs(before), 1e-9);
  if (delta > 0) return "better";
  if (-delta / scale > tolerance) return "worse";
  return "same";
};

/**
 * The decision `evaluate` reports. Kept only when the target metric moved the
 * right way and neither the named counter-metric nor the always-guarded one
 * worsened beyond tolerance. "Same" is not kept: a prompt change that buys
 * nothing is only more prompt.
 *
 * @param {{ metric: string, counterMetric: string }} proposal
 * @param {Record<string, number | null>} before
 * @param {Record<string, number | null>} after
 * @param {number} tolerance
 * @returns {{ result: "kept" | "reverted" | "inconclusive", reasons: string[] }}
 */
export const decide = (proposal, before, after, tolerance) => {
  const target = movement(proposal.metric, before[proposal.metric], after[proposal.metric]);
  const counter = movement(proposal.counterMetric, before[proposal.counterMetric], after[proposal.counterMetric], tolerance);
  const guard = movement(ALWAYS_GUARDED, before[ALWAYS_GUARDED], after[ALWAYS_GUARDED]);

  if (target === "unknown") {
    return { result: "inconclusive", reasons: [`\`${proposal.metric}\` has no value on one side of the change`] };
  }

  const reasons = [];
  if (target !== "better") reasons.push(`\`${proposal.metric}\` did not improve (${target})`);
  if (counter === "worse") reasons.push(`counter-metric \`${proposal.counterMetric}\` worsened beyond tolerance`);
  if (guard === "worse") reasons.push(`\`${ALWAYS_GUARDED}\` rose`);

  return reasons.length === 0
    ? { result: "kept", reasons: [`\`${proposal.metric}\` improved and no guard worsened`] }
    : { result: "reverted", reasons };
};

/**
 * Merged improvement pull requests, newest merge first.
 *
 * @param {Pull[]} closed
 * @param {string} label
 */
export const mergedImprovements = (closed, label) =>
  closed
    .filter((pull) => pull.mergedAt && pull.labels.includes(label))
    .sort((left, right) => Date.parse(String(right.mergedAt)) - Date.parse(String(left.mergedAt)));

/**
 * The before and after samples around one merged improvement: the
 * `evaluationSample` measured pull requests that closed last before it merged,
 * and the first that many *opened* after it — work begun earlier was written
 * under the old prompt — stopping at the next improvement's merge, so a later
 * change is never credited to this one. Equal-sized samples on
 * both sides, by count rather than by days, so a quiet week cannot be compared
 * against a busy one as if they were the same evidence.
 *
 * @param {Pull[]} closed
 * @param {Pull} improvement
 * @param {{ branchPrefix: string }} config
 * @param {ReturnType<typeof settings>} options
 */
export const samples = (closed, improvement, config, options) => {
  const pivot = Date.parse(String(improvement.mergedAt));
  const next = mergedImprovements(closed, options.label)
    .map((pull) => Date.parse(String(pull.mergedAt)))
    .filter((at) => at > pivot)
    .sort((a, b) => a - b)
    .at(0) ?? Number.POSITIVE_INFINITY;

  const measured = closed
    .filter((pull) => pull.closedAt && isMeasured(pull, config, options.label))
    .sort((left, right) => Date.parse(String(left.closedAt)) - Date.parse(String(right.closedAt)));

  const before = measured
    .filter((pull) => Date.parse(String(pull.closedAt)) < pivot)
    .slice(-options.evaluationSample);
  const after = measured
    .filter((pull) => {
      const at = Date.parse(pull.createdAt);
      return at >= pivot && at < next;
    })
    .slice(0, options.evaluationSample);

  return { before, after };
};

/**
 * Whether an evaluation has been recorded on a pull request, from its issue
 * comments. Only the first line of the comment is trusted as the marker,
 * the same rule `verdicts.mjs` applies to review blocks: a block quoted inside
 * somebody else's comment is a quotation, not a record.
 *
 * @param {Record<string, any>[]} comments
 * @returns {"kept" | "reverted" | null}
 */
export const recordedEvaluation = (comments) => {
  for (const comment of comments) {
    const body = String(comment.body ?? "").replace(/^﻿/, "");
    const match = body.match(new RegExp(`^<!--\\s*${EVALUATION_MARKER}\\b([\\s\\S]*?)-->`));
    const result = match?.[1].match(/^[^\S\n]*result:[^\S\n]*(kept|reverted)[^\S\n]*$/m)?.[1];
    if (result === "kept" || result === "reverted") return result;
  }
  return null;
};

/** @param {number | null} value */
const show = (value) =>
  value === null ? "—" : Number.isInteger(value) ? String(value) : value.toFixed(2);

/**
 * @param {ReturnType<typeof measure>} sample
 * @param {string} heading
 */
const table = (sample, heading) => [
  `## ${heading} (${sample.closed} closed, ${sample.merged} merged)`,
  "",
  ...Object.entries(sample.metrics).map(
    ([name, value]) =>
      `- ${name}: ${show(value)} (better ${METRICS[/** @type {keyof typeof METRICS} */ (name)].better})`,
  ),
];

const USAGE = [
  "Usage:",
  "  improvement.mjs retro [--days <n>] [--json]",
  "  improvement.mjs status",
  "  improvement.mjs check --pr <n>",
  "  improvement.mjs evaluate --pr <n> [--record --agent-id <id>]",
].join("\n");

/**
 * @param {{
 *   argv: string[],
 *   config: { branchPrefix: string, labels: { human: string, mergedUnreviewed?: string, [key: string]: any }, [key: string]: any },
 *   gh: (...args: string[]) => string,
 *   now?: number,
 *   log?: (line: string) => void,
 *   error?: (line: string) => void,
 * }} input
 * @returns {number} exit code
 */
export const improvement = ({
  argv,
  config,
  gh,
  now = Date.now(),
  log = console.log,
  error = console.error,
}) => {
  const [command, ...rest] = argv;
  /** @param {string} flag */
  const value = (flag) => {
    const index = rest.indexOf(flag);
    return index === -1 ? undefined : rest[index + 1];
  };
  const options = settings(config);

  if (!["retro", "status", "check", "evaluate"].includes(command ?? "")) {
    error(USAGE);
    return EXIT.usage;
  }

  /** @type {string} */
  let repository;
  try {
    repository = JSON.parse(gh("repo", "view", "--json", "nameWithOwner")).nameWithOwner;
  } catch (failure) {
    error(`Unknown: the repository could not be read: ${String(/** @type {Error} */ (failure).message ?? failure).split("\n")[0]}`);
    return EXIT.unknown;
  }

  const closed = listPulls(gh, repository, "closed");
  if (!closed.ok) {
    error(`Unknown: ${closed.reason}. Nothing was decided from a partial history.`);
    return EXIT.unknown;
  }

  /**
   * Reviews for every pull request in the set, or the first read that failed.
   * @param {Pull[]} pulls
   * @returns {Lookup<Map<number, { requestChanges: number, notes: string[] }>>}
   */
  const reviewsFor = (pulls) => {
    const map = new Map();
    for (const pull of pulls.filter((candidate) => candidate.mergedAt)) {
      const read = readReviews(gh, repository, pull.number);
      if (!read.ok) return read;
      map.set(pull.number, read.value);
    }
    return { ok: true, value: map };
  };

  if (command === "retro") {
    const days = value("--days") === undefined ? options.windowDays : Number(value("--days"));
    if (!Number.isInteger(days) || days <= 0) {
      error(USAGE);
      return EXIT.usage;
    }

    const since = now - days * 86_400_000;
    const window = closed.value.filter(
      (pull) => pull.closedAt && Date.parse(pull.closedAt) >= since && isMeasured(pull, config, options.label),
    );
    const reviews = reviewsFor(window);
    if (!reviews.ok) {
      error(`Unknown: ${reviews.reason}. Nothing was decided from a partial history.`);
      return EXIT.unknown;
    }

    const sample = measure(window, reviews.value, config.labels);
    const notes = recurringNotes(reviews.value);

    if (rest.includes("--json")) {
      log(JSON.stringify({ days, ...sample, recurringNotes: notes }, null, 2));
      return EXIT.ok;
    }

    log(
      [
        ...table(sample, `Last ${days} days`),
        "",
        "## Recurring request-changes notes",
        "",
        ...(notes.length === 0
          ? ["None recurred across two or more pull requests."]
          : notes.map((group) => `- ${group.pulls.length}× ${group.note} (${group.pulls.map((n) => `#${n}`).join(", ")})`)),
      ].join("\n"),
    );
    return EXIT.ok;
  }

  const open = listPulls(gh, repository, "open");
  if (!open.ok) {
    error(`Unknown: ${open.reason}.`);
    return EXIT.unknown;
  }

  /**
   * The newest merged improvement's evaluation state. A change evaluated as
   * `reverted` stays outstanding until a pull request carrying its
   * `Reverts-Improvement:` trailer is open or merged: a verdict nobody acts on
   * leaves the losing prompt in place, which is the outcome evaluation exists
   * to prevent.
   * @returns {Lookup<{ pull: Pull, state: "evaluated" | "revert-due" | "due" | "measuring", after: number } | null>}
   */
  const latest = () => {
    const [pull] = mergedImprovements(closed.value, options.label);
    if (!pull) return { ok: true, value: null };

    const comments = paginated(gh, `repos/${repository}/issues/${pull.number}/comments`, `comments on #${pull.number}`);
    if (!comments.ok) return comments;
    const recorded = recordedEvaluation(comments.value);
    if (recorded) {
      const trailer = new RegExp(`^${REVERT_TRAILER}:[^\\S\\n]*#${pull.number}[^\\S\\n]*$`, "m");
      const reverted = [...open.value, ...closed.value].some(
        (candidate) => (candidate.mergedAt || !candidate.closedAt) && trailer.test(candidate.body),
      );
      return {
        ok: true,
        value: {
          pull,
          state: recorded === "reverted" && !reverted ? "revert-due" : "evaluated",
          after: options.evaluationSample,
        },
      };
    }

    const { after } = samples(closed.value, pull, config, options);
    return {
      ok: true,
      value: { pull, state: after.length >= options.evaluationSample ? "due" : "measuring", after: after.length },
    };
  };

  if (command === "status") {
    const inFlight = open.value.filter((pull) => pull.labels.includes(options.label));
    if (inFlight.length > 0) {
      log(`Improvement in flight: ${inFlight.map((pull) => `#${pull.number}`).join(", ")}. Propose nothing until it merges or closes.`);
      return EXIT.fourth;
    }

    const state = latest();
    if (!state.ok) {
      error(`Unknown: ${state.reason}.`);
      return EXIT.unknown;
    }
    if (state.value?.state === "revert-due") {
      log(`Revert due: #${state.value.pull.number} was evaluated as not kept and nothing reverts it yet. Open a pull request carrying \`${REVERT_TRAILER}: #${state.value.pull.number}\`.`);
      return EXIT.second;
    }
    if (state.value?.state === "due") {
      log(`Evaluation due: #${state.value.pull.number} has ${state.value.after} measured pull requests after it. Run \`improvement.mjs evaluate --pr ${state.value.pull.number}\`.`);
      return EXIT.second;
    }
    if (state.value?.state === "measuring") {
      log(`Measuring: #${state.value.pull.number} has ${state.value.after} of ${options.evaluationSample} measured pull requests after it. Propose nothing yet.`);
      return EXIT.third;
    }

    log("Ready: no improvement in flight or under measurement. Run `improvement.mjs retro` and propose one change.");
    return EXIT.ok;
  }

  const pr = Number(value("--pr"));
  if (!Number.isInteger(pr) || pr <= 0) {
    error(USAGE);
    return EXIT.usage;
  }

  if (command === "check") {
    const pull = [...open.value, ...closed.value].find((candidate) => candidate.number === pr);
    if (!pull) {
      error(`Unknown: #${pr} is not among this repository's pull requests.`);
      return EXIT.unknown;
    }

    const proposal = parseImprovement(pull.body);
    if (!proposal.ok) {
      log(`Invalid: ${proposal.reason}.`);
      return EXIT.second;
    }

    const files = paginated(gh, `repos/${repository}/pulls/${pr}/files?per_page=100`, `files on #${pr}`);
    if (!files.ok) {
      error(`Unknown: ${files.reason}.`);
      return EXIT.unknown;
    }

    const { frozen, outside } = classifyFiles(
      files.value.map((file) => String(file.filename)),
      options.tunablePaths,
    );
    if (frozen.length > 0 || outside.length > 0) {
      log(
        [
          "Not tunable: this improvement needs a person to decide.",
          ...frozen.map((file) => `- frozen: ${file}`),
          ...outside.map((file) => `- outside improvement.tunablePaths: ${file}`),
        ].join("\n"),
      );
      return EXIT.third;
    }

    const state = latest();
    if (!state.ok) {
      error(`Unknown: ${state.reason}.`);
      return EXIT.unknown;
    }
    if (state.value && state.value.pull.number !== pr && state.value.state !== "evaluated") {
      const pending = {
        "revert-due": "evaluated as not kept and still unreverted",
        due: "due for evaluation",
        measuring: "still being measured",
      }[state.value.state];
      log(`One change at a time: #${state.value.pull.number} is ${pending}.`);
      return EXIT.fourth;
    }

    log(`OK: #${pr} targets \`${proposal.metric}\`, audited by \`${proposal.counterMetric}\`, and touches only tunable paths.`);
    return EXIT.ok;
  }

  // evaluate
  const pull = closed.value.find((candidate) => candidate.number === pr);
  if (!pull?.mergedAt || !pull.labels.includes(options.label)) {
    error(`#${pr} is not a merged improvement pull request.`);
    return EXIT.usage;
  }

  const proposal = parseImprovement(pull.body);
  if (!proposal.ok) {
    error(`#${pr} carries no valid improvement block (${proposal.reason}), so there is nothing to evaluate it against.`);
    return EXIT.second;
  }

  const sides = samples(closed.value, pull, config, options);
  if (sides.before.length < options.evaluationSample || sides.after.length < options.evaluationSample) {
    log(`Inconclusive: ${sides.before.length} before and ${sides.after.length} after; both need ${options.evaluationSample}.`);
    return EXIT.third;
  }

  const reviews = reviewsFor([...sides.before, ...sides.after]);
  if (!reviews.ok) {
    error(`Unknown: ${reviews.reason}. Nothing was decided from a partial history.`);
    return EXIT.unknown;
  }

  const before = measure(sides.before, reviews.value, config.labels);
  const after = measure(sides.after, reviews.value, config.labels);
  const decision = decide(proposal, before.metrics, after.metrics, options.counterTolerance);

  const report = [
    `**Evaluation of #${pr}: ${decision.result}.**`,
    "",
    ...decision.reasons.map((reason) => `- ${reason}`),
    "",
    ...table(before, "Before"),
    "",
    ...table(after, "After"),
  ];
  log(report.join("\n"));

  if (decision.result === "inconclusive") return EXIT.third;

  if (rest.includes("--record")) {
    const agentId = value("--agent-id");
    if (!agentId || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(agentId)) {
      error("--record needs a valid --agent-id.");
      return EXIT.usage;
    }
    try {
      gh(
        "issue",
        "comment",
        String(pr),
        "--body",
        [
          `<!-- ${EVALUATION_MARKER}`,
          `result: ${decision.result}`,
          `metric: ${proposal.metric}`,
          `counter-metric: ${proposal.counterMetric}`,
          `evaluator: ${agentId}`,
          "-->",
          "",
          ...report,
        ].join("\n"),
      );
    } catch (failure) {
      error(`The evaluation was not recorded: ${String(/** @type {Error} */ (failure).message ?? failure).split("\n")[0]}`);
      return EXIT.unknown;
    }
  }

  return decision.result === "kept" ? EXIT.ok : EXIT.second;
};
