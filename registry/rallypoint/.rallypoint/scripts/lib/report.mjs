// The coordination-state report, with every call to `gh` and `review.mjs check`
// injected.
//
// Claim state is spread across four sources that can disagree — the
// reservation ref, the `status:*` label, the assignee, and any open pull
// request — and reading all four by hand is tedious enough that nobody does it
//. Every incident this command answers for has the same shape: a written
// note, or a single query, stood in for reading the state, and the state had
// moved.
//
// The rule this module exists to keep, copied from `lib/release-claim.mjs`
// because it is the same rule: an error, a non-array body, or a response that
// filled its page is not evidence of absence. A source that could not be read
// is reported as `unknown`, never folded into "absent", and no classification
// below is ever derived from an assumption that a failed read means nothing was
// there.
//
// The sources are not equally current, and that is its own defect class
//. `matching-refs` is the strongly-consistent git data API;
// `gh issue list` is served by the search index and lags. Where the two
// disagree in the direction only that lag can explain, this module re-reads the
// single issue with `gh issue view`, which is not search-backed, before
// classifying it — see `viewIssue`. It confirms disagreements rather than
// suppressing them: only a direct read that positively contradicts the listing
// changes an answer, and a read that could not be made leaves the issue
// reported.
//
// This command is strictly read-only. It calls `gh` only to list state and
// shells out to `review.mjs check` only in its read-only `check` mode; it never
// edits a label, an assignee, or a ref.

import {
  CLAIM,
  authorshipIssues,
  branchIssue,
  isDependabotAuthor,
  isPromotionBranch,
  linkedIssues,
  referencingPullRequests as referencingPulls,
} from "../provenance.mjs";
import { parseVerdicts } from "../verdicts.mjs";
import {
  coverage,
  PULL_REQUEST_ROLES,
  readLeases,
  summarizeLeases,
} from "./lease.mjs";
import { ISSUE_PAGE, heldBy } from "./claimable.mjs";
import { parseBlockedBy, readBlockerStates } from "./blocked-by.mjs";
import { describeLocalWork, localIssueWork } from "./local-work.mjs";
import { listing, matchingRefs, openPullRequests } from "./release-claim.mjs";

// Exit codes are a public interface, as they are for `release-claim.mjs` and
// `review.mjs`. Keep this in sync with the table in docs/AGENT_LOOP.md.
export const EXIT = {
  ok: 0,
  usage: 1,
  disagreements: 2, // at least one classified disagreement was found
  unknown: 3, // no disagreement was found, but a source could not be read
};

const HOUR_MS = 3_600_000;
const PAGE = 100;

/**
 * @template T
 * @typedef {{ ok: true, items: T[] } | { ok: false, reason: string }} Lookup
 */

/**
 * The issue number encoded in a reservation ref name, or `null` if the ref does
 * not match the configured prefix followed by nothing but digits. Reservation
 * refs carry no slug — `rallypoint-claims/issue-42`, never `…-42-a-slug` — so
 * the match is anchored at both ends, unlike `provenance.branchIssue`, which
 * only anchors the prefix because an issue branch always has a slug after it.
 *
 * @param {string | null | undefined} refName e.g. `refs/heads/rallypoint-claims/issue-42`
 * @param {string} prefix e.g. `rallypoint-claims/issue-`
 */
export const reservationIssue = (refName, prefix) => {
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return (
    (refName ?? "")
      .replace(/^refs\/heads\//, "")
      .match(new RegExp(`^${escaped}(\\d+)$`))?.[1] ?? null
  );
};

/**
 * Every Rallypoint claim comment on an issue, oldest first, each carrying the
 * comment's own id as a fingerprint distinct from the agent id in its body.
 * Agent ids are self-declared and reused across sessions (`review.mjs`
 * documents the same limitation for its self-review guard), so the comment id
 * is what actually distinguishes one claiming session from another that
 * happened to pick the same id.
 *
 * @param {{ id?: string, body?: string | null, createdAt?: string, url?: string }[] | undefined} comments
 */
export const claimComments = (comments) =>
  (comments ?? []).flatMap((comment) => {
    const agent = (comment.body ?? "").match(CLAIM)?.at(1);
    return agent
      ? [
          {
            agent,
            createdAt: comment.createdAt,
            fingerprint: comment.id ?? comment.url ?? null,
          },
        ]
      : [];
  });

/**
 * The most recent claim comment. A released issue can be reclaimed, and the
 * newest claim is the one whose age and fingerprint describe the live claim.
 *
 * @param {{ id?: string, body?: string | null, createdAt?: string, url?: string }[] | undefined} comments
 */
export const lastClaimComment = (comments) => claimComments(comments).at(-1) ?? null;

/**
 * Every reservation ref under `prefix`, each resolved to the issue number it
 * encodes. A ref outside that shape (should never happen; kept defensive
 * because a listing that returns something unexpected is exactly the case this
 * module refuses to guess about) is dropped rather than reported against a
 * fabricated issue number.
 *
 * @param {(...args: string[]) => string} gh
 * @param {string} repository
 * @param {string} prefix
 * @returns {Lookup<{ ref: string, sha: string | null, issue: string }>}
 */
export const listReservationRefs = (gh, repository, prefix) => {
  const refs = matchingRefs(gh, repository, prefix);

  if (!refs.ok) return refs;

  return {
    ok: true,
    items: refs.items.flatMap((ref) => {
      const issue = reservationIssue(ref.ref, prefix);
      return issue === null
        ? []
        : [{ ref: ref.ref ?? "", sha: ref.object?.sha ?? null, issue }];
    }),
  };
};

/**
 * Open issues carrying `label`, with the fields the report needs from each.
 *
 * @param {(...args: string[]) => string} gh
 * @param {string} label
 * @returns {Lookup<{
 *   number: number,
 *   title: string,
 *   labels: { name: string }[],
 *   assignees: { login?: string }[],
 *   comments: { id?: string, body?: string | null, createdAt?: string, url?: string }[],
 * }>}
 */
export const listIssuesByLabel = (gh, label) =>
  listing(
    () =>
      gh(
        "issue",
        "list",
        "--state",
        "open",
        "--label",
        label,
        "--limit",
        String(PAGE),
        "--json",
        "number,title,labels,assignees,comments",
      ),
    `\`${label}\` issues`,
  );

/**
 * Every open issue, whatever its labels.
 *
 * The claimable pool is defined by the *absence* of a hold label and
 * `gh issue list` can only ask for labels an issue must have, so the
 * filtering happens in `lib/claimable.mjs` against this listing rather than in
 * the query. `listIssuesByLabel` above is still used for `status:claimed`,
 * which is a positive test and stays one.
 *
 * @param {(...args: string[]) => string} gh
 * @returns {Lookup<{
 *   number: number,
 *   title: string,
 *   labels: { name: string }[],
 *   assignees: { login?: string }[],
 *   comments: { id?: string, body?: string | null, createdAt?: string, url?: string }[],
 * }>}
 */
export const listOpenIssues = (gh) =>
  listing(
    () =>
      gh(
        "issue",
        "list",
        "--state",
        "open",
        "--limit",
        String(ISSUE_PAGE),
        "--json",
        "number,title,labels,assignees,comments",
      ),
    "open issues",
    // `ISSUE_PAGE`, not this module's `PAGE`: the limit truncation is judged
    // against must be the limit the query actually asked for, and this is the
    // one listing here that is not label-narrowed. Inheriting `PAGE` would have
    // put every pool classification behind a 100-issue cliff.
    ISSUE_PAGE,
  );

/**
 * Open blocked issues with bodies, which carry the Blocked-By declaration.
 * @param {(...args: string[]) => string} gh
 * @param {string} label
 * @returns {Lookup<{ number: number, labels: unknown, body?: string }>}
 */
export const listBlockedIssues = (gh, label) =>
  listing(
    () =>
      gh(
        "issue",
        "list",
        "--state",
        "open",
        "--label",
        label,
        "--limit",
        String(PAGE),
        "--json",
        "number,title,labels,body",
      ),
    `\`${label}\` issues`,
  );

/**
 * Every **open** issue that has at least one assignee, whatever its labels.
 *
 * The other issue lookups here are label-scoped, which is exactly why this one
 * is not: the state it exists to find is an assigned issue carrying
 * `status:claimed` no more than any hold label, so no label-scoped query would
 * ever return it. `--assignee "*"` is `gh`'s wildcard for "assigned to
 * anybody".
 *
 * @param {(...args: string[]) => string} gh
 * @returns {Lookup<{
 *   number: number,
 *   title: string,
 *   labels: { name: string }[],
 *   assignees: { login?: string }[],
 * }>}
 */
export const listAssignedOpenIssues = (gh) =>
  listing(
    () =>
      gh(
        "issue",
        "list",
        "--state",
        "open",
        "--assignee",
        "*",
        "--limit",
        String(PAGE),
        "--json",
        "number,title,labels,assignees",
      ),
    "assigned open issues",
  );

/**
 * One issue's live state, read directly rather than through a listing.
 *
 * **Why this exists.** Every other issue lookup in this module goes
 * through `gh issue list`, which is served by GitHub's search index and is
 * eventually consistent. `listReservationRefs` reads the git data API, which is
 * strongly consistent. `claim.mjs` creates the reservation ref *first* — that
 * ordering is the whole of its atomicity guarantee and is not negotiable
 * — and relabels the issue one `gh` round trip later. For that window, and for
 * however long the search index then lags, the two sources describe different
 * instants of the same claim: the ref is already there while the listing still
 * shows the issue unheld, already assigned, and not yet `status:claimed`.
 *
 * One healthy in-flight claim therefore trips `unclaimable`, `stranded`, and
 * `assigneeDrift` at once — three classifications, one shared premise, which is
 * that a label listing is a statement about *now*. It is not. Observed on #1135
 * on 2026-08-06 and again on #1266 on 2026-08-08.
 *
 * `gh issue view` is not search-backed, so it settles the question the listing
 * could only guess at. It is called only for an issue a listing has *already*
 * put under suspicion, so the cost is one call per disagreement, not per issue.
 *
 * A read that fails is `ok: false` and the caller leaves the issue **reported**
 * — the module's standing rule, and the safe direction here: a real
 * disagreement that stays on the report costs a janitor one look, while a
 * suppressed one is #236 all over again.
 *
 * @param {(...args: string[]) => string} gh
 * @param {string} issueNumber
 * @returns {{ ok: true, issue: LabeledIssue & { title: string } } | { ok: false, reason: string }}
 */
export const viewIssue = (gh, issueNumber) => {
  try {
    const parsed = JSON.parse(
      gh(
        "issue",
        "view",
        issueNumber,
        "--json",
        "number,title,labels,assignees,comments",
      ),
    );

    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {
        ok: false,
        reason: `\`gh issue view ${issueNumber}\` returned no issue object`,
      };
    }

    return {
      ok: true,
      issue: {
        number: Number(parsed.number ?? issueNumber),
        title: parsed.title ?? "",
        labels: Array.isArray(parsed.labels) ? parsed.labels : null,
        assignees: Array.isArray(parsed.assignees) ? parsed.assignees : [],
        comments: Array.isArray(parsed.comments) ? parsed.comments : [],
      },
    };
  } catch (error) {
    const detail =
      /** @type {{ stderr?: string, message?: string }} */ (error).stderr ??
      /** @type {{ message?: string }} */ (error).message ??
      String(error);
    return { ok: false, reason: `\`gh issue view ${issueNumber}\` failed: ${detail}` };
  }
};

/**
 * Closed issues carrying `label`. `gh issue list --label` only ANDs multiple
 * values, so a caller after every `status:*` label runs this once per label
 * and merges — `listClosedIssuesWithStatusLabels` below does exactly that.
 *
 * @param {(...args: string[]) => string} gh
 * @param {string} label
 * @returns {Lookup<{ number: number, title: string, labels: { name: string }[] }>}
 */
export const listClosedIssuesByLabel = (gh, label) =>
  listing(
    () =>
      gh(
        "issue",
        "list",
        "--state",
        "closed",
        "--label",
        label,
        "--limit",
        String(PAGE),
        "--json",
        "number,title,labels",
      ),
    `closed \`${label}\` issues`,
  );

/**
 * Every closed issue that still carries at least one of `labels`, deduplicated
 * by issue number. Each per-label query already returns the issue's full label
 * set, not just the matched label, so one entry per issue is enough to see
 * every stale `status:*` label it carries — a second query finding the same
 * issue under a different label would only repeat the same row.
 *
 * A label whose own query fails is reported as a failure rather than folded
 * into "no closed issues carry it", matching the "unknown, never absent" rule
 * the rest of this module keeps.
 *
 * @param {(...args: string[]) => string} gh
 * @param {string[]} labels
 * @returns {{ items: { number: number, title: string, labels: { name: string }[] }[], failures: string[] }}
 */
export const listClosedIssuesWithStatusLabels = (gh, labels) => {
  /** @type {Map<number, { number: number, title: string, labels: { name: string }[] }>} */
  const byNumber = new Map();
  /** @type {string[]} */
  const failures = [];

  for (const label of labels) {
    const result = listClosedIssuesByLabel(gh, label);

    if (!result.ok) {
      failures.push(`closed \`${label}\` issues could not be listed: ${result.reason}`);
      continue;
    }

    for (const issue of result.items) byNumber.set(issue.number, issue);
  }

  return { items: [...byNumber.values()], failures };
};

// The subset of `config.labels` that are actually `status:*` labels —
// `human` (`needs:human`), `approved` (`review:approved`), and
// `mergedUnreviewed` (`merged:unreviewed`) are configured labels but not this
// family, and a closed issue is expected to keep `merged:unreviewed` and
// `review:approved` after it closes.
const STATUS_LABEL_KEYS = /** @type {const} */ ([
  "claimed",
  "blocked",
  "changesRequested",
  "deferred",
]);

/**
 * @param {{
 *   labels: {
 *     claimed: string,
 *     blocked?: string,
 *     changesRequested?: string,
 *     deferred?: string,
 *   },
 * }} config
 * @returns {string[]}
 */
export const statusLabelNames = (config) =>
  STATUS_LABEL_KEYS.flatMap((key) =>
    config.labels[key] ? [/** @type {string} */ (config.labels[key])] : [],
  );

/**
 * A pull request's reviews, normalized to the shape `verdicts.parseVerdicts`
 * reads — `verdicts.mjs` stays free of `gh` calls, so the snake_case ->
 * camelCase mapping lives at the call site here, the same as `review.mjs`
 * does for its own `check` command.
 *
 * @param {(...args: string[]) => string} gh
 * @param {string} repository
 * @param {number} pr
 * @returns {Lookup<{ body: string | null, submittedAt: string | null, commitId: string | null }>}
 */
export const pullRequestReviews = (gh, repository, pr) => {
  const raw = listing(
    () => gh("api", "--paginate", `repos/${repository}/pulls/${pr}/reviews`),
    `reviews for #${pr}`,
  );

  if (!raw.ok) return raw;

  return {
    ok: true,
    items: raw.items.map(
      (/** @type {{ body: string | null, submitted_at: string | null, commit_id: string | null }} */ review) => ({
        body: review.body,
        submittedAt: review.submitted_at,
        commitId: review.commit_id,
      }),
    ),
  };
};

/**
 * @typedef {(
 *   | "unclaimable"
 *   | "unprotected"
 *   | "stranded"
 *   | "unclaimedWithOpenPr"
 *   | "unreservedWithOpenPr"
 *   | "janitorCandidate"
 *   | "assigneeDrift"
 *   | "needsFixer"
 *   | "closedWithStatusLabel"
 *   | "wouldFailRecord"
 *   | "blockedWithClearedDependencies"
 *   | "holdWithoutReason"
 * )} DisagreementKind
 */

/**
 * `issue` is the issue this disagreement is about. `wouldFailRecord` is the one
 * kind that may have none — a pull request whose branch and body between them
 * resolve no authoring issue is exactly what it reports — and it says
 * `"unknown"` there rather than inventing one. It carries `pull` as well, since
 * the pull request number is the identifier that actually locates it; every
 * other kind omits that field.
 *
 * @typedef {{ kind: DisagreementKind, issue: string, detail: string, pull?: number }} Disagreement
 */

/**
 * @typedef {{
 *   number: number,
 *   labels?: unknown,
 *   assignees: { login?: string }[],
 *   comments: { id?: string, body?: string | null, createdAt?: string, url?: string }[],
 * }} LabeledIssue
 */

/**
 * Every open pull request that names `issueNumber`, either by its
 * `agent/<issue>-` branch name — which `claim.mjs` writes and nobody can edit
 * afterwards — or by a `Closes #<issue>` reference in its body. The predicate
 * itself lives in `provenance.mjs`, shared with `claim.mjs` and
 * `reconcile.mjs`, so this link is computed the same way here as it is by
 * `review.mjs`; this wrapper only keeps the positional call shape the
 * classifications below already read with.
 *
 * @template {{ number: number, headRefName: string, body: string | null }} Pull
 * @param {Pull[]} pulls
 * @param {string} issueNumber
 * @param {string} branchPrefix
 * @returns {Pull[]}
 */
const referencingPullRequests = (pulls, issueNumber, branchPrefix) =>
  referencingPulls({ pulls, issue: issueNumber, branchPrefix });

/**
 * Classifies every disagreement between the four sources, rather than dumping
 * raw rows. Every rule that depends on a source guards that source's `ok` flag
 * first: a source this run could not read is never treated as if it had come
 * back empty, so a classification that needs it simply does not fire, and the
 * gap is surfaced separately as `unknowns`.
 *
 * @param {{
 *   config: {
 *     labels: { claimed: string, blocked?: string, deferred?: string, human?: string },
 *     branchPrefix: string,
 *     staleClaimHours: number,
 *     integrationBranch?: string | null,
 *     promotionBranch?: string | null,
 *   },
 *   now: number,
 *   refs: Lookup<{ ref: string, sha: string | null, issue: string }>,
 *   claimed: Lookup<LabeledIssue>,
 *   openIssues: Lookup<LabeledIssue>,
 *   prs: Lookup<{ number: number, headRefName: string, headRefOid: string, body: string | null, updatedAt: string, author?: unknown }>,
 *   reviewsByPr: Map<number, Lookup<{ body: string | null, submittedAt: string | null, commitId: string | null }>> | null,
 *   closedStatus?: { items: { number: number, labels: unknown }[], failures: string[] } | null,
 *   assignedOpen?: Lookup<{ number: number, labels: unknown, assignees: { login?: string }[] }> | null,
 *   localWork?: ((issue: string) => Lookup<import("./local-work.mjs").LocalWork>) | null,
 *   confirmIssue?: ((issue: string) => ReturnType<typeof viewIssue>) | null,
 *   blocked?: Lookup<{ number: number, labels: unknown, body?: string }> | null,
 *   blockerState?: ((blockers: string[]) => Map<string, import("./blocked-by.mjs").BlockerState>) | null,
 * }} input
 */
export const classify = ({
  config,
  now,
  refs,
  claimed,
  openIssues,
  prs,
  reviewsByPr,
  closedStatus = null,
  assignedOpen = null,
  localWork = null,
  confirmIssue = null,
  blocked = null,
  blockerState = null,
}) => {
  // Every `status:claimed` issue with no open pull request behind it, whatever
  // its age. `janitorCandidate` below is the subset the age threshold has
  // already cleared, and it stays the human-facing classification; this is the
  // set a pass should *offer* to `release-claim.mjs`, which is the single
  // authority on eligibility and refuses harmlessly when a claim is not
  // releasable yet.
  //
  // The two differ, and #901 is why the wider set exists. A session that
  // claims, pushes, merges, and ends inside the window leaves a claim that
  // `release-claim.mjs` now releases on settled-pull-request grounds while this
  // classifier — which reads only the claim's age — would never nominate it.
  // Duplicating the settled-branch rule here would put two copies of it in the
  // repository, which is exactly how `report.mjs` and `release-claim.mjs`
  // answers drift apart.
  /** @type {string[]} */
  const claimCandidates = [];
  // Claims this machine can prove are alive from unpushed local work, held out
  // of `janitorCandidate` below rather than asserted stale. Reported in
  // its own section: suppressing them silently would be the same dishonesty in
  // the other direction.
  /** @type {{ issue: string, detail: string }[]} */
  const localWorkHeld = [];
  /** @type {Disagreement[]} */
  const disagreements = [];
  /** @type {string[]} */
  const unknowns = [];

  if (!refs.ok) {
    unknowns.push(`reservation refs could not be listed: ${refs.reason}`);
  }
  if (!claimed.ok) {
    unknowns.push(
      `\`${config.labels.claimed}\` issues could not be listed: ${claimed.reason}`,
    );
  }
  if (!openIssues.ok) {
    unknowns.push(`open issues could not be listed: ${openIssues.reason}`);
  }
  if (!prs.ok) {
    unknowns.push(`open pull requests could not be listed: ${prs.reason}`);
  }

  const refByIssue = new Map(
    refs.ok ? refs.items.map((ref) => [ref.issue, ref]) : [],
  );
  const claimedByIssue = new Map(
    claimed.ok ? claimed.items.map((issue) => [String(issue.number), issue]) : [],
  );
  // The claimable pool, derived rather than read off a label: an open
  // issue carrying none of `status:claimed`, `status:blocked`, `status:deferred`
  // or `needs:human`. Assignees are deliberately *not* filtered here — an
  // assigned pool issue is the `assigneeDrift` classification below, and
  // dropping it from this map would delete the evidence for it.
  //
  // An issue whose labels could not be read is left out, matching
  // `isClaimable`: absent from the pool is the conservative answer, and the
  // read failure is reported as its own unknown rather than folded into a
  // classification.
  const poolByIssue = new Map(
    openIssues.ok
      ? openIssues.items.flatMap((issue) => {
          const held = heldBy(issue, config);

          if (held === null) {
            unknowns.push(
              `#${issue.number}'s labels could not be read, so whether it is ` +
                "in the claimable pool cannot be established.",
            );
            return [];
          }

          return held.length === 0
            ? [/** @type {[string, typeof issue]} */ ([String(issue.number), issue])]
            : [];
        })
      : [],
  );

  // Claims caught mid-flight: a reservation ref the strongly-consistent git
  // data API already returns, against a label listing that has not caught up
  // (#1140, and see `viewIssue` for the mechanism). Held out of the three
  // classifications the lag produces, and reported in their own section — the
  // same shape #1308 used for `localWorkHeld`, because a suppression nobody can
  // see is the failure mode both of these exist to avoid.
  /** @type {{ issue: string, detail: string }[]} */
  const claimsInFlight = [];
  /** @type {Set<string>} */
  const inFlight = new Set();

  // The confirming read runs *only* where the two sources already disagree —
  // a ref with no `status:claimed` issue behind it in the listing. That is the
  // footprint of the lag and also the footprint of every genuine `unclaimable`,
  // so nothing is suppressed that the direct read did not positively contradict.
  //
  // Three outcomes, and only one of them changes an answer:
  //
  // - the direct read says `status:claimed`: the listing lagged. The issue is
  //   moved into the claimed set, which is where it actually is, so
  //   `unclaimable`, `stranded`, and `assigneeDrift` all stop firing from the
  //   one correction rather than being suppressed one at a time.
  // - the direct read agrees with the listing: a real disagreement. Untouched.
  // - the read failed, or its labels were unreadable: `unknown`, never
  //   "absent". The issue stays classified exactly as the listing said, so a
  //   confirming read this run could not make never hides a defect.
  if (confirmIssue && refs.ok && claimed.ok) {
    for (const issueNumber of refByIssue.keys()) {
      if (claimedByIssue.has(issueNumber)) continue;

      const confirmed = confirmIssue(issueNumber);

      if (!confirmed.ok) {
        unknowns.push(
          `#${issueNumber} has a live reservation and does not carry ` +
            `\`${config.labels.claimed}\` in the issue listing, but the direct ` +
            `read that would confirm it failed (${confirmed.reason}); it is ` +
            "reported below as the listing described it.",
        );
        continue;
      }

      const labels = Array.isArray(confirmed.issue.labels)
        ? confirmed.issue.labels
        : null;

      if (labels === null) {
        unknowns.push(
          `#${issueNumber}'s labels could not be read on the confirming direct ` +
            "read, so whether its reservation is orphaned or its claim merely " +
            "in flight cannot be established; it is reported below as the " +
            "listing described it.",
        );
        continue;
      }

      if (!labels.some((label) => label?.name === config.labels.claimed)) continue;

      claimedByIssue.set(issueNumber, confirmed.issue);
      poolByIssue.delete(issueNumber);
      inFlight.add(issueNumber);
      claimsInFlight.push({
        issue: issueNumber,
        detail:
          `#${issueNumber} reads unheld in the ` +
          "search-backed issue listing while its reservation " +
          `\`${refByIssue.get(issueNumber)?.ref}\` is live, but a direct ` +
          `\`gh issue view\` shows \`${config.labels.claimed}\`: the claim is in ` +
          "flight and the listing is lagging behind it. Nothing is owed. Do " +
          "not restore a label, release the reservation, or run " +
          "`release-claim.mjs` on it — a second writer on a live claim is the " +
          "exact collision the reservation ref exists to prevent.",
      });
    }
  }

  // ref with no `status:claimed` issue behind it -> unclaimable (the #236
  // stranding case).
  //
  // A pool issue is skipped here because `stranded` below reports it, and the
  // two would otherwise fire together on every one of them. Since #1510 the
  // pool is defined by the *absence* of `status:claimed`, so every stranded
  // issue is necessarily also an unclaimable one — `stranded` became a strict
  // subset rather than a sibling, and left unguarded the commonest janitor case
  // of all (#329's orphaned reservation) would appear twice under two headings
  // implying two different remedies.
  //
  // The split is kept rather than collapsed because the two are not equally
  // urgent. A held issue with an orphan ref is inert: the hold keeps
  // `claim.mjs` away from it regardless. A *claimable* issue with an orphan ref
  // is offered to a session and then silently skipped when the reservation
  // collides, which is the state that cost #329 six weeks.
  if (refs.ok && claimed.ok) {
    for (const [issueNumber, ref] of refByIssue) {
      if (openIssues.ok && poolByIssue.has(issueNumber)) continue;

      if (!claimedByIssue.has(issueNumber)) {
        disagreements.push({
          kind: "unclaimable",
          issue: issueNumber,
          detail:
            `reservation \`${ref.ref}\` (${ref.sha ?? "sha unknown"}) exists ` +
            `but #${issueNumber} does not carry \`${config.labels.claimed}\`.`,
        });
      }
    }
  }

  // `status:claimed` with no ref -> unprotected: a second session could claim
  // it, since only the ref stops a second `claim.mjs` reservation.
  if (refs.ok && claimed.ok) {
    for (const issueNumber of claimedByIssue.keys()) {
      if (!refByIssue.has(issueNumber)) {
        disagreements.push({
          kind: "unprotected",
          issue: issueNumber,
          detail:
            `#${issueNumber} carries \`${config.labels.claimed}\` with no ` +
            "reservation ref; a second session could claim it.",
        });
      }
    }
  }

  // A pool issue with a live ref -> stranded: it advertises as available and
  // is silently skipped by `claim.mjs`.
  if (refs.ok && openIssues.ok) {
    for (const [issueNumber, ref] of Array.from(poolByIssue.keys()).flatMap(
      (issueNumber) =>
        refByIssue.has(issueNumber)
          ? [/** @type {[string, { ref: string }]} */ ([issueNumber, refByIssue.get(issueNumber)])]
          : [],
    )) {
      disagreements.push({
        kind: "stranded",
        issue: issueNumber,
        detail:
          `#${issueNumber} carries no hold label while reservation ` +
          `\`${ref.ref}\` is live; it advertises as claimable and is silently ` +
          "skipped.",
      });
    }
  }

  // A pool issue, an open pull request already referencing it, and no
  // reservation ref -> the work is underway but nothing reserves it.
  //
  // Every other rule misses this state. `stranded` needs a ref, and there is
  // none; `assigneeDrift` for a pool issue needs an assignee, and `claim.mjs`
  // never ran so nothing was ever assigned; `janitorCandidate` and `needsFixer`
  // iterate `claimedByIssue` only, so an issue that was never claimed is outside
  // their loops entirely. It is the one place the claimable pool and the open
  // pull request list disagree with nothing in between them to notice.
  //
  // Two different states satisfy that condition, and they take opposite
  // recoveries. The claim comment is what separates them, and the
  // listing already carries `comments`, so the answer is in hand right here:
  //
  // - No claim comment: nothing ever ran `claim.mjs` for this issue. It costs
  //   twice — `claim.mjs` can still hand the issue to a second session, because
  //   only a ref stops a second reservation, and `review.mjs record` refuses the
  //   resulting pull request with exit `2` for want of a claim comment on the
  //   linked issue. `rallypoint:reconcile` backfills the comment; that is
  //   `unclaimedWithOpenPr`.
  // - A claim comment present: only the reservation ref is missing, which is
  //   what a `release-claim` on an issue whose pull request outlived the release
  //   leaves behind. Authorship resolves, so `review.mjs record` is unaffected,
  //   and `rallypoint:reconcile` refuses this shape outright with its own exit
  //   `2` ("already has a claim comment") — the recovery the single old
  //   classification recommended could therefore never succeed here. That is
  //   `unreservedWithOpenPr`, and it is benign; see its detail below.
  if (refs.ok && openIssues.ok && prs.ok) {
    for (const [issueNumber, issue] of poolByIssue) {
      // A ref here already reports as `stranded`; the same issue must not be
      // counted under two kinds.
      if (refByIssue.has(issueNumber)) continue;

      const referencing = referencingPullRequests(
        prs.items,
        issueNumber,
        config.branchPrefix,
      );

      if (referencing.length === 0) continue;

      const pulls = referencing.map((pull) => `#${pull.number}`).join(", ");
      const claim = lastClaimComment(issue.comments);

      disagreements.push(
        claim
          ? {
              kind: "unreservedWithOpenPr",
              issue: issueNumber,
              detail:
                `#${issueNumber} is claimable with no reservation ` +
                `ref while pull request ${pulls} already references it, but its claim ` +
                `comment (\`${claim.agent}\`) is intact, so authorship resolves and ` +
                "`review.mjs record` is unaffected. Only the reservation ref is " +
                "missing. `rallypoint:reconcile` does not apply — it refuses an issue " +
                "that already carries a claim comment with its own exit 2. No janitor " +
                "action: nothing re-creates a reservation ref, and this state clears " +
                `itself when ${pulls} merges. \`claim.mjs\`'s open-pull-request filter ` +
                " keeps the issue from being handed to a second session " +
                'until then (docs/AGENT_LOOP.md, "Coordination-state report").',
            }
          : {
              kind: "unclaimedWithOpenPr",
              issue: issueNumber,
              detail:
                `#${issueNumber} is claimable with no reservation ` +
                `ref and no claim comment while pull request ${pulls} already ` +
                "references it, so `review.mjs record` will refuse the branch with " +
                "exit 2 for want of one. Recover with " +
                `\`pnpm run rallypoint:reconcile --issue ${issueNumber} ` +
                "--agent-id <authoring-session-id>` (docs/AGENT_LOOP.md, " +
                '"Reconciling a missing claim comment").',
            },
      );
    }
  }

  // An open pull request `review.mjs record` would refuse outright.
  //
  // The two classifications above start from an *issue* and ask what the pull
  // request queue says about it, so a pull request that resolves no issue at
  // all is outside both loops by construction — there is no issue to iterate
  // from. That is exactly the shape that costs the most: a reviewer reads the
  // whole diff, forms a verdict, and only then discovers `record` has nowhere
  // to put it. `docs/AGENT_LOOP.md` named this a known gap until this rule
  // closed it.
  //
  // The judgement is `authorshipIssues` from `provenance.mjs` — the function
  // `record`'s own refusal gate calls (`review.mjs:503`), so this predicts the
  // refusal rather than approximating it. Deliberately **not**
  // `recordableIssue`: `record` calls that one only to pick the issue a label
  // is reconciled onto, where a null result is tolerated rather than refused.
  // So `recordableIssue`'s third reason, `ambiguous-body` — a branchless pull
  // request whose body closes several issues — is a shape `record` accepts,
  // and is exactly the multi-issue pull request #1103/#1106 made reviewable.
  // Flagging it would withhold a reviewer from the one shape #1106 was filed
  // to stop stranding.
  //
  // It reads only the branch name and the body, which the pull request listing
  // already carries, so no extra network call is made and `--skip-pr-checks`
  // does not suppress it. That also bounds what it can prove: `record` refuses
  // a third way, when no referenced issue carries a claim comment
  // (`review.mjs:524`), which needs the issue's comments and is invisible
  // here. Silence from this rule is not a promise that `record` will accept.
  //
  // Two pull request shapes legitimately resolve no issue and are not defects:
  //
  // - A **promotion** (`release` -> `staging`, `staging` -> `main`). Nobody
  //   runs `claim.mjs` against one, and `record` has its own path for it
  //.
  // - A **Dependabot** pull request, which has no authoring agent session at
  //   all. Recognised by authorship rather than by branch name, for the
  //   reason `provenance.mjs` gives: a branch name is not proof of authorship.
  //   An `author` this run could not read is reported as unknown rather than
  //   assumed human — assuming would flag every Dependabot pull request on a
  //   transport that does not return the field.
  if (prs.ok) {
    for (const pull of prs.items) {
      // No snapshot-promotion evidence is passed. This summariser is a
      // pure function over already-fetched lookups and holds no transport, so
      // containment cannot be established here, and the fail-closed rule then
      // withholds the exemption. The cost is one advisory "resolves no
      // authoring issue" line against an open snapshot promotion — noise on a
      // report, not a gate: nothing here labels, merges, or refuses anything.
      // Threading a transport into this function to remove that line is a
      // larger change than the defect warrants and is not folded in here.
      if (isPromotionBranch(pull.headRefName, config)) continue;

      const authorship = authorshipIssues({
        linkedIssues: linkedIssues(pull.body),
        branchIssue: branchIssue(pull.headRefName, config.branchPrefix),
      });

      // Asked first, and only then is the author consulted: a pull request
      // `record` would accept needs no exemption, so an unreadable author on
      // one of those is not a gap in this run's knowledge and reporting it
      // would be noise on every healthy pull request.
      if (authorship.ok) continue;

      if (pull.author === undefined) {
        unknowns.push(
          `#${pull.number} (${pull.headRefName}) resolves no authoring issue, ` +
            "but its author could not be read, so whether that is a defect or " +
            "a Dependabot pull request — which legitimately has none — " +
            "cannot be established.",
        );
        continue;
      }

      if (isDependabotAuthor(pull.author)) continue;

      const branch = branchIssue(pull.headRefName, config.branchPrefix);

      disagreements.push({
        kind: "wouldFailRecord",
        issue: branch ?? "unknown",
        pull: pull.number,
        detail:
          `pull request #${pull.number} (${pull.headRefName}) resolves no ` +
          `authoring issue (\`${authorship.reason}\`), so \`review.mjs record\` ` +
          "will refuse a verdict on it and a reviewer's pass is wasted. " +
          (authorship.reason === "mismatch"
            ? `Its branch names #${branch} while its body's closing keywords ` +
              `point only at ${linkedIssues(pull.body)
                .map((issue) => `#${issue}`)
                .join(", ")}; add \`Closes #${branch}\` to the body.`
            : "Neither its branch name nor a closing keyword in its body " +
              "names an issue; a branch cannot be renamed after the pull " +
              "request is open, so recovering this means adding a " +
              "`Closes #<issue>` line to the body."),
      });
    }
  }

  // `status:claimed` with the assignee cleared, or a claimable issue still
  // assigned -> the silent no-op `claim.mjs` filters candidates on.
  if (claimed.ok) {
    for (const [issueNumber, issue] of claimedByIssue) {
      if (issue.assignees.length === 0) {
        disagreements.push({
          kind: "assigneeDrift",
          issue: issueNumber,
          detail: `#${issueNumber} carries \`${config.labels.claimed}\` with no assignee.`,
        });
      }
    }
  }
  if (openIssues.ok) {
    for (const [issueNumber, issue] of poolByIssue) {
      if (issue.assignees.length > 0) {
        disagreements.push({
          kind: "assigneeDrift",
          issue: issueNumber,
          detail:
            `#${issueNumber} carries no hold label but is still assigned; ` +
            "`claim.mjs` filters every assigned issue out of the pool, so it " +
            "reads as claimable on the board and is invisible to a claim attempt.",
        });
      }
    }
  }

  // The same trap, on an issue a hold label keeps out of the pool. The
  // two rules above read the `status:claimed` set and the claimable pool, so an
  // assigned open issue in neither — one carrying `status:blocked`,
  // `status:deferred` or `needs:human` — is outside both loops, and that is a
  // state the loop reaches by two ordinary routes, not by corruption:
  //
  // - A **reopened** issue. Closing never clears the assignee (442 of 558 closed
  //   issues here are assigned, so that is the norm and not worth repairing at
  //   close time — it records who did the work). Reopening one hands back an
  //   open, assigned, unreserved issue; #34 sat exactly so after its operator
  //   reopen on 2026-08-06.
  // - A **worker standing down**, which `worker.md` tells it to do by moving the
  //   issue to `status:blocked` + `needs:human` and releasing its reservation.
  //   Until #1217 that release left the assignee behind; #721, #784, #795, #883
  //   and #1056 were all found this way on 2026-08-07.
  //
  // Nothing is refused while the issue sits here, because the hold label keeps
  // `claim.mjs` away from it regardless. It springs when somebody clears the
  // hold: the issue then reads as free on every board while every claim attempt
  // passes over it as somebody's work in progress. #329 spent six weeks in that
  // state, and since #1510 clearing a hold is the *only* step needed to make an
  // issue claimable — there is no second label to add, so no second moment at
  // which a person might notice the stale assignee.
  //
  // Reported, never repaired — clearing an assignee is a statement about whose
  // work an issue is, which is the one thing this module must not decide.
  if (assignedOpen) {
    if (!assignedOpen.ok) {
      unknowns.push(
        `assigned open issues could not be listed: ${assignedOpen.reason}. ` +
          `An issue assigned while carrying neither \`${config.labels.claimed}\` ` +
          "nor a hold label cannot be detected this run.",
      );
    } else {
      for (const issue of assignedOpen.items) {
        const issueNumber = String(issue.number);

        // This listing is search-backed too, so a claim confirmed in flight
        // above can arrive here still wearing its pre-claim labels. Its
        // assignee is the one `claim.mjs` has just set.
        if (inFlight.has(issueNumber)) continue;

        const labels = Array.isArray(issue.labels) ? issue.labels : null;

        if (labels === null) {
          unknowns.push(
            `#${issueNumber} is assigned, but its labels could not be read, so ` +
              "whether its assignee is stale cannot be established.",
          );
          continue;
        }

        const names = labels.map((label) => label?.name);

        // `status:claimed` + assigned is the healthy state this whole protocol
        // aims at. A *pool* issue that is assigned is the rule directly above;
        // firing here too would report one issue twice for one assignee.
        if (names.includes(config.labels.claimed)) continue;
        if (poolByIssue.has(issueNumber)) continue;

        const logins = issue.assignees
          .flatMap((assignee) => (assignee.login ? [assignee.login] : []))
          .map((login) => `\`${login}\``);

        disagreements.push({
          kind: "assigneeDrift",
          issue: issueNumber,
          detail:
            `#${issueNumber} is assigned (${logins.join(", ") || "assignee login unreadable"}) ` +
            `while carrying neither \`${config.labels.claimed}\` nor any hold ` +
            "label this report could read, so the assignee outlived the claim " +
            "that set it. Nothing is refused today — but clear the hold and " +
            "this issue advertises as free while every claim attempt passes " +
            "over it as somebody's work in progress.",
        });
      }
    }
  }

  // `status:claimed`, no open pull request, older than `staleClaimHours` ->
  // janitor candidate, with the evidence attached. A claim comment this run
  // cannot read or cannot age is reported as unknown, never folded into "not a
  // candidate".
  if (claimed.ok && prs.ok) {
    for (const [issueNumber, issue] of claimedByIssue) {
      const referencing = referencingPullRequests(
        prs.items,
        issueNumber,
        config.branchPrefix,
      );

      if (referencing.length > 0) continue;

      // A claim confirmed in flight seconds ago is the one thing this set must
      // not contain. `janitor-pass.mjs` offers every `claimCandidate` to
      // `release-claim.mjs`, and today only incidental refusals — no claim
      // comment yet, or an age under `staleClaimHours` — stand between that
      // offer and a released live claim. Neither of them knows a claim is in
      // flight; this does. It is also why the confirming read moves the
      // issue into the claimed set rather than merely dropping three
      // classifications: moving it without this would trade one wrong answer
      // for a worse one.
      if (inFlight.has(issueNumber)) continue;

      claimCandidates.push(issueNumber);

      const claim = lastClaimComment(issue.comments);

      if (!claim) {
        unknowns.push(
          `#${issueNumber} carries \`${config.labels.claimed}\` with no ` +
            "Rallypoint claim comment, so its claim age cannot be established.",
        );
        continue;
      }

      const claimedAt = Date.parse(claim.createdAt ?? "");

      if (Number.isNaN(claimedAt)) {
        unknowns.push(
          `#${issueNumber}'s claim comment has an unreadable timestamp ` +
            `(${claim.createdAt}).`,
        );
        continue;
      }

      const ageHours = (now - claimedAt) / HOUR_MS;

      if (ageHours <= config.staleClaimHours) continue;

      // Neither input above can see a session that has not pushed yet, and on
      // this repository that is most of a session's life. Where local
      // evidence is available it decides, and where it is not the wording says
      // so rather than asserting a staleness this classifier cannot establish.
      const local = localWork ? localWork(issueNumber) : null;

      if (local && local.ok && local.items.length > 0) {
        localWorkHeld.push({
          issue: issueNumber,
          detail:
            `#${issueNumber} claimed by \`${claim.agent}\` at ${claim.createdAt} ` +
            `(${ageHours.toFixed(1)}h ago) with no open pull request, but ` +
            `${describeLocalWork(local.items, issueNumber)}.`,
        });
        continue;
      }

      const liveness =
        local === null
          ? "This run read no local worktrees, so whether a session is running was not established."
          : local.ok
            ? "No worktree on this machine holds unpushed work for it; a session on another host is not visible to this check."
            : `Local worktrees could not be read (${local.reason}), so whether a session is running was not established.`;

      disagreements.push({
        kind: "janitorCandidate",
        issue: issueNumber,
        detail:
          `#${issueNumber} claimed by \`${claim.agent}\` at ${claim.createdAt} ` +
          `(${ageHours.toFixed(1)}h ago); no open pull request references it, ` +
          `past the ${config.staleClaimHours}h staleClaimHours threshold. ` +
          `${liveness} \`release-claim.mjs\` is the authority on whether it may be released.`,
      });
    }
  }

  // `status:claimed` with an open pull request whose latest verdict at its
  // current head is `request-changes` -> needs a fixer. A verdict is bound to
  // the head SHA it was recorded against (`review.mjs`, `verdicts.mjs`), so
  // filtering to `entry.sha === pull.headRefOid` already establishes "no push
  // since that review" — a push moves the head and the old verdict no longer
  // matches it. `reviewsByPr` is `null` when the caller skipped the per-PR
  // network pass (`--skip-pr-checks`); this classification simply does not run
  // then, the same as `summarizePullRequests` is skipped.
  if (claimed.ok && prs.ok && reviewsByPr) {
    for (const issueNumber of claimedByIssue.keys()) {
      const referencing = referencingPullRequests(
        prs.items,
        issueNumber,
        config.branchPrefix,
      );

      for (const pull of referencing) {
        const reviews = reviewsByPr.get(pull.number);

        if (!reviews) {
          unknowns.push(
            `#${pull.number}'s reviews were not fetched, so whether #${issueNumber} ` +
              "needs a fixer cannot be established.",
          );
          continue;
        }

        if (!reviews.ok) {
          unknowns.push(
            `#${pull.number}'s reviews could not be listed: ${reviews.reason}`,
          );
          continue;
        }

        const latest = parseVerdicts(reviews.items)
          .filter((entry) => entry.sha === pull.headRefOid)
          .at(-1);

        if (latest?.verdict === "request-changes") {
          disagreements.push({
            kind: "needsFixer",
            issue: issueNumber,
            detail:
              `#${issueNumber} (PR #${pull.number}) has a request-changes verdict ` +
              `from \`${latest.reviewer}\` at \`${pull.headRefOid.slice(0, 7)}\` and ` +
              "no push since; it is claimed but nobody is working the fix.",
          });
        }
      }
    }
  }

  // A closed issue still carrying a `status:*` label — nothing in the loop
  // above ever looks at closed issues, since every other classification reads
  // `gh issue list --state open` (`listIssuesByLabel`). #989 closed natively
  // when its pull request merged with a `Closes #989` keyword and kept a
  // stale status label: `report.mjs`'s own survey never fetches a closed issue, so
  // it structurally could not have landed in any of the classifications above,
  // and no other script touches a label left on an issue that was never
  // claimed through the protocol (`close-referenced-issues.mjs` only reacts to
  // `status:claimed`, which #989 never carried). Reported, and repairable with
  // `clear-status-labels.mjs`, which this classification's detail names.
  if (closedStatus) {
    for (const reason of closedStatus.failures) unknowns.push(reason);

    for (const issue of closedStatus.items) {
      const labels = Array.isArray(issue.labels) ? issue.labels : null;

      if (labels === null) {
        unknowns.push(
          `#${issue.number}'s labels could not be read, so whether it carries ` +
            "a stale status:* label after closing cannot be established.",
        );
        continue;
      }

      const stale = labels.flatMap((label) =>
        typeof label?.name === "string" && label.name.startsWith("status:")
          ? [label.name]
          : [],
      );

      if (stale.length === 0) continue;

      const issueNumber = String(issue.number);

      disagreements.push({
        kind: "closedWithStatusLabel",
        issue: issueNumber,
        detail:
          `#${issueNumber} is closed but still carries ${stale.map((name) => `\`${name}\``).join(", ")}; ` +
          "nothing clears a status label off an issue that closed without passing through the claim " +
          `protocol. Clear it with \`node .rallypoint/scripts/clear-status-labels.mjs --issue ${issueNumber}\`.`,
      });
    }
  }

  if (blocked) {
    if (!blocked.ok) {
      unknowns.push(
        `\`${config.labels.blocked}\` issues could not be listed: ${blocked.reason}. Whether any cleared dependency remains held cannot be established this run.`,
      );
    } else {
      for (const issue of blocked.items) {
        const issueNumber = String(issue.number);
        const declaration = parseBlockedBy(issue.body);

        if (declaration.kind === "absent") {
          disagreements.push({
            kind: "holdWithoutReason",
            issue: issueNumber,
            detail: `#${issueNumber} carries \`${config.labels.blocked}\` with no \`Blocked-By:\` trailer. Add the dependency trailer, or use \`${config.labels.deferred ?? "status:deferred"}\` for a deliberate hold that does not clear automatically.`,
          });
          continue;
        }
        if (declaration.kind === "unparseable") {
          unknowns.push(
            `#${issueNumber}'s \`Blocked-By:\` trailer could not be parsed — ${declaration.reason}. The line reads \`${declaration.line}\`; no writer will touch it until corrected.`,
          );
          continue;
        }

        const states = blockerState ? blockerState(declaration.blockers) : new Map();
        const unreadable = declaration.blockers.filter(
          (blocker) => (states.get(blocker)?.state ?? "unknown") === "unknown",
        );
        if (unreadable.length > 0) {
          unknowns.push(
            `#${issueNumber}'s blockers could not all be read (${unreadable.map((blocker) => `#${blocker}`).join(", ")}), so whether its dependencies cleared cannot be established.`,
          );
          continue;
        }
        if (declaration.blockers.some((blocker) => states.get(blocker)?.state !== "CLOSED")) continue;

        const labels = Array.isArray(issue.labels)
          ? issue.labels.map((label) => label?.name)
          : [];
        const human = config.labels.human && labels.includes(config.labels.human);
        disagreements.push({
          kind: "blockedWithClearedDependencies",
          issue: issueNumber,
          detail:
            `#${issueNumber} remains \`${config.labels.blocked}\` although ${declaration.blockers.map((blocker) => `#${blocker}`).join(", ")} ${declaration.blockers.length === 1 ? "is" : "are"} closed. ` +
            (human
              ? `It also carries \`${config.labels.human}\`, which vetoes automatic removal; the operator holding it must decide.`
              : `Run \`node .rallypoint/scripts/unblock-cleared.mjs --issue ${issueNumber}\`; removing the hold makes it claimable by the derived-pool rule.`),
        });
      }
    }
  }

  if (openIssues.ok && config.labels.deferred) {
    for (const issue of openIssues.items) {
      const labels = Array.isArray(issue.labels) ? issue.labels.map((label) => label?.name) : [];
      if (!labels.includes(config.labels.deferred)) continue;
      if (Array.isArray(issue.comments) && issue.comments.length > 0) continue;
      disagreements.push({
        kind: "holdWithoutReason",
        issue: String(issue.number),
        detail: `#${issue.number} carries \`${config.labels.deferred}\` with no comment recording the deliberate hold. Record the condition, or remove the hold label if nothing blocks the issue.`,
      });
    }
  }

  return {
    disagreements,
    unknowns,
    refByIssue,
    claimedByIssue,
    poolByIssue,
    claimCandidates,
    localWorkHeld,
    claimsInFlight,
  };
};

// `review.mjs check`'s own documented exit codes (docs/AGENT_LOOP.md). `1` is a
// usage error from this report's own invocation, not a verdict about the pull
// request, and is reported plainly rather than folded into a meaning about the
// PR. Codes `2`, `3`, `9`, and `12` belong to `record`, not `check`, and never
// appear here; an undocumented code is reported as such rather than guessed at.
//
// This is a *consumer* of `REVIEW_EXIT_CODES` in `review-exit-codes.mjs`, which
// is the single authority. The wording here is deliberately its own:
// this table is read by an orchestrator deciding whether to dispatch a merger,
// so it phrases each code as a board state in a few words, where
// `CHECK_CLASSIFICATIONS` in `audit-merge-review.mjs` phrases the same code as
// an after-the-fact judgement on a merge. What is derived from the authority is
// exhaustiveness, never the strings — `report.test.mjs` asserts that every code
// `check` can answer about a pull request's review state is mapped here, so a
// new code cannot reach this consumer's `undocumented exit code` fallback the
// way `13` did in #1394. Add a new code to `review-exit-codes.mjs`; the suite
// will then require a line here.
/** @type {Record<number, string>} */
export const CHECK_MEANINGS = {
  0: "approved at head, waiting to merge",
  1: "usage error calling review.mjs check",
  4: "stale review:approved label left in place (rerun with --strip-stale)",
  5: "no approve verdict at head",
  6: "the approve at head came from the branch author",
  7: "branch author unidentifiable; independence cannot be established",
  8: "hand-recorded verdict at head this script cannot read",
  // #244: no verdict recorded at this exact head, but the branch's own
  // contribution to the integration branch is provably unchanged since an
  // earlier verdict — the push only merged the integration branch in. `10`
  // is mergeable, the same as `0`; a survey should report it as waiting to
  // merge, not as "revised, awaiting re-review". `11` is the same proof for
  // a request-changes verdict: not mergeable, but distinct from `5` because
  // the feedback was seen and never addressed, which is exactly the signal
  // this classification exists to preserve — see docs/AGENT_LOOP.md,
  // "Carried verdicts".
  10: "approved at an earlier head; carries forward, waiting to merge",
  11: "request-changes carries forward from an earlier head; unaddressed, not unreviewed",
  // #928, added by #1394 alongside the same omission in
  // `audit-merge-review.mjs`'s `CHECK_CLASSIFICATIONS`. Mergeable, exactly like
  // `0` — `merger.md`'s table says "Merge exactly like `0`" — so a survey must
  // not report it as an unknown state. It says so rather than reading as a
  // plain `0` because an orchestrator deciding whether to dispatch a merger
  // wants to know the approve overrode a dissent on the record.
  13: "approved at head over an explicitly superseded dissent; mergeable, waiting to merge",
};

/**
 * @typedef {{ number: number, headRefName: string, code: number | null, meaning: string, output: string }} PullRequestCheck
 */

/**
 * @typedef {(
 *   | { known: true, results: PullRequestCheck[] }
 *   | { known: false, reason: string, skipped?: boolean }
 * )} PullRequestSummary
 */

/**
 * Runs `review.mjs check` for every open pull request and summarizes its exit
 * code. `checkPullRequest` is injected so tests never shell out, and a run this
 * command could not launch or interpret reports `code: null` rather than being
 * folded into any documented meaning.
 *
 * @param {{
 *   prs: Lookup<{ number: number, headRefName: string }>,
 *   checkPullRequest: (pr: number) => { code: number | null, output: string },
 * }} input
 * @returns {PullRequestSummary}
 */
export const summarizePullRequests = ({ prs, checkPullRequest }) => {
  if (!prs.ok) {
    return { known: false, reason: prs.reason };
  }

  const results = prs.items.map((pull) => {
    const { code, output } = checkPullRequest(pull.number);
    return {
      number: pull.number,
      headRefName: pull.headRefName,
      code,
      meaning:
        code === null
          ? "review.mjs check could not be run"
          : (CHECK_MEANINGS[code] ?? `undocumented exit code ${code}`),
      output,
    };
  });

  return { known: true, results };
};

/**
 * @typedef {import("./lease.mjs").SummarizedLease} SummarizedLease
 */

/**
 * @typedef {(
 *   | { known: true, items: SummarizedLease[] }
 *   | { known: false, reason: string }
 * )} LeaseSummary
 */

/**
 * Every reason a lease could not be read, phrased for the `unknowns` list.
 *
 * A lease the report could not interpret is not a free target and is not a
 * disagreement either — it is a source that could not be established, which is
 * the third state this command has always kept. The orchestrator's rule for it
 * is the same as for every other `unknown`: say so in the round's reasoning
 * rather than recommending through it.
 *
 * @param {LeaseSummary} summary
 */
export const leaseUnknowns = (summary) =>
  summary.known
    ? summary.items.flatMap((item) =>
        item.state.kind === "unknown" ? [item.state.reason] : [],
      )
    : [`session leases could not be listed: ${summary.reason}`];

/**
 * The session-lease section: what has already been dispatched, per open pull
 * request and per targetless role.
 *
 * This is what closes #494's interval. A pull request needing a reviewer and a
 * pull request already covered by a live reviewer lease look identical in every
 * other section of this report — the verdict has not landed yet in either case —
 * so a second orchestrator surveying the same board recommends the same session
 * again unless it can read this.
 *
 * @param {{ leases: LeaseSummary, prs: Lookup<{ number: number, headRefName: string }> }} input
 */
export const formatLeases = ({ leases, prs }) => {
  /** @type {string[]} */
  const lines = [];

  if (!leases.known) {
    lines.push(`Unknown: ${leases.reason}`);
    lines.push("");
    lines.push(
      "Not a clear namespace. Treat every target below as unknown rather than free.",
    );
    return lines;
  }

  if (leases.items.length === 0) {
    lines.push("No session leases exist; nothing has been dispatched.");
  } else {
    for (const item of leases.items) {
      lines.push(
        `- ${item.refPath}: ${
          item.state.kind === "unknown"
            ? `unknown — ${item.state.reason}`
            : `${item.state.kind} — ${item.state.detail}`
        }`,
      );
    }
  }

  lines.push("");
  lines.push("### Live coverage per open pull request");
  lines.push("");

  if (!prs.ok) {
    lines.push(`Unknown: ${prs.reason}`);
    return lines;
  }

  if (prs.items.length === 0) {
    lines.push("No open pull requests.");
    return lines;
  }

  for (const pull of prs.items) {
    // `coverage` is the same function the orchestrator's condition reads, so
    // this line and that decision cannot drift apart. It reports `covered` only
    // for a live lease at the current head, `free` for absent or stale, and
    // `unknown` for a lease that exists but could not be read — including an
    // unreadable one, which is matched by ref name rather than dropped. An
    // unreadable lease reported as `free` would be exactly the fold this
    // command refuses everywhere else.
    const covered = PULL_REQUEST_ROLES.map((role) => {
      const state = coverage({ summary: leases, pr: String(pull.number), role });
      return `${role}=${state.kind}`;
    });

    lines.push(`- #${pull.number} (${pull.headRefName}): ${covered.join(", ")}`);
  }

  return lines;
};

const USAGE = "Usage: report.mjs [--skip-pr-checks] [--json]";

/**
 * `--json` prints the same survey as a machine-readable object instead of
 * prose, so `janitor-pass.mjs` can act on the classifications rather than
 * re-deriving them by parsing the prose back out. It changes the output format
 * only: the same sources are read, the same classifications made, and the same
 * exit code returned, so it stays as read-only as the prose form.
 *
 * @param {string[]} argv
 */
export const parseArgs = (argv) => {
  const skipPrChecks = argv.includes("--skip-pr-checks");
  const json = argv.includes("--json");
  const unknown = argv.filter(
    (value) => value !== "--skip-pr-checks" && value !== "--json",
  );
  return { skipPrChecks, json, ok: unknown.length === 0 };
};

/** @param {Disagreement[]} disagreements */
const groupByKind = (disagreements) => {
  /** @type {Map<DisagreementKind, Disagreement[]>} */
  const groups = new Map();
  for (const item of disagreements) {
    const list = groups.get(item.kind) ?? [];
    list.push(item);
    groups.set(item.kind, list);
  }
  return groups;
};

const KIND_TITLES = {
  unclaimable: "Unclaimable reservations (ref with no status:claimed issue)",
  unprotected: "Unprotected claims (status:claimed with no reservation ref)",
  stranded:
    "Stranded claimable issues (no hold label, with a live reservation)",
  unclaimedWithOpenPr:
    "Unclaimed work in flight (claimable, an open pull request, no reservation ref, no claim comment)",
  unreservedWithOpenPr:
    "Unreserved work in flight, benign (claimable, an open pull request, no reservation ref, claim comment intact)",
  janitorCandidate:
    "Janitor candidates (claim past staleClaimHours, no open pull request, no local evidence of a live session — liveness is not established here; release-claim.mjs decides)",
  assigneeDrift: "Assignee drift (status vs. assignee disagree)",
  needsFixer: "Needs a fixer (request-changes verdict, no push since)",
  closedWithStatusLabel:
    "Closed issues with a stale status:* label (closed without clearing it)",
  wouldFailRecord:
    "Unreviewable pull requests (review.mjs record would refuse the verdict — do not spend a review pass before fixing the body)",
  blockedWithClearedDependencies:
    "Blocked behind a dependency that has already cleared",
  holdWithoutReason:
    "Held with nothing recorded to act on",
};

/**
 * Composes the full text report from every section already computed. Kept
 * separate from `report` so the text shape can be asserted in isolation.
 *
 * @param {{
 *   disagreements: Disagreement[],
 *   unknowns: string[],
 *   refByIssue: Map<string, { ref: string, sha: string | null }>,
 *   claimedByIssue: Map<string, LabeledIssue>,
 *   poolByIssue?: Map<string, LabeledIssue> | null,
 *   prSummary: PullRequestSummary,
 *   leases: LeaseSummary,
 *   prs: Lookup<{ number: number, headRefName: string }>,
 *   localWorkHeld?: { issue: string, detail: string }[],
 *   claimsInFlight?: { issue: string, detail: string }[],
 * }} input
 */
export const formatReport = ({
  disagreements,
  unknowns,
  refByIssue,
  claimedByIssue,
  poolByIssue = null,
  prSummary,
  leases,
  prs,
  localWorkHeld = [],
  claimsInFlight = [],
}) => {
  /** @type {string[]} */
  const lines = [];

  lines.push("## Coordination state");
  lines.push("");
  if (refByIssue.size === 0 && claimedByIssue.size === 0) {
    lines.push("No reservation refs and no status:claimed issues.");
  } else {
    const issues = new Set([...refByIssue.keys(), ...claimedByIssue.keys()]);
    for (const issueNumber of [...issues].sort((a, b) => Number(a) - Number(b))) {
      const ref = refByIssue.get(issueNumber);
      const issue = claimedByIssue.get(issueNumber);
      const claim = issue ? lastClaimComment(issue.comments) : null;
      const assignees = issue
        ? issue.assignees.map((a) => a.login).filter(Boolean).join(", ") || "none"
        : "n/a";
      lines.push(
        `- #${issueNumber}: ref=${ref ? `${ref.ref}@${ref.sha ?? "?"}` : "none"}, ` +
          `status:claimed=${issue ? "yes" : "no"}, assignee=${assignees}, ` +
          `claim=${claim ? `${claim.agent} (${claim.fingerprint ?? "no fingerprint"})` : "none"}`,
      );
    }
  }

  lines.push("");
  lines.push("## Disagreements");
  lines.push("");
  if (disagreements.length === 0) {
    lines.push("None found.");
  } else {
    const groups = groupByKind(disagreements);
    for (const [kind, items] of groups) {
      lines.push(`### ${KIND_TITLES[kind] ?? kind}`);
      for (const item of items) lines.push(`- ${item.detail}`);
      lines.push("");
    }
  }

  lines.push("## Claims in flight (confirmed live by a direct read)");
  lines.push("");
  if (claimsInFlight.length === 0) {
    lines.push(
      "None. Every reservation with no `status:claimed` issue behind it in the " +
        "listing was confirmed against a direct read, or the confirming read " +
        'itself failed and is named under "Unreadable sources".',
    );
  } else {
    lines.push(
      "The issue listing is search-backed and lags; these were re-read " +
        "directly and carry `status:claimed` right now. Nothing is owed on " +
        "them and no janitor command applies:",
    );
    for (const item of claimsInFlight) lines.push(`- ${item.detail}`);
  }

  lines.push("");
  lines.push("## Live local work (held out of the janitor candidates)");
  lines.push("");
  if (localWorkHeld.length === 0) {
    lines.push(
      "None on this machine. This section only ever sees the host this ran on \u2014 " +
        "a session holding unpushed commits elsewhere is invisible here.",
    );
  } else {
    lines.push(
      "Past `staleClaimHours` with no open pull request, but provably alive: " +
        "do not release these.",
    );
    for (const item of localWorkHeld) lines.push(`- ${item.detail}`);
  }

  lines.push("");
  lines.push("## Unreadable sources");
  lines.push("");
  lines.push(
    unknowns.length === 0
      ? "None. Every source above was established, not assumed."
      : "Reported as unknown, never as absent:",
  );
  for (const reason of unknowns) lines.push(`- ${reason}`);

  // The claimable pool, printed rather than left for the reader to re-derive.
  //
  // `readyBacklog` and its min/max range went with `status:ready`, and
  // the first draft of that change printed nothing in their place — which sent
  // `orchestrator.md` to a hand-run `gh` query for the number it sizes worker
  // rounds from. A hand query is a second implementation of the pool rule, and
  // it can disagree with `claim.mjs`; re-deriving by hand is precisely the
  // drift `lib/claimable.mjs` exists to remove. No range is applied — how many
  // sessions the queue can absorb is a judgement `maxOpenPullRequests` bounds,
  // not a property of the backlog's depth.
  lines.push("");
  lines.push("## Claimable pool");
  lines.push("");

  if (poolByIssue === null) {
    lines.push(
      "Unknown: the open-issue listing could not be established this run, so " +
        "the pool could not be counted. It is not reported as zero.",
    );
  } else {
    const assigned = [...poolByIssue.values()].filter(
      (issue) => issue.assignees.length > 0,
    ).length;
    const offerable = poolByIssue.size - assigned;

    lines.push(
      `${offerable} issue(s) carry no hold label and no assignee, so \`claim.mjs\` can offer them.` +
        (assigned > 0
          ? ` A further ${assigned} carry no hold label but are still assigned, and are reported above as \`assigneeDrift\` — they read as claimable on the board and are offered to nobody.`
          : ""),
    );
  }

  lines.push("");
  lines.push("## Open pull requests (review.mjs check)");
  lines.push("");
  if (!prSummary.known) {
    lines.push(
      prSummary.skipped
        ? "Skipped (--skip-pr-checks)."
        : `Unknown: ${prSummary.reason}`,
    );
  } else if (prSummary.results.length === 0) {
    lines.push("No open pull requests.");
  } else {
    for (const result of prSummary.results) {
      lines.push(
        `- #${result.number} (${result.headRefName}): exit ${result.code ?? "?"} — ${result.meaning}`,
      );
    }
  }

  lines.push("");
  lines.push("## Session leases (already dispatched)");
  lines.push("");
  lines.push(...formatLeases({ leases, prs }));

  return lines.join("\n");
};

/**
 * @param {{
 *   argv?: string[],
 *   config: {
 *     labels: {
 *       claimed: string,
 *       blocked?: string,
 *       changesRequested?: string,
 *       deferred?: string,
 *     },
 *     branchPrefix: string,
 *     claimRefPrefix: string,
 *     sessionRefPrefix: string,
 *     staleClaimHours: number,
 *     integrationBranch?: string | null,
 *     promotionBranch?: string | null,
 *   },
 *   gh: (...args: string[]) => string,
 *   git?: ((args: string[], options?: { cwd?: string }) => string) | null,
 *   checkPullRequest: (pr: number) => { code: number | null, output: string },
 *   stdout?: (line: string) => void,
 *   stderr?: (line: string) => void,
 *   now?: () => number,
 * }} input
 * @returns {number} Process exit code.
 */
export const report = ({
  argv = [],
  config,
  gh,
  git = null,
  checkPullRequest,
  stdout = console.log,
  stderr = console.error,
  now = () => Date.now(),
}) => {
  const args = parseArgs(argv);

  if (!args.ok) {
    stderr(USAGE);
    return EXIT.usage;
  }

  const repository = JSON.parse(gh("repo", "view", "--json", "nameWithOwner"))
    .nameWithOwner;

  // One instant for the whole survey. A report is a snapshot, and two sections
  // aged against two different clock reads would be two snapshots.
  const at = now();

  const refs = listReservationRefs(gh, repository, config.claimRefPrefix);
  const claimed = listIssuesByLabel(gh, config.labels.claimed);
  const openIssues = listOpenIssues(gh);
  const prs = openPullRequests(gh);
  const closedStatus = listClosedIssuesWithStatusLabels(
    gh,
    statusLabelNames(config),
  );
  const assignedOpen = listAssignedOpenIssues(gh);
  const blocked = config.labels.blocked
    ? listBlockedIssues(gh, config.labels.blocked)
    : null;

  // Fetching reviews is a per-PR network call, the same cost `checkPullRequest`
  // already pays below, so it is skipped by the same flag.
  const reviewsByPr = args.skipPrChecks
    ? null
    : new Map(
        prs.ok
          ? prs.items.map((pull) => [
              pull.number,
              pullRequestReviews(gh, repository, pull.number),
            ])
          : [],
      );

  // One `matching-refs` call establishes the whole session namespace; the
  // per-lease commit reads behind it resolve each lease's dispatch time and
  // head, and are bounded by the number of sessions actually in flight. This
  // stays inside the read-only contract: nothing here creates, updates, or
  // deletes a ref.
  const leases = summarizeLeases({
    leases: readLeases(gh, repository, config.sessionRefPrefix),
    prs,
    now: at,
    staleClaimHours: config.staleClaimHours,
  });

  // Read lazily, per issue, and only for the claims that reach the staleness
  // question at all \u2014 `git worktree list` plus a couple of `rev-list` calls per
  // worktree is cheap, but running it over every claimed issue would not be.
  // Absent `git` (a caller that injected none) the classification says so in
  // its own wording rather than pretending the check ran.
  const localWork = git
    ? /** @param {string} issue */ (issue) =>
        localIssueWork({
          git,
          issue,
          branchPrefix: config.branchPrefix,
          integrationBranch: config.integrationBranch ?? "main",
        })
    : null;

  const {
    disagreements,
    unknowns,
    refByIssue,
    claimedByIssue,
    poolByIssue,
    claimCandidates,
    localWorkHeld,
    claimsInFlight,
  } = classify({
    config,
    now: at,
    refs,
    claimed,
    openIssues,
    prs,
    reviewsByPr,
    closedStatus,
    assignedOpen,
    localWork,
    // Strongly consistent, and called only for an issue the listings have
    // already put under suspicion — one call per disagreement, not per issue
    //.
    confirmIssue: /** @param {string} issue */ (issue) => viewIssue(gh, issue),
    blocked,
    blockerState: /** @param {string[]} blockers */ (blockers) =>
      readBlockerStates({ gh, blockers }),
  });
  /** @type {PullRequestSummary} */
  const prSummary = args.skipPrChecks
    ? { known: false, skipped: true, reason: "skipped via --skip-pr-checks" }
    : summarizePullRequests({ prs, checkPullRequest });

  const allUnknowns = [...unknowns, ...leaseUnknowns(leases)];

  stdout(
    args.json
      ? JSON.stringify(
          {
            disagreements,
            claimCandidates,
            localWorkHeld,
            claimsInFlight,
            unknowns: allUnknowns,
            claimablePool: openIssues.ok
              ? [...poolByIssue.values()].filter(
                  (issue) => issue.assignees.length === 0,
                ).length
              : null,
            // `refName` is the one field both halves of a `ResolvedLease`
            // carry; an unreadable lease has no agent to report, and saying so
            // is the point rather than a gap to fill in.
            leases: leases.known
              ? leases.items.map((lease) => ({
                  ref: lease.refName,
                  agent: lease.readable ? lease.agent : null,
                  state: lease.state.kind,
                }))
              : { known: false, reason: leases.reason },
          },
          null,
          2,
        )
      : formatReport({
          disagreements,
          unknowns: allUnknowns,
          refByIssue,
          claimedByIssue,
          poolByIssue: openIssues.ok ? poolByIssue : null,
          prSummary,
          leases,
          prs,
          localWorkHeld,
          claimsInFlight,
        }),
  );

  if (disagreements.length > 0) return EXIT.disagreements;
  if (allUnknowns.length > 0) return EXIT.unknown;
  return EXIT.ok;
};

export default report;
