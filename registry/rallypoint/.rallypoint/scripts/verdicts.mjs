// Parsing and precedence for review verdicts recorded by `review.mjs`.
//
// Kept free of `gh` calls and process state so the rules that decide what
// `review:approved` means are directly testable.
//
// Every ambiguity here resolves to "not approved". A verdict that cannot be
// read unambiguously, or whose independence cannot be established, must never
// produce an approval.

export const MARKER = "rallypoint-review";

const VERDICTS = new Set(["approve", "request-changes"]);

const block = () => new RegExp(`<!--\\s*${MARKER}\\b([\\s\\S]*?)-->`, "g");

// GitHub does not document the order of the `reviews` array, so "latest" is
// established from `submittedAt` rather than from array position. Reviews
// without a usable timestamp keep their original relative order.
/**
 * @typedef {{
 *   body?: string | null,
 *   commitId?: string | null,
 *   submittedAt?: string | null,
 * }} Review
 */

/** @param {Review[]} reviews */
const chronological = (reviews) =>
  reviews
    .map((review, index) => ({ review, index }))
    .sort((left, right) => {
      const at = Date.parse(left.review.submittedAt ?? "");
      const to = Date.parse(right.review.submittedAt ?? "");
      if (Number.isNaN(at) || Number.isNaN(to) || at === to) {
        return left.index - right.index;
      }
      return at - to;
    })
    .map((entry) => entry.review);

/**
 * @param {Review[]} reviews
 * @returns {{
 *   verdict: string,
 *   sha: string,
 *   reviewer: string,
 *   issued: string,
 *   pr?: string,
 *   supersedes?: string,
 *   dispatchedBy?: string,
 * }[]}
 */
export const parseVerdicts = (reviews) => {
  // Each recording carries a fresh `issued` nonce, so a replay — which copies
  // the block verbatim, nonce and all — is a duplicate, while a reviewer
  // genuinely re-recording at the same head is not. Fingerprinting the block
  // text cannot tell those apart: they are byte-identical by construction.
  /** @type {Set<string>} */
  const seen = new Set();

  return chronological(reviews).flatMap((review) => {
    const body = review.body ?? "";
    const blocks = [...body.matchAll(block())];
    const commitId = review.commitId ?? null;

    // Exactly one block, and it must open the body outright. Anything before
    // it — prose, a quote marker, a fence, or the four spaces that make GitHub
    // render the block as code — means this is someone else's verdict being
    // displayed rather than this reviewer's being recorded. Two blocks in one
    // body is malformed rather than a choice to make.
    if (blocks.length !== 1) return [];
    if (body.slice(0, blocks[0].index).replace(/^﻿/, "") !== "") return [];

    // Anchored per line so `overhead:` cannot satisfy `head:`. A field stated
    // twice is malformed for the same reason two blocks are: there is no
    // principled way to choose between them.
    /** @param {string} name */
    const field = (name) => {
      const found = blocks[0][1].match(
        new RegExp(`^[^\\S\\n]*${name}:[^\\S\\n]*(\\S+)[^\\S\\n]*$`, "gm"),
      );
      if (found?.length !== 1) return undefined;
      return found[0].match(new RegExp(`${name}:[^\\S\\n]*(\\S+)`))?.at(1);
    };

    const verdict = field("verdict");
    const sha = field("head");
    const reviewer = field("reviewer");
    const issued = field("issued");
    // Only promotion verdicts carry this field; it binds the block to
    // a specific pull request number as well as a head SHA, so a verdict
    // cannot be read as belonging to a different promotion pull request that
    // happens to share a head (e.g. a reopened promotion branch).
    const pr = field("pr");
    // Only an approve recorded over a contested dissent carries this:
    // the `issued` nonce of the request-changes verdict it was told to
    // proceed over. Threaded through here, rather than dropped like `issued`
    // used to be, so `check` can tell a plain approve from one that overrode
    // another reviewer's unaddressed dissent.
    const supersedes = field("supersedes");
    // Self-declared by the reviewer, exactly like `reviewer` itself:
    // the id of the session that dispatched this one, present only when the
    // review was carried out by a subagent. Not authenticated any more than
    // `reviewer` is — a dishonest session can omit or falsify it — but an
    // honest one names it, and `resolveApproval` below treats a match against
    // the branch's own author the same as the reviewer id matching directly.
    const dispatchedBy = field("dispatched-by");

    if (!verdict || !VERDICTS.has(verdict) || !sha || !reviewer || !issued)
      return [];

    if (seen.has(issued)) return [];
    seen.add(issued);

    // The block's `head` is self-reported by whoever wrote it. GitHub records
    // the revision a review was submitted against independently, so require
    // the two to agree: a verdict claiming a revision it was not submitted
    // against is forged or copied, either way not a verdict.
    if (commitId !== null && commitId !== sha) return [];

    return [
      {
        verdict,
        sha,
        reviewer,
        issued,
        ...(pr ? { pr } : {}),
        ...(supersedes ? { supersedes } : {}),
        ...(dispatchedBy ? { dispatchedBy } : {}),
      },
    ];
  });
};

// A verdict recorded by hand before this script existed: an unreadable review
// at the current head that predates every machine verdict on the pull request.
// Clearing the label on the strength of one would destroy a real approval.
//
// Deliberately narrow. Ordinary review conversation is also unreadable, and
// treating that as protective would disable `--strip-stale` permanently the
// moment anyone comments — which would hand an author a one-comment way to
// keep a stale approval alive.
/**
 * @param {Review[]} reviews
 * @param {string} head
 */
export const legacyVerdictAtHead = (reviews, head) => {
  const recorded = reviews
    .filter((review) => parseVerdicts([review]).length > 0)
    .map((review) => Date.parse(review.submittedAt ?? ""))
    .filter((time) => !Number.isNaN(time));
  const earliest = recorded.length > 0 ? Math.min(...recorded) : Infinity;

  return reviews.some((review) => {
    if ((review.commitId ?? null) !== head) return false;
    if ((review.body ?? "").trim() === "") return false;
    if (parseVerdicts([review]).length > 0) return false;
    const at = Date.parse(review.submittedAt ?? "");
    // An unreadable timestamp protects. This function exists to stop the
    // script destroying what it cannot read, so it must not treat a missing
    // date as licence to strip. A tie can only mean the hand verdict is at
    // least as old as the first machine one.
    return Number.isNaN(at) ? true : at <= earliest;
  });
};

// A pull request is approved only when the most recent verdict at the current
// head is an approve, and that verdict demonstrably came from someone other
// than the agent that claimed the linked issue. Anything else — no verdict, a
// verdict against a superseded revision, a later request-changes, a
// self-approval, or an author we cannot identify — is not an approval.
//
// A pull request closing several issues has several candidate claimants
//, so `worker` is a set rather than a single id: an approve from any
// session that claimed any referenced issue is a self-approval. A single id is
// still accepted and means a set of one.
/**
 * @param {{
 *   reviews: Review[],
 *   head: string,
 *   worker: string | string[] | null | undefined,
 * }} input
 */
export const resolveApproval = ({ reviews, head, worker }) => {
  const workers = (Array.isArray(worker) ? worker : [worker]).filter(
    /** @returns {id is string} */ (id) => Boolean(id),
  );
  const current = parseVerdicts(reviews).filter((entry) => entry.sha === head);
  const latest = current.at(-1);

  if (!latest || latest.verdict !== "approve") {
    return {
      approved: false,
      selfApproved: false,
      unidentifiedWorker: false,
      reviewer: null,
      supersedes: null,
    };
  }

  // Fail closed. Without a known author, independence cannot be established,
  // and an unverifiable approval is exactly the state this script exists to
  // prevent.
  if (workers.length === 0) {
    return {
      approved: false,
      selfApproved: false,
      unidentifiedWorker: true,
      reviewer: latest.reviewer,
      supersedes: latest.supersedes ?? null,
    };
  }

  // a subagent dispatched by the authoring session is not an
  // independent reviewer even though its own agent id differs from the
  // author's. `dispatched-by` is self-declared the same way `reviewer` is
  // (see the note in `parseVerdicts`), so this is a second line of defence
  // alongside `record`'s own refusal below — it catches a verdict that
  // reached the record some other way (a hand-posted review reusing the
  // block format, or a verdict recorded before this check existed) as well
  // as one `record` refused to write and something wrote anyway.
  const selfApproved =
    workers.includes(latest.reviewer) ||
    (latest.dispatchedBy != null && workers.includes(latest.dispatchedBy));

  return {
    approved: !selfApproved,
    selfApproved,
    unidentifiedWorker: false,
    reviewer: latest.reviewer,
    // Present only when this approve was recorded with `--supersedes` over
    // another reviewer's unaddressed dissent — `check` surfaces that
    // distinctly rather than reporting it identically to an uncontested
    // approve.
    supersedes: latest.supersedes ?? null,
  };
};

// A promotion pull request has no individually claimed author, so the
// self-review question `resolveApproval` answers does not apply — there is no
// worker to compare the reviewer against. What still applies is binding the
// verdict to a specific revision: approved only when the most recent verdict
// at the current head, recorded against this exact pull request number, is an
// approve. A verdict recorded against a different pull request that happens
// to share a head SHA (a reopened or recreated promotion branch) does not
// count, which is why `pr` is threaded through and compared as a string.
/**
 * @param {{
 *   reviews: Review[],
 *   head: string,
 *   pr: string | number,
 * }} input
 */
export const resolvePromotionApproval = ({ reviews, head, pr }) => {
  const expected = String(pr);
  const current = parseVerdicts(reviews).filter(
    (entry) =>
      entry.sha === head &&
      /** @type {{ pr?: string }} */ (entry).pr === expected,
  );
  const latest = current.at(-1);

  if (!latest || latest.verdict !== "approve") {
    return { approved: false, reviewer: null, supersedes: null };
  }

  return {
    approved: true,
    reviewer: latest.reviewer,
    supersedes: latest.supersedes ?? null,
  };
};

// two reviewers can legitimately disagree at the same head within
// minutes of each other, neither having seen the other's verdict. Last-wins
// (above) is unchanged — it is what `check` and the merge gate act on — but
// `record` refuses to let a fresh approve silently overwrite an unaddressed
// dissent from a *different* reviewer, so the override happens with someone
// still at the keyboard reading it rather than by accident.
//
// A dissent is "active" when it is the most recent verdict a given reviewer
// has posted at this exact head, it is a request-changes, and no later
// verdict at this head has named its `issued` nonce in a `supersedes` field.
// Only the most recent verdict per reviewer counts: a reviewer who posts a
// second request-changes at the same head supersedes their own first one
// implicitly, the same way an approve does in `resolveApproval`.
/**
 * @param {{ reviews: Review[], head: string, pr?: string | number }} input
 */
export const unsupersededDissents = ({ reviews, head, pr }) => {
  const expected = pr === undefined ? undefined : String(pr);
  const entries = parseVerdicts(reviews).filter(
    (entry) =>
      entry.sha === head &&
      (expected === undefined ||
        /** @type {{ pr?: string }} */ (entry).pr === expected),
  );

  /** @type {Map<string, (typeof entries)[number]>} */
  const latestByReviewer = new Map();
  for (const entry of entries) latestByReviewer.set(entry.reviewer, entry);

  const superseded = new Set(
    entries.flatMap((entry) => (entry.supersedes ? [entry.supersedes] : [])),
  );

  return [...latestByReviewer.values()].filter(
    (entry) => entry.verdict === "request-changes" && !superseded.has(entry.issued),
  );
};

// The record-time gate itself. Pure and testable independently of
// `gh`: given the reviews already read, the head, who is about to record an
// approve, and what `--supersedes` nonce (if any) they passed, decides
// whether the approve may proceed and, if not, why — so `review.mjs` only
// has to translate the result into a message and an exit code.
//
// A dissent from the same agent id that is about to record the approve is
// never contested: a reviewer changing their own mind at the same head needs
// no `--supersedes`, exactly as `resolveApproval`'s last-wins rule already
// allows.
/**
 * @param {{
 *   reviews: Review[],
 *   head: string,
 *   pr?: string | number,
 *   agentId: string,
 *   supersedes?: string | null,
 *   hasNote: boolean,
 * }} input
 * @returns {
 *   | { status: "clear", supersedes: string | null }
 *   | { status: "contested", dissents: ReturnType<typeof unsupersededDissents> }
 *   | { status: "missing-note", dissents: ReturnType<typeof unsupersededDissents> }
 *   | { status: "unknown-supersede", dissents: ReturnType<typeof unsupersededDissents> }
 * }
 */
export const resolveContestedApprove = ({
  reviews,
  head,
  pr,
  agentId,
  supersedes,
  hasNote,
}) => {
  const dissents = unsupersededDissents({ reviews, head, pr }).filter(
    (entry) => entry.reviewer !== agentId,
  );

  // `--supersedes` is validated whenever it is given, even if there happens
  // to be nothing left to contest: naming an unknown or already-superseded
  // nonce is a usage mistake regardless of whether some other dissent also
  // exists, and staying silent about it here would make the flag a no-op the
  // one time it matters most — when the reviewer thinks they are overriding
  // something that has, in fact, already been resolved by someone else.
  if (!supersedes) {
    if (dissents.length === 0) return { status: "clear", supersedes: null };
    return { status: "contested", dissents };
  }

  if (!hasNote) return { status: "missing-note", dissents };

  const target = dissents.find((entry) => entry.issued === supersedes);
  if (!target) return { status: "unknown-supersede", dissents };

  const remaining = dissents.filter((entry) => entry.issued !== supersedes);
  if (remaining.length > 0) return { status: "contested", dissents: remaining };

  return { status: "clear", supersedes: target.issued };
};
