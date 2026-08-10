// Whether an issue is available for a worker to claim, derived rather than
// declared.
//
// Until #1510 the backlog was an *opt-in* set: an issue entered it when a
// planner added `status:ready` beside `task`, and `claim.mjs` listed candidates
// by asking GitHub for both labels at once. Two labels had to be present for
// work to be claimable, and the commonest board defect was one of them missing
// — `report.mjs` carried a whole `readyWithoutTask` classification for an issue
// advertised as ready that `claim.mjs` could never offer to anybody, found live
// on #879 and #446.
//
// Both labels are gone. The pool is now *opt-out*: every open issue is
// claimable unless something on it says otherwise. That inverts the default —
// a freshly filed issue is claimable the moment it is filed, where before it
// sat inert until a planner opened the gate — and the inversion is deliberate,
// decided by the owner on 2026-08-09. Nothing here restores a scoping gate; an
// issue that is not ready to be worked says so with a hold label.
//
// What this does *not* touch, and the reason the inversion is safe: the
// reservation ref `rallypoint-claims/issue-<N>` is still the only atomicity
// guarantee, exactly as it was. Labels were always advisory on top of it —
// `claim.mjs` creates the ref first and edits labels only once that succeeded,
// so two sessions racing one issue are separated by GitHub refusing the second
// ref, never by a label. Widening the pool changes which issues are offered,
// not what happens when two sessions are offered the same one.

/**
 * How many open issues a pool listing asks for.
 *
 * `claim.mjs` and `report.mjs` must use the **same** number or they describe
 * different populations, which is the drift this module exists to prevent — the
 * predicate agreeing is worth nothing if the two sets it runs over do not.
 *
 * It has to be a shared constant rather than two literals because the labels
 * that used to bound both queries are gone: `task` + `status:ready` narrowed the
 * listing to a handful of rows, so neither caller was anywhere near its page
 * limit and the limits were free to disagree. Listing every open issue removes
 * that accidental bound, and #1510's first draft replaced it with 300 in
 * `claim.mjs` and an inherited 100 in `report.mjs` — 33 issues from the point
 * where every pool classification in the report would have gone dark at once.
 *
 * Truncation is **not** graceful, and both callers must detect it rather than
 * assume a full page is a complete one. `gh issue list` sorts newest-first by
 * default, so an over-full page drops the *oldest* issues — and
 * `selectCandidates` tie-breaks ascending by number, so the dropped tail is
 * exactly what it would have offered first. A silently truncated listing does
 * not delay old work, it makes it permanently unclaimable and permanently
 * invisible, and gets worse as new issues arrive.
 */
export const ISSUE_PAGE = 300;

/**
 * The label keys, in `config.labels`, that hold an issue out of the pool.
 *
 * Ordered most-specific first, because `explainHold` reports the first match
 * and the first match is what the operator most needs to hear: an issue that is
 * both claimed and blocked is somebody's live work before it is anything else.
 *
 * Read from `config` rather than hardcoded so a hold label added to the config
 * later is honoured here without editing this file — the same reasoning
 * `clear-status-labels.mjs` follows with its `startsWith("status:")` sweep.
 */
export const HOLD_LABEL_KEYS = ["claimed", "blocked", "deferred", "human"];

/**
 * Why each hold label keeps an issue out of the pool, in the operator's terms.
 * Keyed by `config.labels` key, not by label name, so renaming a label in the
 * config does not strand its explanation.
 *
 * @type {Record<string, (label: string) => string>}
 */
const HOLD_REASON = {
  claimed: (label) => `carries \`${label}\`; another session holds it`,
  blocked: (label) =>
    `carries \`${label}\`, so it cannot proceed until whatever blocks it is ` +
    `resolved. Removing that label is a planner decision, not this command's`,
  deferred: (label) =>
    `carries \`${label}\`, so it was consciously postponed and is not queued ` +
    `for work. Removing that label is a planner decision, not this command's`,
  human: (label) =>
    `carries \`${label}\`, so it is waiting on an operator action no agent ` +
    `session can perform. Removing that label is an operator decision, not ` +
    `this command's`,
};

/**
 * The hold label *names* configured on `config`, in `HOLD_LABEL_KEYS` order.
 *
 * A key absent from `config.labels` contributes nothing rather than an
 * `undefined` that would silently match a label with no name — the failure
 * `selectCandidates` guarded against by making its `humanLabel` optional.
 *
 * @param {{ labels?: Record<string, string | undefined> }} config
 * @returns {string[]}
 */
export const holdLabelNames = (config) =>
  HOLD_LABEL_KEYS.flatMap((key) => {
    const name = config?.labels?.[key];
    return typeof name === "string" && name !== "" ? [name] : [];
  });

/**
 * The names on `labels`, however GitHub shaped them.
 *
 * Returns `null` — never an empty array — when the labels could not be read as
 * a list, so a caller cannot mistake "unreadable" for "none". That is the
 * #236 / #311 rule this repository applies everywhere: a failed read is not
 * evidence of absence.
 *
 * @param {unknown} labels
 * @returns {string[] | null}
 */
export const labelNames = (labels) =>
  Array.isArray(labels)
    ? labels.flatMap((label) => {
        const name = /** @type {{ name?: unknown }} */ (label)?.name;
        return typeof name === "string" ? [name] : [];
      })
    : null;

/**
 * The configured hold labels present on `issue`, in `HOLD_LABEL_KEYS` order.
 *
 * @param {{ labels?: unknown }} issue
 * @param {{ labels?: Record<string, string | undefined> }} config
 * @returns {string[] | null} `null` when the labels could not be read.
 */
export const heldBy = (issue, config) => {
  const names = labelNames(issue?.labels);
  if (names === null) return null;
  return holdLabelNames(config).filter((label) => names.includes(label));
};

/**
 * Whether `issue` is in the claimable pool on its own labels and assignees.
 *
 * Deliberately *not* the whole of claimability. Two further filters live in
 * `claim.mjs` because they are not properties of the issue: a live reservation
 * ref, and an open pull request already referencing it. This answers the
 * question the label state can answer, and nothing more.
 *
 * An issue whose labels could not be read is **not** claimable. Erring the
 * other way would offer a session an issue that might carry `status:claimed`,
 * which is the one mistake the reservation ref cannot fully undo — the second
 * session would have already commented and assigned itself before finding out.
 *
 * @param {{ labels?: unknown, assignees?: unknown, state?: string }} issue
 * @param {{ labels?: Record<string, string | undefined> }} config
 * @returns {boolean}
 */
export const isClaimable = (issue, config) => {
  // A config naming no hold labels at all would make every open issue claimable
  // — the same fail-open hazard `selectCandidates` refuses its optional
  // `config` over. `loadConfig` validates these are present, so reaching here
  // without them is a programming error and is treated as one rather than
  // silently answering "claimable" for everything.
  if (holdLabelNames(config).length === 0) {
    throw new Error(
      "isClaimable was given a config naming no hold labels; refusing to " +
        "report every open issue as claimable.",
    );
  }

  if (issue?.state !== undefined && String(issue.state).toUpperCase() !== "OPEN") {
    return false;
  }

  // An assigned issue is somebody's work in progress even when no label says
  // so — the rule `selectCandidates` has always applied.
  if (Array.isArray(issue?.assignees) && issue.assignees.length > 0) return false;

  const held = heldBy(issue, config);
  return held !== null && held.length === 0;
};

/**
 * Why a specifically-named issue is not claimable, in one sentence, or `null`
 * when nothing here explains it and the caller should fall back to its own
 * message rather than assert a cause it did not establish.
 *
 * Callers pass the issue they read directly with `gh issue view`, not a row
 * from a search-backed listing — see `report.mjs`'s `viewIssue` on why the two
 * disagree.
 *
 * @param {{
 *   issue: { state?: string, labels?: unknown, assignees?: unknown } | null,
 *   number: string,
 *   config: { labels?: Record<string, string | undefined> },
 * }} input
 * @returns {string | null}
 */
export const explainHold = ({ issue, number, config }) => {
  if (issue === null) {
    return `#${number} could not be read, so why it was not offered cannot be established.`;
  }

  if (issue.state !== undefined && String(issue.state).toUpperCase() !== "OPEN") {
    return `#${number} is ${String(issue.state).toLowerCase()}, so it is not claimable.`;
  }

  const names = labelNames(issue.labels);

  if (names === null) {
    return `#${number}'s labels could not be read, so why it was not offered cannot be established.`;
  }

  for (const key of HOLD_LABEL_KEYS) {
    const label = config?.labels?.[key];
    if (typeof label !== "string" || label === "") continue;
    if (!names.includes(label)) continue;
    return `#${number} ${HOLD_REASON[key](label)}.`;
  }

  if (Array.isArray(issue.assignees) && issue.assignees.length > 0) {
    const logins = issue.assignees
      .map((/** @type {{ login?: string }} */ assignee) => assignee?.login)
      .filter(Boolean)
      .join(", ");
    return (
      `#${number} is assigned${logins ? ` to ${logins}` : ""}, and an assigned ` +
      `issue is somebody's work in progress.`
    );
  }

  return null;
};
