// The single authority for `review.mjs`'s exit codes.
//
// Exit codes are a public interface in this loop: the merge gate branches on
// them, `report.mjs` turns them into an orchestrator survey line, and
// `audit-merge-review.mjs` turns them into a clean/flagged verdict about a merge
// that already happened. Before #1414 they were enumerated in five independent
// places with nothing keeping them in step:
//
//   1. `EXIT` in `.rallypoint/scripts/review.mjs` — the authority, but a
//      module-private const no consumer could read
//   2. `docs/AGENT_LOOP.md`'s "Review" exit-code table (prose)
//   3. `.rallypoint/roles/merger.md`'s exit-code table (prose)
//   4. `CHECK_MEANINGS` in `lib/report.mjs` (consumer)
//   5. `CHECK_CLASSIFICATIONS` in `lib/audit-merge-review.mjs` (consumer)
//
// #1394 is what that cost. Code `13` (contested approve, #928) shipped into
// `EXIT` and into both prose tables and reached *neither* consumer. Both fell
// through to their undocumented-code branch and failed closed as `unknown`, so
// Merge Review Audit run 31263843529 labelled PR #1373 — a properly reviewed
// merge whose approve explicitly superseded a dissent — as `merged:unreviewed`,
// and orchestrator surveys reported it as an unknown state. Nothing failed
// loudly: an unmapped code has a perfectly reasonable-looking fallback, which is
// exactly what makes this drift silent.
//
// PR #1413 mapped `13` in both consumers and added one coupling test covering
// the audit. This module is the structural fix that was deliberately out of
// #1394's scope: `review.mjs` derives its `EXIT` from the table below rather
// than declaring one, both consumers are asserted exhaustive over it, and both
// prose tables are asserted to list exactly the codes it defines.
//
// **What this deliberately does not centralise is the wording.** Each consumer
// phrases a code for its own audience — `report.mjs` for an orchestrator
// deciding whether to dispatch a merger, `audit-merge-review.mjs` for a
// after-the-fact judgement on a merge — and the `meaning` field here is a third
// phrasing, for the prose tables and for anyone reading this file. Folding them
// into one shared sentence would flatten distinctions the codes exist to carry:
// `5` and `11` differ by "nobody reviewed this" versus "a reviewer asked for
// changes and nothing addressed them", and the audit says so at length where the
// survey says it in six words. What is derived is *exhaustiveness*, not strings.
//
// Codes `69` (a missing `gh`) and `75` (a stale checkout) are deliberately
// absent: they sit outside every exit table in `docs/AGENT_LOOP.md` by design,
// far enough clear that adding a code here cannot collide with them. See that
// document's "Prerequisites" section.

/**
 * One exit code `review.mjs` can answer with.
 *
 * `key` is the name `review.mjs`'s `EXIT` map exposes it under, and is absent
 * for `0` alone — success is `process.exit(0)`, never `EXIT.something`.
 *
 * `owner` is which subcommand can produce it: `record`, `check`, or `both`. It
 * is what `docs/AGENT_LOOP.md`'s table prints in its Command column, and what
 * keeps a reader from looking for `12` in a `check` consumer.
 *
 * `checkVerdict` is narrower and is the field the exhaustiveness assertions
 * read: true when the code is an answer `check` gives *about a pull request's
 * review state*, which a consumer of `check` results must therefore have decided
 * what to do with. `1` is owned by both subcommands and is not one — it is a
 * usage error in the caller's own invocation, not a verdict about the pull
 * request — so a consumer may map it or not, as it prefers.
 *
 * @typedef {{
 *   code: number,
 *   key?: string,
 *   owner: "record" | "check" | "both",
 *   checkVerdict: boolean,
 *   meaning: string,
 * }} ReviewExitCode
 */

/** @type {readonly ReviewExitCode[]} */
export const REVIEW_EXIT_CODES = Object.freeze([
  {
    code: 0,
    owner: "both",
    checkVerdict: true,
    meaning: "success; for `check`, an independent approve at the current head",
  },
  {
    code: 1,
    key: "usage",
    owner: "both",
    checkVerdict: false,
    meaning: "usage error",
  },
  {
    code: 2,
    key: "unidentifiable",
    owner: "record",
    checkVerdict: false,
    meaning: "no `Closes #<issue>` reference resolving an authoring session, or no claim comment on one",
  },
  {
    code: 3,
    key: "selfReview",
    owner: "record",
    checkVerdict: false,
    meaning: "refused: the reviewer claimed the linked issue",
  },
  {
    code: 4,
    key: "staleLabel",
    owner: "check",
    checkVerdict: true,
    meaning: "stale `review:approved` left in place; rerun with `--strip-stale`",
  },
  {
    code: 5,
    key: "noVerdict",
    owner: "check",
    checkVerdict: true,
    meaning: "no approve verdict at the current head",
  },
  {
    code: 6,
    key: "selfApproved",
    owner: "check",
    checkVerdict: true,
    meaning: "the approve at the head came from the branch author, or a subagent it dispatched",
  },
  {
    code: 7,
    key: "unknownAuthor",
    owner: "check",
    checkVerdict: true,
    meaning: "author unidentifiable, so independence cannot be established",
  },
  {
    code: 8,
    key: "unreadable",
    owner: "check",
    checkVerdict: true,
    meaning: "hand-recorded verdict at the head this script cannot read",
  },
  {
    code: 9,
    key: "raced",
    owner: "record",
    checkVerdict: false,
    meaning: "the branch moved while the verdict was being written; nothing kept",
  },
  {
    code: 10,
    key: "carriedApprove",
    owner: "check",
    checkVerdict: true,
    meaning: "carried: no verdict at the head, but an approve carries forward",
  },
  {
    code: 11,
    key: "carriedRequestChanges",
    owner: "check",
    checkVerdict: true,
    meaning: "carried: no verdict at the head, but a request-changes carries forward",
  },
  {
    code: 12,
    key: "contested",
    owner: "record",
    checkVerdict: false,
    meaning: "refused: an unsuperseded request-changes from a different reviewer sits at this head",
  },
  {
    code: 13,
    key: "contestedApprove",
    owner: "check",
    checkVerdict: true,
    meaning: "approved at the head, but the winning approve explicitly superseded a dissent",
  },
]);

/**
 * `review.mjs`'s `EXIT` map, derived rather than declared.
 *
 * `review.mjs` imports this instead of writing its own object literal, so the
 * table above cannot become a sixth copy of the codes it exists to be the
 * authority for. `0` has no key and is absent by construction: success is
 * `process.exit(0)`.
 *
 * @type {Readonly<Record<string, number>>}
 */
export const EXIT = Object.freeze(
  Object.fromEntries(
    REVIEW_EXIT_CODES.filter((entry) => entry.key !== undefined).map((entry) => [
      entry.key,
      entry.code,
    ]),
  ),
);

/**
 * Every code a consumer of `review.mjs check` results has to have an opinion
 * about, ascending. See `checkVerdict` on the typedef above for why `1` is not
 * among them.
 *
 * @type {readonly number[]}
 */
export const CHECK_VERDICT_CODES = Object.freeze(
  REVIEW_EXIT_CODES.filter((entry) => entry.checkVerdict).map((entry) => entry.code),
);

/** @type {readonly number[]} */
export const ALL_EXIT_CODES = Object.freeze(REVIEW_EXIT_CODES.map((entry) => entry.code));

/**
 * Asserts that a consumer's table of `check` exit codes is exhaustive over this
 * authority, throwing with a message naming what is missing or stray.
 *
 * This is the guarantee #1394 did not have: a new code cannot exist without
 * every consumer of `check` results having to decide what it means. It fails on
 * the *next* code to be added, at the moment it is added, rather than at the
 * moment a real merge is misclassified because of it.
 *
 * Called from each consumer's unit test rather than at module load. Throwing at
 * import time would take out `report.mjs` and the merge audit — live coordination
 * tooling — over a bookkeeping omission, turning a silent misreport into an
 * outage. The unit suite runs in `pnpm run check`, which is the gate every branch
 * passes before it reaches a reviewer, so the omission is caught before it ships
 * either way.
 *
 * A consumer may map codes beyond the required set — `report.mjs` maps `1`,
 * because a survey wants to say "usage error calling review.mjs check" rather
 * than "undocumented exit code 1" — but every code it maps must be one this
 * authority defines. A mapping for a code that does not exist is as much a sign
 * of drift as a missing one.
 *
 * @param {Record<number | string, unknown>} mapping
 * @param {string} label how to name the mapping in a failure message
 * @returns {void}
 */
export const assertExhaustiveCheckMapping = (mapping, label) => {
  const mapped = new Set(Object.keys(mapping).map(Number));

  const missing = CHECK_VERDICT_CODES.filter((code) => !mapped.has(code));
  if (missing.length > 0) {
    throw new Error(
      `${label} does not map \`review.mjs check\` exit code(s) ${missing.join(", ")}. ` +
        "An unmapped code falls through to an `unknown` fallback that looks reasonable and is wrong — " +
        "see #1394. Add each one to this consumer, in its own words.",
    );
  }

  const stray = [...mapped].filter((code) => !ALL_EXIT_CODES.includes(code)).sort((a, b) => a - b);
  if (stray.length > 0) {
    throw new Error(
      `${label} maps exit code(s) ${stray.join(", ")}, which \`review.mjs\` does not define. ` +
        "Remove them, or add them to REVIEW_EXIT_CODES if they are real.",
    );
  }
};

/**
 * Narrows a Markdown document to one `## ` section, by heading text.
 *
 * `docs/AGENT_LOOP.md` carries three separate exit-code tables — `freshness.mjs`
 * answers `0`-`4`, `lease.mjs` answers `0`-`5`, and `review.mjs` answers
 * `0`-`13` — all in the same shape. Reading exit codes out of that document
 * without slicing first would silently union all three and pass whatever it was
 * asked, which is the opposite of what a coupling test is for. Returns `null`
 * when the heading is absent, so a caller reports a missing section rather than
 * asserting over an empty string.
 *
 * `### ` subsections are kept: the Review section's carried-verdict, contested,
 * promotion, and Dependabot subsections all qualify what the table means, and
 * none of them starts a table of its own.
 *
 * @param {string} markdown
 * @param {string} heading exact `## ` heading text, without the marker
 * @returns {string | null}
 */
export const sliceSection = (markdown, heading) => {
  const lines = markdown.split("\n");
  const start = lines.findIndex((line) => line.trim() === `## ${heading}`);
  if (start === -1) {
    return null;
  }

  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith("## "));
  return (end === -1 ? rest : rest.slice(0, end)).join("\n");
};

/**
 * Extracts the exit codes a prose table lists, from a Markdown document.
 *
 * `docs/AGENT_LOOP.md` and `.rallypoint/roles/merger.md` both carry a
 * hand-maintained table of these codes, and both are read by agents as
 * specifications — `merger.md`'s in particular is what a merger session branches
 * on when deciding whether to merge. Neither was compared against anything
 * before #1414. Slice with `sliceSection` first where the document holds more
 * than one exit-code table.
 *
 * The shape both tables share is a leading cell holding nothing but a
 * backticked number, which is what this matches. Anchored to the start of a line
 * so that a `13` appearing mid-sentence in surrounding prose is not read as a
 * table row.
 *
 * @param {string} markdown
 * @returns {number[]} ascending, deduplicated
 */
export const exitCodesInProseTable = (markdown) => {
  const codes = new Set(
    [...markdown.matchAll(/^\|\s*`(\d+)`\s*\|/gmu)].map((match) => Number(match[1])),
  );
  return [...codes].sort((a, b) => a - b);
};
