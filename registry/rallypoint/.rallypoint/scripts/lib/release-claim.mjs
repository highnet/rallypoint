// Releasing a stale claim, with every call to `gh` injected.
//
// This is the janitor's half of the claim protocol, and it runs in the opposite
// order from `lib/claim.mjs`'s rollback. That is deliberate, and the difference
// is the whole reason this module exists.
//
// It has a second caller: the holder of a claim releasing its own
// reservation, e.g. a worker standing down onto `status:blocked` because the
// work turned out to need an operator decision. `assessForRelease` is where
// that path splits off — when the claim comment's recorded agent id matches
// the caller's `--agent-id`, the `staleClaimHours` guess about whether a
// session is still running is skipped entirely, because the caller *is* that
// session and has just said it is not. A different agent id — the janitor's
// usual case — gets every check below unchanged.
//
// `claim.mjs` compensates a *partial* claim: the reservation exists and the
// issue may already read `status:claimed`, so it restores the issue first and
// releases the reservation last. A janitor undoes a *complete* claim, so the
// safe order is the inverse:
//
// | Order                     | If the second step fails      | Recoverable? |
// | ------------------------- | ----------------------------- | ------------ |
// | Delete ref -> flip labels | claimed, assigned, no ref     | Yes          |
// | Flip labels -> delete ref | ready, unassigned, ref live   | No           |
//
// The second row is unrecoverable because `lib/claim.mjs` reads a failed ref
// creation as "another session holds it" and skips the issue without touching
// it — including under an explicit `--issue <N>` — while the absent
// `status:claimed` label hides the issue from the next janitor pass too. So the
// reservation goes first, and a reservation that cannot be confirmed gone
// aborts before a single issue field is touched.
//
// Clearing the assignee is not cosmetic either: `lib/claim.mjs` filters out
// every assigned issue, so a release that clears `status:claimed` and leaves the
// issue assigned is a silent no-op.
//
// ## The invariant this module keeps failing, and what to check first
//
// Every piece of evidence here must answer *whose session is this about* before
// it is used. Four defects have shipped from this file, and all four are the
// same mistake: something true about one session read as true about another, or
// this session's own evidence thrown away with it.
//
// | # | The evidence            | Wrongly concluded                     |
// | - | ----------------------- | ------------------------------------- |
// | 1 | A merged branch's final push | a live session            |
// | 2 | An earlier session's settled pull request | a claim minutes old was dead |
// | 3 | A live push, dropped with its stale settle | released under an active worker |
// | 4 | A push predating the claim | the claiming session had ended |
// | 5 | Nothing on the remote at all | no session was running        |
//
// Row 5 is the one that is not about attribution but about *reach*: every
// signal above is read from GitHub, and a worker here commits locally and
// pushes late, so none of them can see a live session at all until it pushes.
// `lib/local-work.mjs` supplies the missing evidence and states plainly which
// machine it binds on.
//
// Two timestamps decide it, and both comparisons are here for that reason: a
// branch commit is this session's only if it postdates `claimedAt`, and a
// settled pull request concerns this claim only if it also postdates it. Every
// tie resolves to "not evidence", because GitHub stamps to the second and the
// order inside one is unknowable — the same reading `wasReopenedAfterMerge` in
// `close-referenced-issues.mjs` takes of its own tie.
//
// A change here that adds a signal should say, in the diff, which session that
// signal belongs to. If it cannot, it is not evidence.

import { CLAIM, SAFE_AGENT_ID, branchIssue, linkedIssues } from "../provenance.mjs";
import { describeLocalWork, localIssueWork } from "./local-work.mjs";

// Exit codes are a public interface, as they are for `review.mjs`. Keep them in
// sync with the table in docs/AGENT_LOOP.md.
export const EXIT = {
  ok: 0,
  usage: 1,
  notClaimed: 2, // closed, or neither a live claim nor a stale assignee exists
  active: 3, // proven live: an open pull request, a push inside the window, or unpushed local work here
  notStale: 4, // the claim itself is younger than `staleClaimHours`
  inconclusive: 5, // eligibility could not be established, so nothing was done
  refBlocked: 6, // the reservation was not confirmed gone; no issue mutation
  restoreFailed: 7, // reservation gone, issue restore failed; still reads claimed
};

const HOUR_MS = 3_600_000;
// Every automated claim is assigned through `@me`, so when several agent
// sessions share one GitHub account, every protocol-owned assignment carries
// that one login. `config.sharedIdentity` names it.
//
// An absent reservation proves only that *protocol-owned* assignment is stale;
// it says nothing about any additional human assignee. That is exactly why the
// login has to be known rather than assumed: without it, clearing "the stale
// assignee" would sooner or later clear a person's. So when the config does not
// name one, no assignee is ever treated as protocol-owned and this backstop
// declines instead of guessing.
/**
 * @param {{ sharedIdentity?: unknown }} config
 * @returns {string | null}
 */
const sharedProtocolLogin = (config) =>
  typeof config?.sharedIdentity === "string" && config.sharedIdentity.trim()
    ? config.sharedIdentity.trim()
    : null;

// The page size asked of every listing endpoint. A response that fills the page
// cannot prove absence — the pull request or branch that would have refused the
// release may simply be on the next page — so a full page is treated as an
// answer that could not be established rather than as an empty one.
const PAGE = 100;

/**
 * The first informative line of a `gh` failure. `execFileSync` puts the useful
 * part on `stderr` and leaves `message` as the command line.
 *
 * @param {unknown} error
 */
const describeError = (error) => {
  const detail = /** @type {{ stderr?: unknown, message?: unknown }} */ (
    error ?? {}
  );
  const text = String(detail.stderr ?? detail.message ?? error ?? "").trim();
  return (
    text
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line !== "")
      ?.slice(0, 200) ?? "no detail reported"
  );
};

/**
 * A lookup that distinguishes an established answer from one that could not be
 * established. Acceptance criterion 4 is exactly this distinction: an empty
 * array from a successful query is proof of absence, and everything else — an
 * error, a non-array body, a response that filled its page — is not.
 *
 * @template T
 * @typedef {{ ok: true, items: T[] } | { ok: false, reason: string }} Lookup
 */

/**
 * @param {() => string} query
 * @param {string} subject
 * @param {number} [page] Page size the query asked for, so truncation is judged
 *   against the limit actually used rather than this module's default.
 * @returns {Lookup<any>}
 */
export const listing = (query, subject, page = PAGE) => {
  let parsed;

  try {
    parsed = JSON.parse(query());
  } catch (error) {
    return { ok: false, reason: `${subject} could not be listed (${describeError(error)})` };
  }

  if (!Array.isArray(parsed)) {
    return { ok: false, reason: `the ${subject} listing was not a JSON array` };
  }

  if (parsed.length >= page) {
    return {
      ok: false,
      reason: `the ${subject} listing filled its page of ${page}, so it may be truncated`,
    };
  }

  return { ok: true, items: parsed };
};

/**
 * Refs whose name starts with `prefix`.
 *
 * A 403 on a ref *delete* says nothing about whether the ref exists — a
 * branch-scoped credential answers 403 either way, and reading one as proof of
 * existence is how stale warnings get written. Existence is established
 * by listing, never inferred from a mutation's failure.
 *
 * @param {(...args: string[]) => string} gh
 * @param {string} repository
 * @param {string} prefix
 * @returns {Lookup<{ ref?: string, object?: { sha?: string } }>}
 */
export const matchingRefs = (gh, repository, prefix) =>
  listing(
    () =>
      gh(
        "api",
        `repos/${repository}/git/matching-refs/heads/${prefix}?per_page=${PAGE}`,
      ),
    `refs under \`${prefix}\``,
  );

/**
 * @param {(...args: string[]) => string} gh
 * @param {string} repository
 * @param {string} refName Reservation ref without the `refs/heads/` prefix.
 * @returns {{ kind: "present" | "absent" } | { kind: "unknown", reason: string }}
 */
export const reservationPresence = (gh, repository, refName) => {
  const refs = matchingRefs(gh, repository, refName);

  if (!refs.ok) return { kind: "unknown", reason: refs.reason };

  // `matching-refs` matches on prefix: asking for `…/issue-2` also returns
  // `…/issue-26` and `…/issue-214`. Only an exact hit is this issue's
  // reservation, and taking a prefix neighbour for one would abort a release
  // that should have proceeded — or, worse, report a reservation deleted.
  return {
    kind: refs.items.some((ref) => ref.ref === `refs/heads/${refName}`)
      ? "present"
      : "absent",
  };
};

/**
 * The last commit time of every issue branch for this issue.
 *
 * @param {(...args: string[]) => string} gh
 * @param {string} repository
 * @param {{ branchPrefix: string }} config
 * @param {string} issue
 * @returns {Lookup<{ name: string, committedAt: string }>}
 */
export const issueBranches = (gh, repository, config, issue) => {
  const refs = matchingRefs(gh, repository, `${config.branchPrefix}${issue}-`);

  if (!refs.ok) return refs;

  /** @type {{ name: string, committedAt: string }[]} */
  const items = [];

  for (const ref of refs.items) {
    const name = String(ref.ref ?? "").replace(/^refs\/heads\//, "");

    // The trailing hyphen in the prefix already excludes `agent/2360-…` from a
    // query for issue 236, but the branch parser is the authority on which
    // issue a branch name claims, so ask it rather than trusting the prefix.
    if (branchIssue(name, config.branchPrefix) !== issue) continue;

    let commit;

    try {
      commit = JSON.parse(
        gh("api", `repos/${repository}/commits/${ref.object?.sha ?? ""}`),
      );
    } catch (error) {
      return {
        ok: false,
        reason: `the last commit on \`${name}\` could not be read (${describeError(error)})`,
      };
    }

    const committedAt =
      commit?.commit?.committer?.date ?? commit?.commit?.author?.date;

    if (typeof committedAt !== "string") {
      return {
        ok: false,
        reason: `the last commit on \`${name}\` reported no timestamp`,
      };
    }

    items.push({ name, committedAt });
  }

  return { ok: true, items };
};

/**
 * `author` is requested for `report.mjs`'s `wouldFailRecord` classification
 *, which has to tell a pull request with no resolvable authoring issue
 * apart from one that legitimately has none — a Dependabot pull request, which
 * `isDependabotAuthor` in `provenance.mjs` recognises by authorship rather than
 * by branch name. Every other caller ignores the field.
 *
 * @param {(...args: string[]) => string} gh
 * @returns {Lookup<{ number: number, headRefName: string, headRefOid: string, body: string | null, updatedAt: string, author?: unknown }>}
 */
export const openPullRequests = (gh) =>
  listing(
    () =>
      gh(
        "pr",
        "list",
        "--state",
        "open",
        "--limit",
        String(PAGE),
        "--json",
        "number,headRefName,headRefOid,body,updatedAt,author",
      ),
    "open pull requests",
  );

/**
 * Whether each issue branch still has a pull request in flight.
 *
 * `issueBranches` above answers "when did this branch last move", which is the
 * wrong question on its own: the final push of a branch whose pull request has
 * since merged is the *most* recent commit a dead session ever makes, so read
 * alone it makes an ended session look maximally alive. This answers the
 * question that disambiguates it.
 *
 * Three outcomes, and only one of them ends the session:
 *
 * - `settled` — every pull request for the branch is merged or closed. The
 *   session that pushed is over, whatever the commit clock says.
 * - `open` — a pull request is still open. Handled earlier by the open-pull-
 *   request check, and never released regardless of branch age.
 * - `none` — no pull request exists yet. A worker that has pushed but not yet
 *   opened one is mid-flight, so its push still proves life.
 *
 * `settledAt` is the newest merge or close among them, and the caller must
 * compare it against the branch's last commit rather than trusting `settled`
 * alone. `gh pr list --head` matches by branch *name* across all time, and
 * `claim.mjs` derives `agent/<issue>-<slug>` deterministically, so a re-claimed
 * issue reuses the name its previous session used. Without the comparison, a
 * new live session that has pushed but not yet opened its pull request reads as
 * `settled` off the *previous* session's merged one and gets released out from
 * under itself — the collision the reservation exists to prevent. The
 * `Refs`-not-`Closes` fix in `close-referenced-issues.mjs` deliberately grows
 * that population, since those issues stay open to be re-claimed with a merged
 * pull request already on their branch name.
 *
 * @param {(...args: string[]) => string} gh
 * @param {{ name: string }[]} branches
 * @returns {Lookup<{ name: string, state: "settled" | "open" | "none", settledAt: string | null, pullRequests: number[] }>}
 */
export const branchPullRequests = (gh, branches) => {
  /** @type {{ name: string, state: "settled" | "open" | "none", settledAt: string | null, pullRequests: number[] }[]} */
  const items = [];

  for (const { name } of branches) {
    const found = listing(
      () =>
        gh(
          "pr",
          "list",
          "--head",
          name,
          "--state",
          "all",
          "--limit",
          String(PAGE),
          "--json",
          "number,state,mergedAt,closedAt",
        ),
      `pull requests for \`${name}\``,
    );

    if (!found.ok) return found;

    // An unrecognised state is not a settled one. Only `MERGED` and `CLOSED`
    // end a session, and reading anything else as settled would release a
    // claim on a pull request that is still in flight. A draft reports `OPEN`,
    // so it lands here correctly.
    const settled = found.items.every(
      (pull) => pull.state === "MERGED" || pull.state === "CLOSED",
    );

    const stamps = found.items.flatMap((pull) => {
      const at = Date.parse(String(pull.mergedAt ?? pull.closedAt ?? ""));
      return Number.isNaN(at) ? [] : [at];
    });

    // A settled pull request whose own settle time could not be read is not
    // usable evidence: the comparison the caller has to make needs a timestamp,
    // and an absent one is an answer that was not established.
    if (settled && found.items.length > 0 && stamps.length !== found.items.length) {
      return {
        ok: false,
        reason: `a pull request for \`${name}\` reported no merge or close timestamp`,
      };
    }

    items.push({
      name,
      state: found.items.length === 0 ? "none" : settled ? "settled" : "open",
      settledAt:
        settled && stamps.length > 0
          ? new Date(Math.max(...stamps)).toISOString()
          : null,
      pullRequests: found.items.map((pull) => Number(pull.number)),
    });
  }

  return { ok: true, items };
};

/**
 * The pair of branch lookups `assess` reads, gathered in one place because the
 * second is derived from the first and both callers must ask them the same way.
 * A branch listing that could not be established carries straight through, so
 * the derived lookup never reports an absence the first one could not prove.
 *
 * @param {(...args: string[]) => string} gh
 * @param {string} repository
 * @param {{ branchPrefix: string }} config
 * @param {string} issue
 */
export const branchEvidence = (gh, repository, config, issue) => {
  const branches = issueBranches(gh, repository, config, issue);

  return {
    branches,
    branchPullRequestState: branches.ok
      ? branchPullRequests(gh, branches.items)
      : branches,
  };
};

/**
 * The last Rallypoint claim comment on an issue. Last wins, matching
 * `provenance.claimant`: a released issue can be claimed again, and the newest
 * claim is the one whose age decides staleness.
 *
 * @param {{ body?: string | null, createdAt?: string }[] | undefined} comments
 * @returns {{ agent: string, createdAt: string } | null}
 */
export const lastClaim = (comments) =>
  (comments ?? [])
    .flatMap((comment) => {
      const agent = (comment.body ?? "").match(CLAIM)?.at(1);
      return agent && typeof comment.createdAt === "string"
        ? [{ agent, createdAt: comment.createdAt }]
        : [];
    })
    .at(-1) ?? null;

/**
 * Whether `agentId` is releasing the reservation it itself holds.
 *
 * The `staleClaimHours` gate exists to stop a janitor from reclaiming work out
 * from under a session that is still running — a *guess*, aged off a comment
 * timestamp, standing in for evidence nobody else can get any other way. That
 * reasoning has nothing to say about the holder releasing its own claim: the
 * holder is the one authority on whether its own session is still working, and
 * saying so by calling this command with its own `--agent-id` is stronger
 * evidence than any of the proxies `assess` gathers. This is the only thing
 * that establishes "own" — the claim comment's recorded agent id matching the
 * caller's, nothing inferred.
 *
 * A `null` claim (no readable claim comment) never counts as self-release: the
 * holder must be established, not assumed, same as every other path through
 * this module.
 *
 * @param {{ agent: string, createdAt: string } | null} claim
 * @param {string} agentId
 * @returns {claim is { agent: string, createdAt: string }}
 */
export const isSelfRelease = (claim, agentId) =>
  claim !== null && claim.agent === agentId;

/**
 * @typedef {(
 *   | { kind: "stale", claim: { agent: string, createdAt: string }, evidence: string[] }
 *   | { kind: "active", reason: string }
 *   | { kind: "notStale", reason: string }
 *   | { kind: "unknown", reason: string }
 * )} Assessment
 */

/**
 * Whether a claim may be released, decided only from evidence that was
 * positively established. Every path that could not establish something
 * resolves to `unknown`, which refuses the release.
 *
 * @param {{
 *   issue: string,
 *   now: number,
 *   staleClaimHours: number,
 *   branchPrefix: string,
 *   claim: { agent: string, createdAt: string } | null,
 *   pullRequests: Lookup<{ number: number, headRefName: string, body: string | null, updatedAt: string }>,
 *   branches: Lookup<{ name: string, committedAt: string }>,
 *   branchPullRequestState: Lookup<{ name: string, state: "settled" | "open" | "none", settledAt: string | null, pullRequests: number[] }>,
 *   localWork: Lookup<import("./local-work.mjs").LocalWork>,
 * }} input
 * @returns {Assessment}
 */
export const assess = ({
  issue,
  now,
  staleClaimHours,
  branchPrefix,
  claim,
  pullRequests,
  branches,
  branchPullRequestState,
  localWork,
}) => {
  if (!claim) {
    return {
      kind: "unknown",
      reason: `#${issue} carries no Rallypoint claim comment, so the age of its claim cannot be established`,
    };
  }

  const claimedAt = Date.parse(claim.createdAt);

  if (Number.isNaN(claimedAt)) {
    return {
      kind: "unknown",
      reason: `the claim comment on #${issue} has an unreadable timestamp (${claim.createdAt})`,
    };
  }

  if (!pullRequests.ok) return { kind: "unknown", reason: pullRequests.reason };

  // Any open pull request naming the issue proves the work is live. Commit
  // recency is deliberately not consulted for one: a branch that has not moved
  // for days because it is waiting on a reviewer is the healthy case, and
  // GitHub bumps `updatedAt` for review comments and pushes alike, so a quiet
  // branch under an open pull request is awaiting review rather than abandoned.
  // Releasing it is the collision the reservation exists to prevent — it is
  // the collision this module has caused more than once.
  const live = pullRequests.items.filter(
    (pull) =>
      branchIssue(pull.headRefName, branchPrefix) === issue ||
      linkedIssues(pull.body).includes(issue),
  );

  if (live.length > 0) {
    const latest = live.map((pull) => pull.updatedAt).sort().at(-1);
    return {
      kind: "active",
      reason: `open pull request ${live.map((pull) => `#${pull.number}`).join(", ")} references #${issue} (last activity ${latest}); an open pull request awaiting review is not idle`,
    };
  }

  // Local, unpushed work outranks every remote signal below it, including the
  // settled-pull-request proof that a session ended. A worktree
  // holding commits the remote does not have is not a guess about liveness: the
  // commits are there, they exist nowhere else, and whether the session that
  // wrote them is still breathing does not change what releasing the claim
  // would cost. Janitor candidates are found in exactly this state routinely.
  //
  // Checked after the open-pull-request rule purely so the more informative
  // reason wins when both apply, and before the branch loop so it cannot be
  // overtaken by a settled pull request on a reused branch name.
  if (!localWork.ok) return { kind: "unknown", reason: localWork.reason };

  if (localWork.items.length > 0) {
    return {
      kind: "active",
      reason: `unpushed local work for #${issue} is on this machine: ${describeLocalWork(localWork.items, issue)}`,
    };
  }

  if (!branches.ok) return { kind: "unknown", reason: branches.reason };

  const threshold = now - staleClaimHours * HOUR_MS;

  /** @type {string[]} */
  const settledEvidence = [];
  /** @type {Set<string>} */
  const settledBranches = new Set();
  // Branches in the window whose last commit predates the claim: not this
  // session's work, so neither evidence that it ended nor proof it is running.
  /** @type {Set<string>} */
  const notThisSession = new Set();

  for (const branch of branches.items) {
    const committedAt = Date.parse(branch.committedAt);

    if (Number.isNaN(committedAt)) {
      return {
        kind: "unknown",
        reason: `the last commit on \`${branch.name}\` has an unreadable timestamp (${branch.committedAt})`,
      };
    }

    if (committedAt <= threshold) continue;

    // A push inside the window is only proof of life while the branch still
    // has a pull request in flight. Once every pull request for it has merged
    // or closed, that push is the last thing an ended session did, not a sign
    // of a running one — an issue can sit in that state with the proof asserted
    // minutes after the merge that ended the session.
    if (!branchPullRequestState.ok) {
      return { kind: "unknown", reason: branchPullRequestState.reason };
    }

    const state = branchPullRequestState.items.find(
      (candidate) => candidate.name === branch.name,
    );

    if (state === undefined) {
      return {
        kind: "unknown",
        reason: `the pull request state of \`${branch.name}\` was not established`,
      };
    }

    if (state.state !== "settled") {
      return {
        kind: "active",
        reason: `\`${branch.name}\` was pushed at ${branch.committedAt}, inside the ${staleClaimHours}h window`,
      };
    }

    const settledAt = Date.parse(state.settledAt ?? "");

    if (Number.isNaN(settledAt)) {
      return {
        kind: "unknown",
        reason: `\`${branch.name}\` has no readable merge or close time, so it cannot be established whether its last push came before or after its pull request ended`,
      };
    }

    // The settle has to postdate the *claim* to say anything about it.
    //
    // Guarding the push alone is not enough, and this is the hole the second
    // review round found. `delete_branch_on_merge` is false on this repository,
    // so a merged session's branch outlives it; a re-claim reuses the name, and
    // for the first several minutes the new session has claimed but not yet
    // pushed. The surviving branch's last commit is then inside the window and
    // predates its own merge, so it would land in `settledEvidence` and — via
    // the `notStale` yield below — release a claim minutes old. That is the
    // same collision as above, reached through the population defect 2's own fix
    // creates: `Refs`-not-`Closes` issues that stay open and get re-claimed
    // with a merged pull request already on their deterministic branch name.
    //
    // An earlier session's pull request is simply not evidence about this
    // claim, so it is skipped rather than counted either way. Equal timestamps
    // skip too: GitHub stamps to the second and the order inside it is
    // unknowable, so the safe side of the tie is "not evidence", the same
    // reading `wasReopenedAfterMerge` takes of its own tie.
    // Not `continue`. Skipping the branch outright would discard its push as
    // well as its settle, and the push may be this session's own proof of life
    // — the third instance of one class of defect this code has produced:
    // evidence about one session attributed to, or withheld from, another. With
    // the settle discarded the ordinary rule applies again, and a commit inside
    // the window means someone is working.
    if (settledAt <= claimedAt) {
      return {
        kind: "active",
        reason: `\`${branch.name}\` was pushed at ${branch.committedAt}, inside the ${staleClaimHours}h window (its last pull request ended at ${state.settledAt}, before this claim, so it says nothing about this session)`,
      };
    }

    // The push has to predate the settle to have been part of that session.
    // A commit at or after it is a new session on a reused branch name, and
    // releasing on it would take the issue away from a worker actively pushing.
    if (committedAt >= settledAt) {
      return {
        kind: "active",
        reason: `\`${branch.name}\` was pushed at ${branch.committedAt}, at or after its last pull request ended at ${state.settledAt}, so a later session is working on it`,
      };
    }

    // The push must postdate the claim to be the claiming session's. `claim.mjs`
    // runs before the branch exists, so a commit older than the claim provably
    // belongs to someone else, and "that push ended the session" would be a
    // statement about a session that had not started yet.
    //
    // `continue` is safe here and cannot leak into a release on age alone. Being
    // in this loop body means `committedAt > threshold`; if `committedAt` is also
    // `<= claimedAt` then `claimedAt > threshold`, so the claim is younger than
    // `staleClaimHours` and the age check below returns `notStale`. A branch that
    // is in the window and older than the claim is arithmetically impossible when
    // the claim itself is outside it.
    //
    // Skipping rather than returning `active` is the honest verdict: the branch
    // says nothing either way, so the age threshold should be what decides, and
    // the refusal names the real reason.
    if (committedAt <= claimedAt) {
      notThisSession.add(branch.name);
      continue;
    }

    settledBranches.add(branch.name);
    settledEvidence.push(
      `\`${branch.name}\` was pushed at ${branch.committedAt}, inside the ${staleClaimHours}h window, but its pull request (${state.pullRequests.map((number) => `#${number}`).join(", ")}) ended at ${state.settledAt} with no commit after it, so that push ended the session rather than proving one is running.`,
    );
  }

  // The age threshold is a *guess* at whether a session is still running.
  // A settled pull request is positive proof that it is not, so it outranks
  // the guess: without this, a session that claims, pushes, merges, and ends
  // inside the window stays claimed for the remainder of it — which is exactly
  // the shape this rule exists for; fixing only the branch check above would
  // not have moved it, because such a claim is often well inside the threshold.
  if (claimedAt > threshold && settledEvidence.length === 0) {
    return {
      kind: "notStale",
      reason: `#${issue} was claimed by \`${claim.agent}\` at ${claim.createdAt}, less than ${staleClaimHours}h ago`,
    };
  }

  return {
    kind: "stale",
    claim,
    evidence: [
      settledEvidence.length > 0
        ? `Claimed by \`${claim.agent}\` at ${claim.createdAt}. The claim is not being released on age — it is released because the session that held it provably ended.`
        : `Claimed by \`${claim.agent}\` at ${claim.createdAt}, older than the ${staleClaimHours}h \`staleClaimHours\` threshold.`,
      ...settledEvidence,
      `No open pull request names #${issue} (${pullRequests.items.length} open pull request(s) read in full).`,
      // Stated even when it found nothing, because its reach is the thing a
      // reader has to weigh: it binds only on the machine this ran from, and a
      // session holding unpushed commits on another host is invisible to it.
      `No worktree on the machine this ran from holds unpushed work for #${issue}. This check does not reach any other host.`,
      // Only the branches the window actually cleared are described that way.
      // A branch released on settled-pull-request grounds is inside the window
      // by definition, and has already said so above; repeating it here as
      // "outside the window" would put two contradictory claims about the same
      // branch in one block of evidence a reviewer is meant to audit.
      ...(() => {
        const byAge = branches.items.filter(
          (branch) =>
            !settledBranches.has(branch.name) &&
            !notThisSession.has(branch.name),
        );

        // Described for what it is. These are inside the window, so calling
        // them "outside" would put two contradictory claims about one branch in
        // a block a reviewer is meant to audit — the same trap the settled
        // branches avoid just above.
        const foreign = [...notThisSession].map(
          (name) =>
            `\`${name}\` moved inside the window but before this claim was made, so it is not this session's work and proves nothing either way.`,
        );

        if (branches.items.length === 0) {
          return [`No issue branch \`${branchPrefix}${issue}-*\` exists.`];
        }

        return byAge.length === 0
          ? foreign
          : [
              byAge
                .map(
                  (branch) =>
                    `\`${branch.name}\` last moved at ${branch.committedAt}, outside the window.`,
                )
                .join(" "),
              ...foreign,
            ];
      })(),
    ],
  };
};

/**
 * `humanLabel` is set when the issue carries `needs:human`, in which case the
 * release does not return the issue to the claimable pool and the
 * comment has to say so — a reader auditing this comment would otherwise
 * reasonably conclude it is claimable again.
 *
 * Since the readiness label was removed, the release is purely subtractive: it removes `status:claimed`
 * and the assignee and adds nothing, because claimability is derived from the
 * absence of a hold label rather than declared by `status:ready`. So this is
 * now a statement about what the *remaining* labels mean, not about a
 * restoration that was withheld.
 *
 * @param {{
 *   agentId: string,
 *   issue: string,
 *   refPath: string,
 *   evidence: string[],
 *   reservation: "deleted" | "absent" | "planned",
 *   humanLabel?: string | null,
 * }} input
 */
export const explanation = ({
  agentId,
  issue,
  refPath,
  evidence,
  reservation,
  humanLabel = null,
}) =>
  [
    `Claim on #${issue} released by Rallypoint janitor \`${agentId}\`.`,
    "",
    ...(humanLabel
      ? [
          `#${issue} carries \`${humanLabel}\`, so it does **not** return to the` +
            " claimable pool: the reservation is released and the claim label" +
            " and assignee cleared, but that label holds it out until an" +
            " operator resolves what it is waiting on. Handing the next worker" +
            " an issue no agent session can advance is the failure this avoids.",
          "",
        ]
      : []),
    "Evidence:",
    "",
    ...evidence.map((line) => `- ${line}`),
    "",
    {
      deleted: `The reservation \`${refPath}\` was deleted before this issue was touched.`,
      absent: `The reservation \`${refPath}\` was already absent; only the issue needed restoring.`,
      planned: `The reservation \`${refPath}\` would be deleted before this issue is touched.`,
    }[reservation],
    "The reservation always goes first: a failure after that point leaves the" +
      " issue readable as `status:claimed` for the next janitor pass, whereas" +
      " the reverse order strands it as claimable with a live reservation" +
      " that no claim attempt can get past.",
  ].join("\n");

/**
 * The comment posted for an **orphaned** reservation: a live ref behind an
 * open issue that does not carry `status:claimed` (report.mjs's
 * `unclaimable` classification) — for example one moved to `status:blocked`
 * after its worker found the claim could not proceed. There is no
 * `status:claimed` removal to make here, because the
 * issue was never left claimed; no label is changed, so the wording says that
 * explicitly rather than reusing `explanation`'s claim-release framing.
 *
 * The assignee is a different matter and this comment used to get it wrong,
 * asserting that none was cleared. An assignee is set at claim time
 * and means nothing once the reservation is gone, while `lib/claim.mjs`
 * filters out every assigned issue — so leaving it set turns the issue into one
 * that reads as claimable on every board while `claim.mjs` refuses it.
 *
 * @param {{
 *   agentId: string,
 *   issue: string,
 *   refPath: string,
 *   evidence: string[],
 *   claimedLabel: string,
 *   reservation: "deleted" | "planned",
 *   assignees: string[],
 * }} input
 */
export const orphanExplanation = ({
  agentId,
  issue,
  refPath,
  evidence,
  claimedLabel,
  reservation,
  assignees,
}) =>
  [
    `Orphaned reservation on #${issue} released by Rallypoint janitor \`${agentId}\`.`,
    "",
    `#${issue} does not carry \`${claimedLabel}\`, so this is not a claim` +
      " release and **no label was changed**. The stray reservation" +
      ` \`${refPath}\` ${reservation === "deleted" ? "was deleted" : "would be deleted"}.`,
    "",
    assignees.length === 0
      ? "The issue carried no assignee, so none needed clearing."
      : `${assignees.map((login) => `\`${login}\``).join(", ")}` +
        (reservation === "deleted"
          ? ` ${assignees.length === 1 ? "was" : "were"} unassigned as well.`
          : " would be unassigned as well.") +
        " An assignee outlives the claim that set it, and `claim.mjs` filters" +
        " out every assigned issue — so an issue left assigned after its" +
        " reservation is gone is unclaimable no matter which label it carries.",
    "",
    "Evidence:",
    "",
    ...evidence.map((line) => `- ${line}`),
  ].join("\n");

const USAGE =
  "Usage: release-claim.mjs --issue <open-issue-number> --agent-id <unique-session-id> [--dry-run]";

/** @param {string[]} argv */
export const parseArgs = (argv) => {
  /** @param {string} flag */
  const values = (flag) =>
    argv.flatMap((value, index) =>
      value === flag && argv[index + 1] ? [argv[index + 1]] : [],
    );

  return {
    issue: values("--issue").at(0),
    agentId: values("--agent-id").at(0),
    dryRun: argv.includes("--dry-run"),
  };
};

/**
 * The audit record for the backstop case: an open issue is still assigned
 * after its reservation ref has gone. The absent ref is the proof that the
 * claim ended; no age heuristic applies, and no label changes.
 *
 * @param {{
 *   agentId: string,
 *   issue: string,
 *   refPath: string,
 *   assignees: string[],
 *   humanLabel: string | null,
 *   sharedIdentity: string,
 *   action: "planned" | "cleared",
 * }} input
 */
export const staleAssigneeExplanation = ({
  agentId,
  issue,
  refPath,
  assignees,
  humanLabel,
  sharedIdentity,
  action,
}) => `Rallypoint janitor \`${agentId}\` ${
  action === "planned" ? "would clear" : "cleared"
} stale assignee${assignees.length === 1 ? "" : "s"} ${assignees
  .map((login) => `\`${login}\``)
  .join(", ")} from #${issue}.

- The claim reservation \`${refPath}\` is absent. \`${sharedIdentity}\` is this repository's shared claim-protocol identity, so the absent reservation proves the claim ended for \`${sharedIdentity}\`; the \`staleClaimHours\` heuristic is neither needed nor consulted. Any other assignee is outside that proof and remains untouched.
- No label was changed.${
  humanLabel
    ? ` \`${humanLabel}\` still holds the issue out of the claimable pool; it does not preserve an assignee left by an ended claim.`
    : ""
}`;

/**
 * Clears the assignee left after a claim reservation has already disappeared.
 * `reservationPresence` is deliberately the same exact-ref authority used by
 * every release path. `report.mjs` only nominates this repair and remains
 * read-only; this function re-establishes the proof immediately before acting.
 *
 * @param {{
 *   issue: string,
 *   agentId: string,
 *   refName: string,
 *   refPath: string,
 *   repository: string,
 *   assignees: string[],
 *   humanLabel: string | null,
 *   config: { sharedIdentity?: unknown },
 *   gh: (...args: string[]) => string,
 *   dryRun: boolean,
 *   stdout: (line: string) => void,
 *   stderr: (line: string) => void,
 * }} input
 */
export const clearStaleAssignee = ({
  issue,
  agentId,
  refName,
  refPath,
  repository,
  assignees,
  humanLabel,
  config,
  gh,
  dryRun,
  stdout,
  stderr,
}) => {
  const sharedIdentity = sharedProtocolLogin(config);

  // Declining here is the whole safety property. Without a named identity there
  // is no way to tell a protocol assignment from a person's, and this is the
  // one path that removes assignees.
  if (sharedIdentity === null) {
    stderr(
      `Refusing to clear the assignee on #${issue}: \`sharedIdentity\` is not set in \`.rallypoint/config.json\`, so no assignee can be shown to be protocol-owned rather than a person's. Set it to the login your agent sessions authenticate as, or clear the assignee by hand.`,
    );
    return EXIT.inconclusive;
  }

  const presence = reservationPresence(gh, repository, refName);

  if (presence.kind === "unknown") {
    stderr(
      `Refusing to clear the assignee on #${issue}: whether \`${refPath}\` exists could not be established (${presence.reason}). Nothing was changed.`,
    );
    return EXIT.refBlocked;
  }

  if (presence.kind === "present") {
    stderr(
      `Refusing to clear the assignee on #${issue}: reservation \`${refPath}\` is live, so the claim has not ended.`,
    );
    return EXIT.active;
  }

  const protocolAssignees = assignees.filter(
    (login) => login === sharedIdentity,
  );

  if (protocolAssignees.length === 0) {
    stderr(
      `Issue #${issue} is not assigned to the shared Rallypoint identity \`${sharedIdentity}\` and has no reservation \`${refPath}\`; there is no proven protocol assignee to clear. Any other assignee was left unchanged.`,
    );
    return EXIT.notClaimed;
  }

  const explanation = staleAssigneeExplanation({
    agentId,
    issue,
    refPath,
    assignees: protocolAssignees,
    humanLabel,
    sharedIdentity,
    action: dryRun ? "planned" : "cleared",
  });

  if (dryRun) {
    stdout(explanation);
    stdout("\n(dry run: nothing was edited or commented)");
    return EXIT.ok;
  }

  try {
    gh(
      "issue",
      "edit",
      issue,
      ...protocolAssignees.flatMap((login) => ["--remove-assignee", login]),
    );
  } catch (error) {
    stderr(
      `Issue #${issue} could not be unassigned (${describeError(error)}). Nothing else was changed.`,
    );
    return EXIT.restoreFailed;
  }

  stdout(`Unassigned ${protocolAssignees.join(", ")} from #${issue}.`);

  try {
    gh("issue", "comment", issue, "--body", explanation);
  } catch (error) {
    stderr(
      `The shared Rallypoint identity was unassigned from #${issue}, but the required audit comment could not be posted (${describeError(error)}). The unassignment may already be visible and was not rolled back, because reassigning could collide with a new claim. The repair is incomplete: post the audit explanation by hand, then rerun the janitor pass.`,
    );
    stderr(`Missing audit explanation:\n${explanation}`);
    return EXIT.restoreFailed;
  }

  stdout(`CLEARED_STALE_ASSIGNEE=${issue}`);
  return EXIT.ok;
};

/**
 * The eligibility check both release paths run, with the self-release
 * shortcut applied before either of them spends a single `gh` call on
 * evidence the holder's own say-so already outweighs.
 *
 * A self-release is not "instantly stale" in the sense `assess` means it —
 * nothing aged past `staleClaimHours` — so this returns a `stale` verdict
 * carrying its own evidence line instead, which is what lets a self-release
 * flow through the same explanation-building code below unchanged while still
 * reading honestly to whoever audits the resulting comment.
 *
 * @param {{
 *   issue: string,
 *   now: number,
 *   staleClaimHours: number,
 *   branchPrefix: string,
 *   claim: { agent: string, createdAt: string } | null,
 *   agentId: string,
 *   gh: (...args: string[]) => string,
 *   git?: (args: string[], options?: { cwd?: string }) => string,
 *   repository: string,
 *   config: { branchPrefix: string, integrationBranch?: string },
 * }} input
 * @returns {Assessment}
 */
export const assessForRelease = ({
  issue,
  now,
  staleClaimHours,
  branchPrefix,
  claim,
  agentId,
  gh,
  git,
  repository,
  config,
}) => {
  if (isSelfRelease(claim, agentId)) {
    return {
      kind: "stale",
      claim,
      evidence: [
        `Released by its own holder \`${agentId}\`, matching the agent id recorded in the claim comment at ${claim?.createdAt}. The holder of a claim is the one authority on whether its own session is still running, so the ${staleClaimHours}h \`staleClaimHours\` threshold does not apply.`,
      ],
    };
  }

  return assess({
    issue,
    now,
    staleClaimHours,
    branchPrefix,
    claim,
    pullRequests: openPullRequests(gh),
    // A caller that supplied no `git` runner gets `unknown`, not an empty
    // answer. Defaulting the other way would let a caller silently lose the
    // local-work guard by omission, which is the failure mode this module has
    // shipped four times already in other forms.
    localWork: git
      ? localIssueWork({
          git,
          issue,
          branchPrefix,
          integrationBranch: config.integrationBranch ?? "main",
        })
      : {
          ok: false,
          reason: `no local \`git\` runner was supplied, so whether this machine holds unpushed work for #${issue} was not established`,
        },
    ...branchEvidence(gh, repository, config, issue),
  });
};

/**
 * Releases a reservation for an open issue that carries neither
 * `status:claimed` nor any hold label (§ "A third case" in `releaseClaim`).
 * Eligibility is proven exactly like an ordinary release — the same open
 * pull request and issue branch checks, aged off the same last claim comment
 * — because the reservation still exists to prevent a second worker from
 * colliding with whatever session is looking at this issue.
 *
 * Success touches the ref and the assignee, in that order, and no label. The
 * label is genuinely not this command's business: `claim.mjs`'s state machine
 * moved on from this issue, and there is no `status:claimed` for it to
 * restore. The assignee is, because it is an artefact of the claim that has
 * just ended and `lib/claim.mjs` refuses every assigned issue — the
 * same reasoning the ordinary release path applies below, and the one
 * `close-referenced-issues.mjs` applies to the `Refs #<issue>` merge shape.
 * Ordering matches the rest of this module for the same reason: a failure
 * between the two steps must leave the reservation gone rather than live.
 *
 * @param {{
 *   issue: string,
 *   agentId: string,
 *   refName: string,
 *   refPath: string,
 *   repository: string,
 *   view: {
 *     assignees: { login?: string }[],
 *     comments: { body?: string | null, createdAt?: string }[],
 *   },
 *   config: {
 *     branchPrefix: string,
 *     staleClaimHours: number,
 *     labels: { claimed: string },
 *   },
 *   gh: (...args: string[]) => string,
 *   git?: (args: string[], options?: { cwd?: string }) => string,
 *   dryRun: boolean,
 *   stdout: (line: string) => void,
 *   stderr: (line: string) => void,
 *   now: number,
 * }} input
 * @returns {number} Process exit code.
 */
export const releaseOrphanedReservation = ({
  issue,
  agentId,
  refName,
  refPath,
  repository,
  view,
  config,
  gh,
  git,
  dryRun,
  stdout,
  stderr,
  now,
}) => {
  const assessment = assessForRelease({
    issue,
    now,
    staleClaimHours: config.staleClaimHours,
    branchPrefix: config.branchPrefix,
    claim: lastClaim(view.comments),
    agentId,
    gh,
    git,
    repository,
    config,
  });

  if (assessment.kind === "unknown") {
    stderr(
      `Refusing to release #${issue}: ${assessment.reason}. A lookup that could not be established is not evidence of absence, so nothing was changed.`,
    );
    return EXIT.inconclusive;
  }

  if (assessment.kind === "active") {
    stderr(`Refusing to release #${issue}: ${assessment.reason}.`);
    return EXIT.active;
  }

  if (assessment.kind === "notStale") {
    stderr(`Refusing to release #${issue}: ${assessment.reason}.`);
    return EXIT.notStale;
  }

  /** @type {string[]} */
  const assignees = view.assignees.flatMap((assignee) =>
    assignee.login ? [assignee.login] : [],
  );

  if (dryRun) {
    stdout(
      orphanExplanation({
        agentId,
        issue,
        refPath,
        evidence: assessment.evidence,
        claimedLabel: config.labels.claimed,
        reservation: "planned",
        assignees,
      }),
    );
    stdout(`\n(dry run: nothing was deleted, edited, or commented)`);
    return EXIT.ok;
  }

  try {
    gh("api", "--method", "DELETE", `repos/${repository}/git/${refPath}`);
  } catch (error) {
    stderr(
      `Refusing to release #${issue}: \`${refPath}\` could not be deleted (${describeError(error)}). No issue state was changed.`,
    );
    return EXIT.refBlocked;
  }

  const after = reservationPresence(gh, repository, refName);

  if (after.kind !== "absent") {
    const detail = after.kind === "unknown" ? after.reason : "it is still listed";
    stderr(
      `Refusing to release #${issue}: the delete of \`${refPath}\` reported success but the ref could not be confirmed gone (${detail}).`,
    );
    return EXIT.refBlocked;
  }

  stdout(
    `Deleted orphaned reservation ${refPath}. Issue #${issue} carried no \`status:claimed\` label to remove.`,
  );

  // Step two, and unlike the ordinary release it is only ever about the
  // assignee. An issue with none needs no edit at all — issuing one anyway
  // would put a pointless entry in the issue's timeline and give this path a
  // failure mode it does not otherwise have.
  if (assignees.length > 0) {
    try {
      gh(
        "issue",
        "edit",
        issue,
        ...assignees.flatMap((login) => ["--remove-assignee", login]),
      );
    } catch (error) {
      stderr(
        `Reservation ${refPath} was deleted but #${issue} could not be unassigned (${describeError(error)}).` +
          " It is still assigned, so `claim.mjs` will refuse it. Re-run this" +
          " command: the absent reservation is now positive proof that the claim" +
          " ended, and the stale-assignee backstop will retry only the unassign.",
      );
      return EXIT.restoreFailed;
    }

    stdout(`Unassigned ${assignees.join(", ")} from #${issue}.`);
  }

  try {
    gh(
      "issue",
      "comment",
      issue,
      "--body",
      orphanExplanation({
        agentId,
        issue,
        refPath,
        evidence: assessment.evidence,
        claimedLabel: config.labels.claimed,
        reservation: "deleted",
        assignees,
      }),
    );
  } catch (error) {
    stderr(
      `Released #${issue}, but the explanation comment could not be posted (${describeError(error)}). Post it by hand.`,
    );
  }

  stdout(`RELEASED_ISSUE=${issue}`);
  stdout(`RELEASED_REF=${refPath}`);
  return EXIT.ok;
};

/**
 * @param {{
 *   argv: string[],
 *   config: {
 *     branchPrefix: string,
 *     claimRefPrefix: string,
 *     staleClaimHours: number,
 *     labels: { claimed: string, human: string },
 *   },
 *   gh: (...args: string[]) => string,
 *   git?: (args: string[], options?: { cwd?: string }) => string,
 *   stdout?: (line: string) => void,
 *   stderr?: (line: string) => void,
 *   now?: () => number,
 * }} input
 * @returns {number} Process exit code.
 */
export const releaseClaim = ({
  argv,
  config,
  gh,
  git,
  stdout = console.log,
  stderr = console.error,
  now = () => Date.now(),
}) => {
  const { issue, agentId, dryRun } = parseArgs(argv);

  if (!issue || !/^\d+$/.test(issue) || !agentId) {
    stderr(USAGE);
    return EXIT.usage;
  }

  // The id lands in a comment the loop reads back, so hold it to the same shape
  // `claim.mjs` and `review.mjs` require.
  if (!SAFE_AGENT_ID.test(agentId)) {
    stderr(
      `Agent id "${agentId}" must match ${SAFE_AGENT_ID}: letters, digits, dot, underscore, and hyphen only.`,
    );
    return EXIT.usage;
  }

  const repository = JSON.parse(gh("repo", "view", "--json", "nameWithOwner"))
    .nameWithOwner;
  const view = JSON.parse(
    gh("issue", "view", issue, "--json", "state,labels,assignees,comments"),
  );

  if (view.state !== "OPEN") {
    stderr(
      `Issue #${issue} is ${String(view.state).toLowerCase()}; there is no live claim to release. Use cleanup.mjs to remove the reservation for a closed issue.`,
    );
    return EXIT.notClaimed;
  }

  /** @type {string[]} */
  const labels = view.labels.map(
    (/** @type {{ name: string }} */ label) => label.name,
  );

  // A claim release is defined only for a claimed issue. An open issue that
  // does not carry `status:claimed` while its reservation is still live —
  // `status:blocked` is the common one, but since the readiness label was removed an issue carrying no
  // label at all is equally this case — has already moved past `claim.mjs`'s
  // label state machine, so there is no `status:claimed` removal to make; only
  // the stray reservation itself is an orphan (report.mjs's `unclaimable`
  // classification). That is releasable on its own, subject to the same
  // activity proof as a normal release.
  //
  // Before the readiness label was removed a `status:ready` issue was carved out of this as the
  // "stranded" state and refused, so that `status:claimed` could be restored by
  // hand and the release stay auditable. There is no such label to carve on
  // now, and the orphan path's own explanatory comment carries the audit trail
  // the refusal was protecting.
  if (!labels.includes(config.labels.claimed)) {
    const refName = `${config.claimRefPrefix}${issue}`;
    const refPath = `refs/heads/${refName}`;
    const presence = reservationPresence(gh, repository, refName);

    if (presence.kind === "unknown") {
      stderr(
        `Refusing to release #${issue}: whether \`${refPath}\` exists could not be established (${presence.reason}). No issue state was changed.`,
      );
      return EXIT.refBlocked;
    }

    if (presence.kind === "absent") {
      const assignees = view.assignees.flatMap(
        (/** @type {{ login?: string }} */ assignee) =>
          assignee.login ? [assignee.login] : [],
      );

      return clearStaleAssignee({
        issue,
        agentId,
        refName,
        refPath,
        repository,
        assignees,
        humanLabel: labels.includes(config.labels.human)
          ? config.labels.human
          : null,
        config,
        gh,
        dryRun,
        stdout,
        stderr,
      });
    }

    return releaseOrphanedReservation({
      issue,
      agentId,
      refName,
      refPath,
      repository,
      view,
      config,
      gh,
      git,
      dryRun,
      stdout,
      stderr,
      now: now(),
    });
  }

  const assessment = assessForRelease({
    issue,
    now: now(),
    staleClaimHours: config.staleClaimHours,
    branchPrefix: config.branchPrefix,
    claim: lastClaim(view.comments),
    agentId,
    gh,
    git,
    repository,
    config,
  });

  if (assessment.kind === "unknown") {
    stderr(
      `Refusing to release #${issue}: ${assessment.reason}. A lookup that could not be established is not evidence of absence, so nothing was changed.`,
    );
    return EXIT.inconclusive;
  }

  if (assessment.kind === "active") {
    stderr(`Refusing to release #${issue}: ${assessment.reason}.`);
    return EXIT.active;
  }

  if (assessment.kind === "notStale") {
    stderr(`Refusing to release #${issue}: ${assessment.reason}.`);
    return EXIT.notStale;
  }

  const refName = `${config.claimRefPrefix}${issue}`;
  const refPath = `refs/heads/${refName}`;

  // Whether the issue stays out of the claimable pool after this release, which
  // since the readiness label was removed is a fact to *report* rather than a decision to make.
  // `needs:human` is one of the hold labels `lib/claimable.mjs` filters on, so
  // an issue carrying it is held out by that label alone — this release adds
  // nothing and withholds nothing. The comment still says so, because a reader
  // auditing a release wants to know whether the issue is claimable again and
  // the answer here is no.
  const humanLabel = labels.includes(config.labels.human)
    ? config.labels.human
    : null;

  if (dryRun) {
    stdout(
      explanation({
        agentId,
        issue,
        refPath,
        evidence: assessment.evidence,
        reservation: "planned",
        humanLabel,
      }),
    );
    stdout(`\n(dry run: nothing was deleted, edited, or commented)`);
    return EXIT.ok;
  }

  // Step one, and it is allowed to be the only step. Every abort below happens
  // before any issue mutation, which is acceptance criterion 6: losing the
  // ability to delete the ref must never produce a half-release.
  const before = reservationPresence(gh, repository, refName);

  if (before.kind === "unknown") {
    stderr(
      `Refusing to release #${issue}: whether \`${refPath}\` exists could not be established (${before.reason}). No issue state was changed.`,
    );
    return EXIT.refBlocked;
  }

  if (before.kind === "present") {
    try {
      gh("api", "--method", "DELETE", `repos/${repository}/git/${refPath}`);
    } catch (error) {
      stderr(
        `Refusing to release #${issue}: \`${refPath}\` could not be deleted (${describeError(error)}). No issue state was changed, so #${issue} still reads \`${config.labels.claimed}\` and stays visible to a janitor that can delete it.`,
      );
      return EXIT.refBlocked;
    }

    // Confirm by listing rather than by the delete's own exit status, for the
    // same reason existence is established by listing: the credential that can
    // fail a delete can also fail it unhelpfully.
    const after = reservationPresence(gh, repository, refName);

    if (after.kind !== "absent") {
      const detail =
        after.kind === "unknown" ? after.reason : "it is still listed";
      stderr(
        `Refusing to release #${issue}: the delete of \`${refPath}\` reported success but the ref could not be confirmed gone (${detail}). No issue state was changed.`,
      );
      return EXIT.refBlocked;
    }

    stdout(`Deleted reservation ${refPath}.`);
  } else {
    stdout(`Reservation ${refPath} is already absent; restoring the issue only.`);
  }

  // Step two. Clearing the assignee is mandatory: `lib/claim.mjs` filters out
  // every assigned issue, so a restore that leaves it assigned is a silent
  // no-op that returns the issue to a backlog nobody can draw from.
  /** @type {string[]} */
  const assignees = view.assignees
    .map((/** @type {{ login?: string }} */ assignee) => assignee.login)
    .filter((/** @type {string | undefined} */ login) => Boolean(login));

  try {
    gh(
      "issue",
      "edit",
      issue,
      ...assignees.flatMap((login) => ["--remove-assignee", login]),
      "--remove-label",
      config.labels.claimed,
    );
  } catch (error) {
    stderr(
      `Reservation ${refPath} was deleted but issue #${issue} could not be restored (${describeError(error)}). It still reads \`${config.labels.claimed}\`, which is the recoverable half of this failure: re-run this command to finish the release.`,
    );
    return EXIT.restoreFailed;
  }

  if (humanLabel) {
    stdout(
      `#${issue} carries \`${humanLabel}\`, so it is released but still not claimable.`,
    );
  }

  try {
    gh(
      "issue",
      "comment",
      issue,
      "--body",
      explanation({
        agentId,
        issue,
        refPath,
        evidence: assessment.evidence,
        reservation: before.kind === "present" ? "deleted" : "absent",
        humanLabel,
      }),
    );
  } catch (error) {
    // The release itself is complete and coherent. A missing explanation is a
    // record to restore by hand, not a reason to report failure.
    stderr(
      `Released #${issue}, but the explanation comment could not be posted (${describeError(error)}). Post it by hand.`,
    );
  }

  stdout(`RELEASED_ISSUE=${issue}`);
  stdout(`RELEASED_REF=${refPath}`);
  return EXIT.ok;
};

export default releaseClaim;
