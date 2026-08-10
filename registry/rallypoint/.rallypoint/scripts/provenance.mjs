// Who authored the branch under review.
//
// Split out of `review.mjs` so the rules that identify a pull request's author
// are testable without a live `gh`. Nothing in this loop gates on that
// identity anymore — any claimed session may review any pull request,
// including one it authored — but the identity itself still matters: it is
// what a request-changes verdict is traced back to when deciding who should
// pick up the fix, and what `reconcile.mjs`/`preflight.mjs` exist to recover
// or predict.

// GitHub's closing keywords. Anchored to the start of a line, with an optional
// list marker, so a reference inside prose ("this closes #999 in spirit")
// cannot be mistaken for the real link. `\b` rather than an end-of-line anchor,
// because the repository's own convention writes "Closes #104. Refs #80, #83."
export const CLOSING_KEYWORD =
  /^[^\S\n]*[-*]?[^\S\n]*(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)[^\S\n]+#(\d+)\b/gim;

// Code in a pull request body is illustration, not instruction. This
// repository's own PR bodies quote the `Closes #<issue>` convention, and
// counting those references would refuse the pull request as ambiguous.
//
// Fenced regions only. Blanking indented lines as well would also blank
// markdown list continuations, refusing a legitimately formatted body — the
// same failure shape as an over-tight anchor. The line-start keyword anchor
// already excludes prose, and a decoy reference is author-controlled and
// caught by the branch cross-check.
//
// `lib/blocked-by.mjs` briefly imported this to decide which text in an
// **issue** body is live, and does not any more. Not because a second
// stripper is cheap — it is not — but because the two callers want different
// answers, and asking one function for both is what produced three consecutive
// fail-open holes there. This helper answers "give me the body with code taken
// out, to scan for a keyword", so it **removes** the region; that caller
// anchors a pattern to a line start, and a removal joins the text either side
// of it and invents line starts the body never had. It also needs the two
// exclusions below to go the other way — an unterminated fence and an HTML
// comment must hide their contents when a label edit is at stake, and must not
// when a `Closes #<issue>` line is. So it scans the body's own lines itself
// and states its reach there. Keep this helper's contract as it is rather than
// widening it back toward that caller's.
//
// A fence that is never closed leaves its contents live, here as everywhere
// else this regex is used. That is a known limit rather than an oversight, but
// not for want of a definition: CommonMark ends an unterminated fence at the end
// of the document, so matching it would be a one-character change. What that
// costs is the reason it is not made — `linkedIssues` reads closing keywords out
// of every pull request body through this helper, and a single stray ``` in a
// body would then blank everything after it, silently dropping the
// `Closes #<issue>` line the whole coordination loop is built on. Leaving the
// tail live fails closed for that caller; blanking it does not. It is why every
// caller pairs this with an anchor tight enough that ordinary prose cannot match
// on its own.
/** @param {string | null | undefined} body */
const withoutCode = (body) =>
  (body ?? "").replace(/^[^\S\n]*(```|~~~)[\s\S]*?^[^\S\n]*\1/gm, "");

// `claim.mjs` always writes this as the first line of the claim comment.
// Anchored to the start of the body: an unanchored match would let a later
// comment quoting a forged claim take precedence under last-wins.
export const CLAIM = /^Claimed by Rallypoint agent `([^`\n]+)`/;

// Agent ids land in a verdict block, where a newline or a comment terminator
// would truncate the recorded value and make it differ from the id the guard
// actually checked.
export const SAFE_AGENT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/** @param {string | null | undefined} body */
export const linkedIssues = (body) => [
  ...new Set(
    [...withoutCode(body).matchAll(CLOSING_KEYWORD)].map((match) => match[1]),
  ),
];

// One issue or nothing. Several distinct references is an ambiguity to refuse,
// not one to resolve by picking.
/** @param {string | null | undefined} body */
export const linkedIssue = (body) => {
  const issues = linkedIssues(body);
  return issues.length === 1 ? issues[0] : null;
};

// The last claim wins: the janitor releases stale claims, so an issue can be
// re-claimed and the second claimant is the one that authored the branch.
/** @param {{ body?: string | null }[]} comments */
export const claimant = (comments) =>
  comments
    .flatMap((comment) => (comment.body ?? "").match(CLAIM)?.at(1) ?? [])
    .at(-1) ?? null;

// `claim.mjs` encodes the claimed issue in the branch name. That is a stronger
// signal of authorship than the pull request body, which can be edited after
// the fact.
/**
 * @param {string | null | undefined} headRefName
 * @param {string} prefix
 */
export const branchIssue = (headRefName, prefix) => {
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return headRefName?.match(new RegExp(`^${escaped}(\\d+)-`))?.[1] ?? null;
};

// Which open pull requests reference an issue, by the issue number `claim.mjs`
// encodes into the branch name or by a closing keyword in the body.
//
// This lives here, next to `branchIssue` and `linkedIssues`, because it is the
// same pair of signals `review.mjs` reads and every caller needs to read them
// identically: `claim.mjs` refuses a candidate an open pull request already
// covers, `report.mjs` classifies that state as `unclaimedWithOpenPr` or
// `unreservedWithOpenPr` depending on whether a claim comment is there to read
//, and `reconcile.mjs` recovers the first of the two. Three copies of
// the predicate is exactly how
// those three answers drift apart from each other and from `record`'s.
/**
 * @template {{ headRefName?: string | null, body?: string | null }} Pull
 * @param {{ pulls: Pull[], issue: string, branchPrefix: string }} input
 * @returns {Pull[]}
 */
export const referencingPullRequests = ({ pulls, issue, branchPrefix }) =>
  pulls.filter(
    (pull) =>
      branchIssue(pull.headRefName, branchPrefix) === issue ||
      linkedIssues(pull.body).includes(issue),
  );

// Every issue whose claim comment could name this branch's author.
//
// A pull request may legitimately close more than one issue — #1103 closed
// both #1099 and #793, the second having been folded into the first by
// operator decision — and `record` used to refuse such a pull request outright
// as ambiguous, leaving a completed review with nowhere to put its verdict
//. The ambiguity was real but the refusal was aimed at the wrong
// question: the guard exists to stop a session approving its own work, and
// that needs the *set* of agent ids that claimed any referenced issue, not a
// single issue to name.
//
// So this returns the set, and the self-review guard refuses if the reviewer
// appears anywhere in it. What stays refused is a body that points somewhere
// else entirely: if the branch names an issue, the body's closing keywords
// must include it, because pointing `Closes` exclusively at a stranger's issue
// would compare the reviewer against a stranger's claim — a bypass needing no
// forgery at all.
/**
 * @param {{
 *   linkedIssues: string[],
 *   branchIssue: string | null,
 * }} input
 * @returns {{ ok: true, issues: string[] } | { ok: false, reason: "mismatch" | "unidentifiable" }}
 */
export const authorshipIssues = ({ linkedIssues, branchIssue }) => {
  if (
    branchIssue &&
    linkedIssues.length > 0 &&
    !linkedIssues.includes(branchIssue)
  ) {
    return { ok: false, reason: "mismatch" };
  }

  const issues = [
    ...new Set([...(branchIssue ? [branchIssue] : []), ...linkedIssues]),
  ];

  return issues.length > 0
    ? { ok: true, issues }
    : { ok: false, reason: "unidentifiable" };
};

// Which single issue a label should be reconciled against.
//
// `record` used to hard-require a `Closes #<issue>` reference and exit before
// consulting the branch name at all, so a pull request whose branch
// unambiguously names its issue was un-reviewable when its body said `Refs #N`
// instead. That is a legitimate shape: #109 and #17 are partial deliveries that
// deliberately do not close their issue, and the protocol does not forbid it
//.
//
// The branch name is the stronger signal — `claim.mjs` writes it at claim time
// and nobody can edit it afterwards — so it is enough on its own. What stays
// refused is anything genuinely ambiguous, because resolving ambiguity by
// picking is how a reviewer ends up compared against a stranger's claim.
/**
 * @param {{
 *   linkedIssues: string[],
 *   branchIssue: string | null,
 * }} input
 * @returns {{ ok: true, issue: string } | { ok: false, reason: "ambiguous-body" | "mismatch" | "unidentifiable" }}
 */
export const recordableIssue = ({ linkedIssues, branchIssue }) => {
  const authorship = authorshipIssues({ linkedIssues, branchIssue });

  if (!authorship.ok) return authorship;

  // The branch name settles it whenever it is there: `authorshipIssues` has
  // already established the body does not point away from it.
  if (branchIssue) return { ok: true, issue: branchIssue };

  // No branch issue and several closing keywords: the set is known but which
  // one a *label* belongs on is not, and picking is how a label lands on a
  // stranger's issue. `record` no longer refuses this shape — it checks the
  // whole set — but the issue-side `status:changes-requested` reconciliation
  // has no answer here and deliberately does nothing.
  return authorship.issues.length === 1
    ? { ok: true, issue: authorship.issues[0] }
    : { ok: false, reason: "ambiguous-body" };
};

// A promotion pull request's head branch IS an integration/promotion branch —
// `release` -> `staging`, or `staging` -> `main` — rather than an
// individually claimed `agent/<issue>-slug` branch. Nobody runs `claim.mjs`
// against a promotion, so it carries no `Closes #<issue>` reference and no
// claim comment, and `recordableIssue`/`claimant` above have nothing to read.
// That is not an error to refuse; it is a different pull request shape that
// needs its own path through `record`/`check`.
//
// A promotion also has a second, **snapshot** head shape:
// `promotion/<snapshotted branch>-<suffix>`, e.g.
// `promotion/release-2026-08-09`, pinned at one commit of `release`. A
// promotion whose head IS `release` moves every time anything merges into
// `release`; each head move cancels the CI run and re-queues it from the back,
// and voids any recorded verdict, since promotions deliberately get no
// carried-verdict treatment. A pinned snapshot fixes both.
//
// Recognition of that shape is **conjunctive, and never by branch name alone**
// — the same rule the Dependabot note below states, and for the same reason. A
// bare `startsWith("promotion/")` would be a self-review bypass: any session
// could name its branch `promotion/anything`, open it against `staging`, and
// skip both the authoring-issue resolution and the independence guarantee. So
// all three must hold:
//
//   1. the head parses as `promotion/<snapshotted>-<suffix>`, where
//      `<snapshotted>` is `integrationBranch` or `promotionBranch`;
//   2. the base is neither `integrationBranch` nor the snapshotted branch
//      itself — a promotion moves work *up* the chain, so a `promotion/*` head
//      opened against `release` is an ordinary pull request wearing a costume;
//   3. the head commit is genuinely contained in the branch it claims to
//      snapshot, which the caller establishes through `containedIn`.
//
// (3) is what makes the name unforgeable: a snapshot of `release` holds by
// definition no commit that is not already on `release`, so arbitrary content
// cannot ride in under a promotion-shaped name. Without evidence the snapshot
// shape is **not** recognised — this fails closed, so a caller that cannot
// verify containment simply keeps the old exact-name behaviour rather than
// granting an unproven exemption.
//
// `baseRefName: null` means the caller has no base in view at all (there is no
// pull request), which only `freshness.mjs` does. That is not a weakening: a
// base nobody has stated is a base nobody can forge, and containment is still
// required there.

// The prefix is `promotionSnapshotPrefix` in `.rallypoint/config.json`, with
// this as the fallback for a config that does not set it. Reading it
// from configuration changes no guarantee above: the prefix establishes only
// condition 1, and conditions 2 and 3 are what the exemption actually rests on.
// `validateConfig` rejects a prefix overlapping `branchPrefix` in either
// direction, so configuration cannot make a claimed `agent/*` branch parse as a
// snapshot head. A non-string or empty value here falls back rather than
// matching everything — an empty prefix would make every branch name a
// candidate for condition 1.
const DEFAULT_SNAPSHOT_PREFIX = "promotion/";

/**
 * The branch a `<promotionSnapshotPrefix><snapshotted>-<suffix>` head claims to
 * snapshot, or `null` when the head is not that shape. Pure string parsing — it
 * establishes only condition 1 above and proves nothing on its own.
 *
 * @param {string | null | undefined} headRefName
 * @param {{
 *   integrationBranch?: string | null,
 *   promotionBranch?: string | null,
 *   promotionSnapshotPrefix?: string | null,
 * }} config
 * @returns {string | null}
 */
export const snapshottedBranch = (headRefName, config) => {
  if (typeof headRefName !== "string") return null;

  const prefix =
    typeof config.promotionSnapshotPrefix === "string" &&
    config.promotionSnapshotPrefix !== ""
      ? config.promotionSnapshotPrefix
      : DEFAULT_SNAPSHOT_PREFIX;

  if (!headRefName.startsWith(prefix)) return null;

  const rest = headRefName.slice(prefix.length);

  for (const branch of [config.integrationBranch, config.promotionBranch]) {
    if (typeof branch !== "string" || branch === "") continue;
    // `<snapshotted>-<suffix>` with a non-empty suffix. A bare
    // `promotion/release` names no snapshot instant and is not the shape.
    if (rest.startsWith(`${branch}-`) && rest.length > branch.length + 1) {
      return branch;
    }
  }

  return null;
};

/**
 * @param {string | null | undefined} headRefName
 * @param {{
 *   integrationBranch?: string | null,
 *   promotionBranch?: string | null,
 *   promotionSnapshotPrefix?: string | null,
 * }} config
 * @param {{
 *   baseRefName: string | null,
 *   containedIn: (branch: string) => boolean,
 * }} [evidence] Omit where the caller cannot establish containment: the
 *   snapshot shape is then not recognised, and the exact-name behaviour is
 *   unchanged.
 */
export const isPromotionBranch = (headRefName, config, evidence) => {
  if (headRefName == null) return false;

  if (headRefName === config.integrationBranch) return true;
  if (config.promotionBranch != null && headRefName === config.promotionBranch)
    return true;

  if (evidence == null || typeof evidence.containedIn !== "function")
    return false;

  const snapshotted = snapshottedBranch(headRefName, config);

  if (snapshotted == null) return false;

  const { baseRefName } = evidence;

  if (baseRefName != null) {
    if (baseRefName === config.integrationBranch) return false;
    if (baseRefName === snapshotted) return false;
  }

  return evidence.containedIn(snapshotted) === true;
};

// A Dependabot pull request has no authoring agent session at all.
// Nobody ran `claim.mjs`, there is no issue, and the head branch is
// `dependabot/npm_and_yarn/...` rather than an `agent/<issue>-slug` branch —
// so, exactly as for a promotion above, `recordableIssue`/`claimant` have
// nothing to read and the self-review guard has no worker identity to compare
// a reviewer against. Recognition is by **authorship**, never by the branch
// name: a branch name is not proof of authorship, and matching
// `dependabot/` alone would let any session acquire the bypass by naming its
// branch cleverly.
//
// The two transports report the author slightly differently, and this accepts
// both. `gh pr view --json author` strips the suffix and reports
// `{ login: "dependabot", is_bot: true }` — or `app/dependabot` in some
// versions — while the REST transport in `lib/api.mjs` maps GitHub's
// `user: { login: "dependabot[bot]", type: "Bot" }`. `is_bot` is required
// either way, so a human account registered under the login `dependabot`
// does not qualify.
const DEPENDABOT_LOGINS = new Set(["dependabot", "dependabot-preview"]);

/**
 * @param {unknown} author The `author` field of `gh pr view --json author`.
 */
export const isDependabotAuthor = (author) => {
  if (author == null || typeof author !== "object") return false;

  const { is_bot: isBot, login } = /** @type {{ is_bot?: unknown, login?: unknown }} */ (author);

  if (isBot !== true || typeof login !== "string") return false;

  return DEPENDABOT_LOGINS.has(
    login
      .toLowerCase()
      .replace(/^app\//, "")
      .replace(/\[bot\]$/, ""),
  );
};
