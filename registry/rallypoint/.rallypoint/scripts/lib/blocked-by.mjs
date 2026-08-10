// The `Blocked-By:` trailer, and the rule that clears `status:blocked` once
// every issue it names has closed. Every call to `gh` is injected, so the
// decision is testable without a live GitHub.
//
// `docs/AGENT_LOOP.md` has always defined `status:blocked` as "a dependency
// prevents progress; work resumes on its own once that dependency clears".
// Nothing implemented "on its own". Every consumer of the label —
// `lib/claim.mjs`, `lib/release-claim.mjs`, `close-referenced-issues.mjs`,
// `janitor-pass.mjs`, `lib/report.mjs` — either filters the issue out or
// refuses to remove a hold label over it, and no code path anywhere removed
// the label when a dependency closed. Every removal in this repository's
// history was a human noticing by hand, and the cost is measured: #1249, #1421
// and #1424 each named #1420 as their only blocker, #1420 closed on 2026-08-08,
// and all three stayed invisible to `claim.mjs` until an operator went looking
// the next day. #1422 and #1423 inherited the stall transitively. An epic arc
// gated on `status:blocked` had no mechanism to advance past its own first
// merge, and nothing reported the stall — a blocked issue whose blocker closed
// is indistinguishable on every board from one whose blocker is still open.
//
// Two rules carry the whole design, and both fail closed:
//
// - **An issue with no `Blocked-By:` trailer is never auto-unblocked.** The
//   absence of a declaration is not evidence that nothing blocks it. Blockers
//   were declared in prose for years and frequently without a number at all —
//   #1421's complete declaration named no issue anywhere in its body — so a
//   sweep that guessed would guess wrong on most of the board.
// - **A partially-cleared trailer changes nothing.** All or nothing, so an
//   issue behind two dependencies is not queued the moment the first lands.
//
// `needs:human` vetoes the flip outright, unchanged from #877 and #935. That
// precedent is not weakened here: a worker that stood down and recorded
// `needs:human` recorded a judgement no automated writer may overrule, and
// putting such an issue back in the claimable pool is precisely the loop #715
// went round four times. The veto still posts its comment, because an operator
// wanting to know the trailer cleared is exactly who the veto is holding the
// issue for.

// Exit codes are a public interface, as they are for `cleanup.mjs`,
// `clear-status-labels.mjs`, and `release-claim.mjs`. Keep them in sync with
// the table in docs/AGENT_LOOP.md.
export const EXIT = {
  ok: 0,
  usage: 1,
  declined: 2, // nothing to do: no trailer, not blocked, or a blocker still open
  inconclusive: 3, // a source could not be read, or the trailer is unparseable
  editFailed: 4, // the flip was decided and the edit failed
};

/**
 * Stamped into every comment this module posts, so a later pass can tell it has
 * already spoken. The unblocking path is idempotent without it — it removes the
 * label, so the issue leaves the swept set — but the `needs:human` veto is not:
 * that issue keeps `status:blocked` on purpose and would otherwise collect one
 * identical comment per janitor pass, forever.
 */
export const BLOCKED_BY_MARKER = "<!-- rallypoint:blocked-by -->";

/**
 * Matches a `Blocked-By:` trailer on **one line of the original body**, which
 * `visibleLines` below has already judged to be outside every code and comment
 * construct. Applied per line and deliberately not global or multiline: the
 * only line start it can ever see is one the author's own newline put there.
 *
 * The anchor carries two of the exclusions on its own, and both are properties
 * of the line's own leading characters rather than of anything around it:
 *
 * - **Inline** — `` `Blocked-By: #1420` `` — a backtick is not leading
 *   whitespace, so the anchor never reaches the keyword.
 * - **Indented** — `    Blocked-By: #1420` — excluded by the `{0,3}` bound,
 *   which is not an arbitrary line: it is CommonMark's own indented-code rule,
 *   where four or more spaces of indentation opens a code block. Three still
 *   parse, because three render as prose. A **tab** is excluded outright rather
 *   than counted, for the same rule: CommonMark expands a tab to the next
 *   four-column stop, so a leading tab is already four columns of indentation
 *   however it is written. `>` for a blockquote is likewise not whitespace.
 *
 * The bound errs toward not matching in the one place CommonMark's rule is
 * softer than this — an indented line cannot interrupt a paragraph, so
 * `    Blocked-By: #1` on the line directly below prose is a lazy continuation
 * rather than a code block, and is live text this regex nonetheless skips. That
 * is the fail-closed direction: a missed declaration leaves `status:blocked` in
 * place and `report.mjs` says so, where a false one issues a real label edit.
 */
const TRAILER = /^[ ]{0,3}blocked-by[ \t]*:(.*)$/i;

// A fence opener: up to three spaces of indentation, then three or more
// backticks or tildes. The run length is captured because CommonMark requires a
// closing fence to be **at least as long** as the opener — the rule three
// rounds of this parser did not implement, and the one a four-backtick fence
// quoting a three-backtick fence depends on. For a backtick fence the info
// string may not itself contain a backtick.
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})(.*)$/;

/**
 * Whether `line` closes a fence opened by `marker`: the same character, at
 * least as many of them, and nothing after it but spaces and tabs. A fence line
 * with trailing content — ` ```Blocked-By: #1420 ` — is content of the open
 * block, not a closing fence, so this returns false and the line stays code.
 *
 * @param {string} line
 * @param {string} marker
 */
const closesFence = (line, marker) => {
  const match = line.match(/^ {0,3}(`+|~+)[ \t]*$/);
  return (
    match !== null && match[1][0] === marker[0] && match[1].length >= marker.length
  );
};

// The characters a backslash can escape, which is CommonMark's ASCII
// punctuation set. A backslash before anything else — a letter, a space, a
// newline — is a literal backslash and consumes nothing.
const ASCII_PUNCTUATION = /[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/;

// The angle-bracket constructs that outrank a code span when they start first:
// CommonMark's autolinks and raw HTML. Written as one sticky alternation so the
// scan below can ask "does an inert construct start exactly here?" in place.
//
// Every production is CommonMark's own, and two details of them are load-
// bearing rather than incidental. An unquoted attribute value **excludes** the
// backtick, so `<span id=`z>` is not a tag and its backtick stays a real run —
// `gh api /markdown` agrees. And an unterminated `<span title=x` is not a tag
// either, so nothing there is taken out of play.
const TAG_NAME = "[A-Za-z][A-Za-z0-9-]*";
const ATTRIBUTE_NAME = "[A-Za-z_:][A-Za-z0-9_.:-]*";
const ATTRIBUTE_VALUE = "[^\"'=<>`\\s]+|'[^']*'|\"[^\"]*\"";
const ATTRIBUTE = `(?:\\s+${ATTRIBUTE_NAME}(?:\\s*=\\s*(?:${ATTRIBUTE_VALUE}))?)`;
const INERT_ANGLE = new RegExp(
  [
    // A URI autolink, then an email autolink; a backtick is legal in both.
    "<[A-Za-z][A-Za-z0-9+.-]{1,31}:[^<>\\x00-\\x20]*>",
    "<[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9]" +
      "(?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?" +
      "(?:\\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*>",
    // An open tag, a closing tag, a comment, a processing instruction, a
    // declaration, and a CDATA section.
    `<${TAG_NAME}${ATTRIBUTE}*\\s*/?>`,
    `</${TAG_NAME}\\s*>`,
    "<!--[\\s\\S]*?-->",
    "<\\?[\\s\\S]*?\\?>",
    "<![A-Za-z][\\s\\S]*?>",
    "<!\\[CDATA\\[[\\s\\S]*?\\]\\]>",
  ].join("|"),
  "y",
);

/**
 * The ranges of `text` covered by a **closed** inline code span, so a paragraph
 * that opens a span on one line and closes it on a later one hides everything
 * between — including a line that begins at column zero.
 *
 * This approximates CommonMark's backtick pairing rule: each run is tried as an
 * opener against the next later run of equal length. When none exists, that
 * opener is literal text and the next run is tried instead. That restart is
 * load-bearing for `[1, 2, 2]`: the unmatched one-backtick run is literal, then
 * the two-backtick runs form the real span. It also preserves `[1, 2, 1]`, where
 * the first and last runs pair across the unequal middle run.
 *
 * **The pairing rule above is exact CommonMark and was verified against
 * `gh api /markdown` over every arrangement of one to four runs of length one
 * to three across a three-line paragraph — 546 bodies, zero disagreements.** Do
 * not tune it. What round five found wrong was not the pairing but the *run
 * scan* feeding it, which matched every backtick character in the raw text and
 * so counted runs CommonMark never created: a backslash-escaped backtick, a
 * backtick in an autolink destination, and a backtick in a quoted raw-HTML
 * attribute value. Three tests pinned the case where such a phantom run *forms*
 * a bogus span, which is the harmless direction. The dangerous one is that a
 * phantom run **pairs off a real one**, leaving a genuine run free to open a
 * multi-line span that swallows the trailer — GitHub renders the declaration as
 * code, this parser read it as live, and it drove a real label edit.
 *
 * So the scan is a single left-to-right pass rather than a regex over the whole
 * text, because which characters are even eligible to be a run depends on what
 * precedes them. At each position, in CommonMark's own precedence order:
 *
 * - A **backslash escape** consumes the punctuation character after it, so an
 *   escaped backtick opens nothing.
 * - An **autolink or raw HTML tag** consumes itself, because both outrank a
 *   code span that has not already opened.
 * - A **backtick run** searches forward for its equal-length partner.
 *
 * The forward search for a closer is deliberately **raw** — it sees neither
 * escapes nor angle constructs — because code span content is literal, so a
 * span that opened first swallows both. `` `foo\`bar` `` closing on the escaped
 * backtick is CommonMark's own worked example, and
 * `` `x <https://e.com/`b> c` `` closing inside the autolink was confirmed
 * against the renderer. Precedence here is purely first-come-first-served, and
 * a single pass is what expresses that.
 *
 * @param {string} text
 * @returns {{ start: number, end: number }[]}
 */
const codeSpans = (text) => {
  /** @type {{ start: number, end: number }[]} */
  const spans = [];
  let cursor = 0;

  while (cursor < text.length) {
    if (text[cursor] === "\\") {
      cursor += ASCII_PUNCTUATION.test(text[cursor + 1] ?? "") ? 2 : 1;
      continue;
    }

    if (text[cursor] === "<") {
      INERT_ANGLE.lastIndex = cursor;
      const inert = INERT_ANGLE.exec(text);
      cursor += inert === null ? 1 : inert[0].length;
      continue;
    }

    if (text[cursor] !== "`") {
      cursor += 1;
      continue;
    }

    let openerEnd = cursor;
    while (text[openerEnd] === "`") openerEnd += 1;

    const length = openerEnd - cursor;
    let closerIndex = -1;

    for (let scan = openerEnd; scan < text.length; scan += 1) {
      if (text[scan] !== "`") continue;

      let runEnd = scan;
      while (text[runEnd] === "`") runEnd += 1;

      if (runEnd - scan === length) {
        closerIndex = runEnd;
        break;
      }

      scan = runEnd - 1;
    }

    if (closerIndex === -1) {
      // No equal-length partner, so this run is literal text and the next run
      // is tried as an opener instead.
      cursor = openerEnd;
      continue;
    }

    spans.push({ start: cursor, end: closerIndex });
    // Scanning resumes *after* the closer, so a run consumed as a closer is
    // never also tried as an opener.
    cursor = closerIndex;
  }

  return spans;
};

/**
 * The lines of `body` a reader of the rendered issue can actually see as prose,
 * paired with their 1-based line numbers.
 *
 * **This is the whole of the fix for a defect class that recurred three times**
 * (#1451, rounds one through three), and the reason it cannot recur is the
 * shape of the function rather than the cases it happens to enumerate. The
 * previous approach rewrote the body — `withoutCode` **deletes** fenced regions
 * — and then anchored a pattern to `^` in the result. A deletion joins the text
 * either side of it, so it can manufacture a line start the source never had,
 * which is precisely the one thing a line-start anchor is trusted not to see.
 * Every round found a new way to make it do so: a fence, then an indented
 * block, then a four-backtick fence whose inner three-backtick line was
 * mistaken for its close, promoting the trailer to column zero of a line that
 * does not exist in the body at all.
 *
 * So nothing here rewrites anything. The body is split on its own newlines
 * once, each line is classified where it stands, and the trailer pattern is
 * applied to whole lines that survived. Line identity comes from the author's
 * newlines and from nowhere else, so no transformation exists that could invent
 * one. Construct classification is a separate, deliberately approximate layer:
 * when it skips too much, the missed declaration leaves `status:blocked` in
 * place and `report.mjs` says so under `holdWithoutReason`; it must never be
 * described as a complete CommonMark renderer.
 *
 * Four constructs hide a line, and the residual limits are stated exactly
 * rather than as a general assurance about "every form markdown offers" — the
 * documentation overclaimed in each of the three rounds, so it is enumerated
 * here and in `docs/AGENT_LOOP.md` and nowhere else:
 *
 * - **Fenced code**, opener length tracked, closing fence required to be at
 *   least as long and to carry nothing but trailing whitespace, per CommonMark.
 * - **An unterminated fence**, which CommonMark ends at the end of the
 *   document — so its tail is code and is hidden. This module can take that
 *   reading where `withoutCode` deliberately cannot: `linkedIssues` would lose
 *   the `Closes #<issue>` line after a stray fence in a pull request body,
 *   which fails **open** for that caller, whereas hiding the tail fails closed
 *   for this one.
 * - **HTML comments**, including multi-line and unterminated ones. A commented
 *   trailer renders as nothing at all, so reading it would let invisible text
 *   issue a label edit. For a multi-line comment, the closing line's tail is
 *   deliberately skipped too even though CommonMark renders that tail; this is
 *   a documented fail-closed missed declaration, not invisible text.
 * - **A multi-line inline code span**, approximated by `codeSpans`, which a code
 *   fence scanner alone does not see. Equal-length backtick runs pair across
 *   lines; an unmatched candidate is literal and scanning restarts at the next
 *   run. This is the subset needed to keep a rendered code line from declaring.
 *
 * Indented code and a leading backtick or `>` are the anchor's, not this
 * function's; see `TRAILER`.
 *
 * **The residual limit is this function's, not `codeSpans`'s**, and it is a
 * block boundary rather than an inline one. A paragraph ends here only at a
 * blank line or a fence, so a list item boundary and an ATX heading are both
 * invisible to it and a run either side of one can pair across it where GitHub
 * pairs nothing. Both are pinned in the test file and both hide more than the
 * renderer does, which is the fail-closed direction — but that is the state of
 * the evidence, not a proof that no fail-open case is left. Five consecutive
 * rounds wrote a sentence here promising more than the code did, and each was
 * falsified by the next review.
 *
 * The alternative weighed and rejected was to read the trailer only from the
 * body's last paragraph, the way Git trailers and this repository's own
 * `Migration-Removal-Ok:` convention work. It narrows the surface by
 * construction rather than by enumeration, and all five trailers on the board
 * are the last non-empty line of their
 * body, so nothing live would have stopped parsing on the day. It is rejected
 * on two counts. It does not replace this scan — a body whose pasted example is
 * the last thing in it puts a fenced trailer in the last paragraph — so it
 * would be a second rule on top, not instead. And it silently unparses a
 * declaration the moment anybody appends a note below it, which is the failure
 * the reviewer of round three named as worse than the hole: a declaration that
 * stops being read reports nothing to the operator who wrote it.
 *
 * @param {string} body
 * @returns {{ number: number, text: string }[]}
 */
const visibleLines = (body) => {
  /** @type {{ number: number, text: string }[]} */
  const visible = [];
  /** @type {string | null} */
  let fence = null;
  let inComment = false;
  /** @type {{ number: number, text: string }[]} */
  let paragraph = [];

  // A code span cannot contain a blank line, so a paragraph is the largest
  // region one can hide, and resolving them a paragraph at a time keeps an
  // unmatched backtick from reaching past the blank line below it.
  const flush = () => {
    if (paragraph.length === 0) return;

    const text = paragraph.map((line) => line.text).join("\n");
    const spans = codeSpans(text);
    let offset = 0;

    for (const line of paragraph) {
      const start = offset;
      offset += line.text.length + 1;

      if (spans.some((span) => span.start < start && start < span.end)) continue;

      visible.push(line);
    }

    paragraph = [];
  };

  let number = 0;

  for (const raw of String(body ?? "").split("\n")) {
    number += 1;
    // A CRLF body is the same document; the carriage return is not content.
    const text = raw.endsWith("\r") ? raw.slice(0, -1) : raw;

    if (fence !== null) {
      if (closesFence(text, fence)) fence = null;
      continue;
    }

    if (inComment) {
      // Deliberately skip the whole closing line. CommonMark renders text after
      // `-->`, so this may miss a live declaration; keeping the issue blocked is
      // the safer error than reconstructing a tail into an automated label edit.
      if (text.includes("-->")) inComment = false;
      continue;
    }

    const opener = text.match(FENCE_OPEN);

    if (opener !== null && !(opener[1][0] === "`" && opener[2].includes("`"))) {
      fence = opener[1];
      flush();
      continue;
    }

    // Complete comments on this line are removed before asking whether an
    // unterminated one opens; `<!-- note --> Blocked-By: #1` does not.
    const withoutComments = text.replace(/<!--[\s\S]*?-->/g, "");

    if (withoutComments.includes("<!--")) {
      inComment = true;
      // The text before `<!--` is visible, and a trailer may live in it.
      paragraph.push({ number, text: withoutComments.split("<!--")[0] });
      flush();
      continue;
    }

    if (withoutComments.trim() === "") {
      flush();
      continue;
    }

    paragraph.push({ number, text: withoutComments });
  }

  flush();

  return visible;
};

/**
 * The first informative line of a `gh` failure. `execFileSync` puts the useful
 * part on `stderr` and leaves `message` as the command line. Copied from
 * `lib/clear-status-labels.mjs` rather than shared, for the same reason that
 * one copied it: a two-line helper is cheaper duplicated than a module every
 * Rallypoint script has to import.
 *
 * @param {unknown} error
 */
export const describeError = (error) => {
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
 * @typedef {(
 *   | { kind: "absent" }
 *   | { kind: "declared", blockers: string[], line: string }
 *   | { kind: "unparseable", line: string | null, reason: string }
 * )} Declaration
 */

/**
 * The `Blocked-By:` declaration in an issue body.
 *
 * Three outcomes, and only `declared` can ever lead to a mutation. `absent` is
 * the common case and is silent — most `status:blocked` issues predate this
 * convention and several are held for reasons no trailer could express.
 * `unparseable` is reported and never acted on: a trailer somebody meant to
 * write and got wrong is the one case where guessing at intent would put a held
 * issue back in the pool.
 *
 * Two trailers are unparseable rather than merged. A second line is as likely
 * to be a stale copy as an addition, and "which of these two lists is the
 * blocker set" is not a question this module may answer by concatenation.
 *
 * The parser approximates the CommonMark constructs relevant to a declaration;
 * it is not a renderer. The named exclusions are fenced code (of any fence
 * length), an unterminated fence's tail, indented code, equal-run inline code
 * spans on one line or across several, HTML comments, and blockquotes.
 * `visibleLines` carries the block-level ones and `TRAILER`'s anchor the
 * line-leading ones. It also deliberately skips the visible tail on a
 * multi-line HTML comment's closing line. Every skipped live declaration fails
 * closed by leaving `status:blocked` in place, so this list describes the
 * approximation rather than promising equivalence with a CommonMark renderer.
 *
 * The reason any of it matters is that this repository quotes its own
 * conventions in the text it then parses, and `docs/AGENT_LOOP.md` documents
 * the trailer with an example any issue may paste. Left unstripped, a body
 * reading "held pending an operator ruling" plus that example resolved to
 * `action: "unblock"` and issued a real
 * `gh issue edit --remove-label status:blocked`, which
 * is the exact failure this module exists to prevent: a block cleared that
 * nobody cleared. No body on the board tripped any of the three holes, and the
 * fix was cheaper each time than the first body that would have.
 *
 * @param {string | null | undefined} body
 * @returns {Declaration}
 */
export const parseBlockedBy = (body) => {
  // `match` returns an array, so it is collected rather than flat-mapped: a
  // `flatMap` would spread each match's own capture groups into the list.
  const matches = visibleLines(String(body ?? ""))
    .map((line) => line.text.match(TRAILER))
    .filter((match) => match !== null);

  if (matches.length === 0) return { kind: "absent" };

  if (matches.length > 1) {
    return {
      kind: "unparseable",
      line: matches.map((match) => match[0].trim()).join(" / "),
      reason: `${matches.length} \`Blocked-By:\` lines are present; exactly one is expected, and merging them would guess at which list is current`,
    };
  }

  const line = matches[0][0].trim();
  const value = matches[0][1].trim();

  if (value === "") {
    return {
      kind: "unparseable",
      line,
      reason: "the `Blocked-By:` line names no issue",
    };
  }

  /** @type {string[]} */
  const blockers = [];
  /** @type {string[]} */
  const bad = [];

  for (const entry of value.split(",")) {
    const trimmed = entry.trim();
    const number = trimmed.match(/^#?(\d+)$/)?.[1];

    if (number === undefined) {
      bad.push(trimmed === "" ? "(empty entry)" : trimmed);
      continue;
    }

    if (!blockers.includes(number)) blockers.push(number);
  }

  if (bad.length > 0) {
    return {
      kind: "unparseable",
      line,
      reason: `${bad.map((entry) => `\`${entry}\``).join(", ")} is not an issue number; the trailer takes comma-separated \`#<number>\` entries only`,
    };
  }

  return { kind: "declared", blockers, line };
};

/**
 * @typedef {(
 *   | { state: "OPEN" | "CLOSED", pullRequests: number[] }
 *   | { state: "unknown", reason: string }
 * )} BlockerState
 */

/**
 * Each blocker's state, and the pull requests GitHub records as having closed
 * it, read one issue at a time.
 *
 * The closing pull requests come from `closedByPullRequestsReferences`, which
 * older `gh` builds do not offer. A field a `gh` cannot serve must not turn the
 * whole read into an unknown — that would fail the sweep closed on every host
 * with an older CLI — so the call is retried without it and the evidence
 * comment says the pull request was not recorded instead of naming one.
 *
 * A read that fails outright is `unknown`, never folded into "closed". This is
 * the module's whole safety property: an unreadable blocker holds the issue
 * exactly where it is.
 *
 * @param {{ gh: (...args: string[]) => string, blockers: string[] }} input
 * @returns {Map<string, BlockerState>}
 */
export const readBlockerStates = ({ gh, blockers }) => {
  /** @type {Map<string, BlockerState>} */
  const states = new Map();

  for (const blocker of blockers) {
    /** @type {{ state?: string, closedByPullRequestsReferences?: unknown } | null} */
    let details = null;
    /** @type {string | null} */
    let failure = null;

    try {
      details = JSON.parse(
        gh(
          "issue",
          "view",
          blocker,
          "--json",
          "state,closedByPullRequestsReferences",
        ),
      );
    } catch (error) {
      failure = describeError(error);

      try {
        details = JSON.parse(gh("issue", "view", blocker, "--json", "state"));
        failure = null;
      } catch (fallbackError) {
        failure = describeError(fallbackError);
      }
    }

    if (details === null) {
      states.set(blocker, {
        state: "unknown",
        reason: `\`gh issue view ${blocker}\` failed: ${failure ?? "no detail reported"}`,
      });
      continue;
    }

    const state = details.state;

    if (state !== "OPEN" && state !== "CLOSED") {
      states.set(blocker, {
        state: "unknown",
        reason: `#${blocker} reported state \`${String(state)}\`, which is neither OPEN nor CLOSED`,
      });
      continue;
    }

    const references = Array.isArray(details.closedByPullRequestsReferences)
      ? details.closedByPullRequestsReferences
      : [];

    states.set(blocker, {
      state,
      pullRequests: references.flatMap(
        (/** @type {{ number?: unknown }} */ reference) =>
          typeof reference?.number === "number" ? [reference.number] : [],
      ),
    });
  }

  return states;
};

/**
 * @typedef {{
 *   action: "unblock" | "veto" | "hold" | "skip" | "report",
 *   reason: string,
 *   blockers: string[],
 *   open: string[],
 *   unknown: string[],
 * }} Decision
 */

/**
 * Whether an issue's `status:blocked` may be cleared, from state already read.
 *
 * Ordered so that every fail-closed reason is reached before any reason to act.
 * `report` means a human should look and nothing is touched; `skip` and `hold`
 * are ordinary silence.
 *
 * @param {{
 *   issue: string,
 *   labels: unknown,
 *   declaration: Declaration,
 *   blockerStates: Map<string, BlockerState>,
 *   config: { labels: { blocked: string, human: string } },
 * }} input
 * @returns {Decision}
 */
export const resolveUnblock = ({
  issue,
  labels,
  declaration,
  blockerStates,
  config,
}) => {
  /** @type {Decision} */
  const base = { action: "skip", reason: "", blockers: [], open: [], unknown: [] };

  // Presence is decided from what was read, never inferred from a removal's own
  // failure — `close-referenced-issues.mjs`'s `restoreToQueue` states the same
  // rule. A payload that is not an array is not an empty one.
  if (!Array.isArray(labels)) {
    return {
      ...base,
      action: "report",
      reason: `#${issue}'s labels could not be read as a list, so whether it carries \`${config.labels.blocked}\` cannot be established.`,
    };
  }

  const names = labels.flatMap((label) =>
    typeof label?.name === "string" ? [label.name] : [],
  );

  if (!names.includes(config.labels.blocked)) {
    return {
      ...base,
      reason: `#${issue} does not carry \`${config.labels.blocked}\`.`,
    };
  }

  if (declaration.kind === "absent") {
    return {
      ...base,
      reason: `#${issue} carries no \`Blocked-By:\` trailer, so nothing establishes what blocks it; it is left alone.`,
    };
  }

  if (declaration.kind === "unparseable") {
    return {
      ...base,
      action: "report",
      reason: `#${issue}'s \`Blocked-By:\` trailer could not be parsed — ${declaration.reason}. The line reads \`${declaration.line}\`. Nothing was changed.`,
    };
  }

  const { blockers } = declaration;
  const unknown = blockers.filter(
    (blocker) => (blockerStates.get(blocker)?.state ?? "unknown") === "unknown",
  );

  if (unknown.length > 0) {
    return {
      ...base,
      action: "report",
      blockers,
      unknown,
      reason: `#${issue}'s blockers could not all be read (${unknown
        .map((blocker) => `#${blocker}`)
        .join(", ")}), so whether its trailer has cleared cannot be established. Nothing was changed.`,
    };
  }

  const open = blockers.filter(
    (blocker) => blockerStates.get(blocker)?.state === "OPEN",
  );

  if (open.length > 0) {
    return {
      ...base,
      action: "hold",
      blockers,
      open,
      reason: `#${issue} stays blocked: ${open
        .map((blocker) => `#${blocker}`)
        .join(", ")} of its \`Blocked-By:\` trailer ${open.length === 1 ? "is" : "are"} still open.`,
    };
  }

  if (names.includes(config.labels.human)) {
    return {
      ...base,
      action: "veto",
      blockers,
      reason: `#${issue}'s \`Blocked-By:\` trailer has cleared, but it carries \`${config.labels.human}\`, which holds it out of the pool regardless.`,
    };
  }

  return {
    ...base,
    action: "unblock",
    blockers,
    reason: `#${issue}'s \`Blocked-By:\` trailer has cleared; every issue it names is closed.`,
  };
};

/**
 * How one blocker reads in the evidence comment: the issue, and the pull
 * request GitHub records as having closed it where there is one.
 *
 * @param {{ blocker: string, state: BlockerState | undefined }} input
 * @returns {string}
 */
const describeBlocker = ({ blocker, state }) => {
  const pulls =
    state && state.state !== "unknown" ? state.pullRequests : [];

  return pulls.length === 0
    ? `#${blocker} (closed; no closing pull request recorded)`
    : `#${blocker} (closed by ${pulls.map((pull) => `#${pull}`).join(", ")})`;
};

/**
 * The comment posted when a trailer clears — every Rallypoint mutation leaves
 * its evidence on the issue, and this one has to name what it read, because the
 * next reader's question is always "which dependency, and how do you know".
 *
 * The vetoed wording says plainly that the issue is **not** back in the pool.
 * The old `close-referenced-issues.mjs` bug #935 fixed was a comment asserting a
 * requeue that had not happened; a comment here that read as a requeue would be
 * the same defect in a new place.
 *
 * @param {{
 *   issue: string,
 *   decision: Decision,
 *   blockerStates: Map<string, BlockerState>,
 *   config: { labels: { blocked: string, human: string } },
 * }} input
 * @returns {string}
 */
export const unblockComment = ({ issue, decision, blockerStates, config }) => {
  const evidence = decision.blockers.map(
    (blocker) => `- ${describeBlocker({ blocker, state: blockerStates.get(blocker) })}`,
  );

  if (decision.action === "veto") {
    return [
      BLOCKED_BY_MARKER,
      `**\`Blocked-By:\` cleared, and the issue is still held.** Every issue #${issue}'s trailer names is now closed:`,
      "",
      ...evidence,
      "",
      `\`${config.labels.blocked}\` was **not** removed because this issue carries \`${config.labels.human}\`. That label records a judgement an automated writer may not overrule, so the dependency clearing changes nothing about who may act next.`,
      "",
      `Whoever clears \`${config.labels.human}\` owns the requeue: remove it then. Claimability is derived from the absence of hold labels. This comment exists so the signal is not lost — the dependency this issue was waiting on has landed.`,
    ].join("\n");
  }

  return [
    BLOCKED_BY_MARKER,
    `**Unblocked.** Every issue #${issue}'s \`Blocked-By:\` trailer names is now closed:`,
    "",
    ...evidence,
    "",
    `\`${config.labels.blocked}\` removed, so \`claim.mjs\` can offer this issue again. Claimability is derived from the absence of hold labels. Nothing else about it was changed — no assignee was touched and no reservation was created.`,
    "",
    "If something still blocks this issue, add `status:blocked` back and say what in a `Blocked-By:` line; a trailer naming an open issue is never cleared.",
  ].join("\n");
};

/**
 * Whether this module has already commented on an issue. Only the veto path
 * needs it — see `BLOCKED_BY_MARKER`.
 *
 * @param {unknown} comments
 * @returns {boolean}
 */
export const alreadyCommented = (comments) =>
  Array.isArray(comments) &&
  comments.some((comment) =>
    String(comment?.body ?? "").includes(BLOCKED_BY_MARKER),
  );

/**
 * Performs a decision. Returns the exit code the decision maps to, so both
 * callers — the single-issue command and the sweep — agree on what each outcome
 * means without restating the mapping.
 *
 * The label edit goes first and the comment second, deliberately. A failure
 * between them leaves an issue that is genuinely queued with no comment saying
 * why, which a reader can still act on; the reverse leaves a comment asserting a
 * requeue that did not happen, which is #935's defect exactly.
 *
 * @param {{
 *   gh: (...args: string[]) => string,
 *   issue: string,
 *   decision: Decision,
 *   blockerStates: Map<string, BlockerState>,
 *   comments: unknown,
 *   config: { labels: { blocked: string, human: string } },
 *   dryRun?: boolean,
 *   stdout?: (line: string) => void,
 *   stderr?: (line: string) => void,
 * }} input
 * @returns {number}
 */
export const applyDecision = ({
  gh,
  issue,
  decision,
  blockerStates,
  comments,
  config,
  dryRun = false,
  stdout = console.log,
  stderr = console.error,
}) => {
  if (decision.action === "report") {
    stderr(decision.reason);
    return EXIT.inconclusive;
  }

  if (decision.action === "skip" || decision.action === "hold") {
    stdout(decision.reason);
    return EXIT.declined;
  }

  if (decision.action === "veto") {
    if (alreadyCommented(comments)) {
      stdout(
        `${decision.reason} A \`Blocked-By:\` comment is already on the issue, so nothing was posted again.`,
      );
      return EXIT.declined;
    }

    if (dryRun) {
      stdout(`Would comment on #${issue}: ${decision.reason}`);
      return EXIT.declined;
    }

    try {
      gh(
        "issue",
        "comment",
        issue,
        "--body",
        unblockComment({ issue, decision, blockerStates, config }),
      );
    } catch (error) {
      stderr(
        `Could not comment on #${issue} (${describeError(error)}). No label was changed.`,
      );
      return EXIT.editFailed;
    }

    stdout(decision.reason);
    return EXIT.declined;
  }

  if (dryRun) {
    stdout(
      `Would remove \`${config.labels.blocked}\` from #${issue}: ${decision.reason}`,
    );
    return EXIT.ok;
  }

  try {
    gh(
      "issue",
      "edit",
      issue,
      "--remove-label",
      config.labels.blocked,
    );
  } catch (error) {
    stderr(
      `Could not requeue #${issue} (${describeError(error)}). No comment was posted.`,
    );
    return EXIT.editFailed;
  }

  try {
    gh(
      "issue",
      "comment",
      issue,
      "--body",
      unblockComment({ issue, decision, blockerStates, config }),
    );
  } catch (error) {
    stderr(
      `#${issue} was requeued, but its evidence comment could not be posted (${describeError(error)}).`,
    );
    return EXIT.editFailed;
  }

  stdout(
    `Requeued #${issue}: removed \`${config.labels.blocked}\` (blockers ${decision.blockers
      .map((blocker) => `#${blocker}`)
      .join(", ")} are all closed).`,
  );
  return EXIT.ok;
};

/** @param {string[]} argv */
export const parseArgs = (argv) => {
  const index = argv.indexOf("--issue");
  return {
    issue: index === -1 ? undefined : argv[index + 1],
    dryRun: argv.includes("--dry-run"),
  };
};

/**
 * The single-issue command, `unblock-cleared.mjs`. `janitor-pass.mjs` offers it
 * every issue `report.mjs` classified as `blockedWithClearedDependencies`, and
 * it re-proves the condition itself against a fresh read rather than trusting a
 * survey that is already seconds old — the same shape `clear-status-labels.mjs`
 * follows for `closedWithStatusLabel`.
 *
 * @param {{
 *   argv: string[],
 *   gh: (...args: string[]) => string,
 *   config: { labels: { blocked: string, human: string } },
 *   stdout?: (line: string) => void,
 *   stderr?: (line: string) => void,
 * }} input
 * @returns {number} Process exit code.
 */
export const unblockCleared = ({
  argv,
  gh,
  config,
  stdout = console.log,
  stderr = console.error,
}) => {
  const { issue, dryRun } = parseArgs(argv);

  if (!issue) {
    stderr("Usage: unblock-cleared.mjs --issue <issue-number> [--dry-run]");
    return EXIT.usage;
  }

  /** @type {{ state?: string, labels?: unknown, body?: string, comments?: unknown } | null} */
  let details = null;

  try {
    details = JSON.parse(
      gh("issue", "view", issue, "--json", "state,labels,body,comments"),
    );
  } catch (error) {
    stderr(`#${issue} could not be read (${describeError(error)}).`);
    return EXIT.inconclusive;
  }

  if (details?.state !== "OPEN") {
    stdout(
      `#${issue} is ${String(details?.state ?? "unknown").toLowerCase()}; a closed issue has no queue entry to restore.`,
    );
    return EXIT.declined;
  }

  const declaration = parseBlockedBy(details.body);
  const blockerStates =
    declaration.kind === "declared"
      ? readBlockerStates({ gh, blockers: declaration.blockers })
      : new Map();

  const decision = resolveUnblock({
    issue,
    labels: details.labels,
    declaration,
    blockerStates,
    config,
  });

  return applyDecision({
    gh,
    issue,
    decision,
    blockerStates,
    comments: details.comments,
    config,
    dryRun,
    stdout,
    stderr,
  });
};

/**
 * Every open `status:blocked` issue, with the fields a decision needs.
 *
 * @param {{ gh: (...args: string[]) => string, config: { labels: { blocked: string } } }} input
 * @returns {{ ok: true, items: { number: number, labels?: unknown, body?: string, comments?: unknown }[] } | { ok: false, reason: string }}
 */
export const listBlockedIssues = ({ gh, config }) => {
  try {
    const parsed = JSON.parse(
      gh(
        "issue",
        "list",
        "--state",
        "open",
        "--label",
        config.labels.blocked,
        "--limit",
        "100",
        "--json",
        "number,labels,body,comments",
      ),
    );

    return Array.isArray(parsed)
      ? { ok: true, items: parsed }
      : {
          ok: false,
          reason: `\`gh issue list --label ${config.labels.blocked}\` returned no list`,
        };
  } catch (error) {
    return {
      ok: false,
      reason: `\`gh issue list --label ${config.labels.blocked}\` failed: ${describeError(error)}`,
    };
  }
};

/**
 * Sweeps the `status:blocked` board for trailers a set of just-closed issues
 * cleared. This is what `close-referenced-issues.mjs` runs on every push to the
 * integration branch, which is the path that catches the ordinary case: a
 * dependency closes on merge, and its dependents are claimable in the same
 * minute rather than whenever somebody next goes looking.
 *
 * Scoped to issues whose trailer actually names one of `closedIssues`. A merge
 * has no standing to requeue an issue it had nothing to do with, and the
 * unscoped sweep is `janitor-pass.mjs`'s job — a blocker closed by hand, as a
 * duplicate, or by GitHub's own keyword handling never passes through here at
 * all, which is exactly why that backstop exists.
 *
 * A failure on one issue never stops the rest: these are independent repairs,
 * not a pipeline.
 *
 * `unparseable` is returned **separately from `reported`**, because an
 * unparseable trailer is the one finding here that cannot be scoped. Every
 * other outcome is reached only for an issue whose trailer names something this
 * merge closed; a trailer that does not parse has no blocker list to compare
 * against, so it is noticed board-wide or not at all. Folding it into `reported`
 * made `close-referenced-issues.mjs` exit non-zero on every push to the
 * integration branch for as long as one typo sat anywhere on the board — and
 * that exit code is the operator's only signal that the closing and reservation
 * cleanup this script exists for actually worked, currently read by hand after
 * every merge while the workflow is down. A permanent red for an unrelated
 * issue's typo is a signal nobody can read. It is still written to `stderr`, and
 * `report.mjs` surfaces it as an unknown, which is where a board-wide finding
 * belongs.
 *
 * @param {{
 *   gh: (...args: string[]) => string,
 *   config: { labels: { blocked: string, human: string } },
 *   closedIssues: string[],
 *   stdout?: (line: string) => void,
 *   stderr?: (line: string) => void,
 * }} input
 * @returns {{ requeued: string[], reported: string[], unparseable: string[], failed: string[] }}
 */
export const sweepClearedBlockers = ({
  gh,
  config,
  closedIssues,
  stdout = console.log,
  stderr = console.error,
}) => {
  /** @type {{ requeued: string[], reported: string[], unparseable: string[], failed: string[] }} */
  const outcome = { requeued: [], reported: [], unparseable: [], failed: [] };

  if (closedIssues.length === 0) return outcome;

  const listed = listBlockedIssues({ gh, config });

  if (!listed.ok) {
    stderr(
      `Could not sweep \`${config.labels.blocked}\` issues for cleared \`Blocked-By:\` trailers: ${listed.reason}`,
    );
    outcome.failed.push("listing");
    return outcome;
  }

  for (const item of listed.items) {
    const issue = String(item.number);
    const declaration = parseBlockedBy(item.body);

    if (declaration.kind === "unparseable") {
      stderr(
        `#${issue}'s \`Blocked-By:\` trailer could not be parsed — ${declaration.reason}. The line reads \`${declaration.line}\`. Nothing was changed.`,
      );
      outcome.unparseable.push(issue);
      continue;
    }

    if (declaration.kind === "absent") continue;

    if (!declaration.blockers.some((blocker) => closedIssues.includes(blocker))) {
      continue;
    }

    try {
      const blockerStates = readBlockerStates({
        gh,
        blockers: declaration.blockers,
      });
      const decision = resolveUnblock({
        issue,
        labels: item.labels,
        declaration,
        blockerStates,
        config,
      });
      const code = applyDecision({
        gh,
        issue,
        decision,
        blockerStates,
        comments: item.comments,
        config,
        stdout,
        stderr,
      });

      if (code === EXIT.ok) outcome.requeued.push(issue);
      else if (code === EXIT.inconclusive) outcome.reported.push(issue);
      else if (code === EXIT.editFailed) outcome.failed.push(issue);
    } catch (error) {
      stderr(
        `Could not evaluate #${issue}'s \`Blocked-By:\` trailer: ${describeError(error)}`,
      );
      outcome.failed.push(issue);
    }
  }

  return outcome;
};

export default unblockCleared;
