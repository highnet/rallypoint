// What GitHub's own closing-keyword parser would link for auto-close, set
// against what this loop *declares* a pull request closes.
//
// `provenance.mjs`'s `CLOSING_KEYWORD` is anchored to the start of a line on
// purpose: it is the loop's declaration format, and the anchor is what keeps a
// sentence of prose from being read as a declaration. GitHub's parser has no
// anchor and no notion of context. It scans the pull request body and the
// message of every commit in the pull request for a keyword followed by a
// number, wherever in the text that pair appears — so a sentence stating that a
// pull request deliberately leaves an issue open links that issue for
// auto-close anyway, and a commit message narrating a closure somebody else
// performed months ago links that one too.
//
// The two models disagree, and without something like this module nothing in a
// repository can see the disagreement. Left unseen, the gap silently reverses
// operator decisions: an issue reopened minutes earlier under a `needs:human`
// hold gets re-closed by an unrelated merge, on the strength of one sentence in
// a commit message describing a hand-close somebody performed long before — and
// the issue's claim reservation is stranded behind it.
//
// **This is deliberately a second parser, which anywhere else in this directory
// would be the defect.** `provenance.mjs`'s header, `close-referenced-issues.mjs`,
// and `preflight.mjs` all argue that a duplicated predicate drifts from the one
// that actually decides. That argument holds when the two are meant to agree.
// Here the disagreement *is* the measurement: `linkedIssues` models what the
// author declared, this models what GitHub will do, and the check is that the
// second contains nothing the first does not. One parser cannot answer that
// question, because a single parser is by construction always consistent with
// itself.
//
// Non-goals, stated so nobody reads more into a pass than is there:
//
//   - Cross-repository references (`owner/repo#<n>`) and full issue URLs are
//     not matched. GitHub honours both. Nothing in this repository's protocol
//     prose has ever used either form, and matching them would mean deciding
//     which repository a bare number belongs to.
//   - Whether GitHub links a reference inside a fenced or inline code span is
//     inferred from how its markdown renderer treats autolinks, not from
//     documentation that promises it. The body is scanned with those regions
//     blanked; a commit message is scanned whole, because a commit message is
//     not rendered as markdown at all.
//   - A pull request title is not scanned, because GitHub does not scan one.

/**
 * GitHub's closing keywords, matched anywhere in the text rather than at the
 * start of a line. The optional colon covers `Fixes: #<n>`, which GitHub
 * accepts and this repository's documented form does not use — a detector may
 * be more permissive than the thing it detects, never less.
 *
 * `\b` before the keyword so `unclosed #<n>` and `prefixes #<n>` do not match;
 * `\b` after the number so `#12` does not match inside `#123`.
 */
export const GITHUB_CLOSING_KEYWORD =
  /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)[^\S\n]*:?[^\S\n]+#(\d+)\b/gi;

/**
 * Fenced blocks and inline code spans blanked, for text GitHub renders as
 * markdown. Mirrors `provenance.mjs`'s `withoutCode` for fences and extends it
 * to inline spans: this repository's pull request bodies routinely quote the
 * `Closes #<issue>` convention inline, and counting those would make the check
 * fire on every body that explains itself.
 *
 * @param {string | null | undefined} text
 */
const withoutCode = (text) =>
  (text ?? "")
    .replace(/^[^\S\n]*(```|~~~)[\s\S]*?^[^\S\n]*\1/gm, "")
    .replace(/(`+)[^`\n]*?\1/g, "");

/**
 * Every issue number GitHub's parser would link for auto-close in one piece of
 * text.
 *
 * @param {string | null | undefined} text
 * @param {{ markdown?: boolean }} [options] `markdown: true` for a pull request
 *   body, which GitHub renders; leave it false for a commit message, which it
 *   does not.
 * @returns {string[]}
 */
export const githubClosedIssues = (text, { markdown = false } = {}) => [
  ...new Set(
    [
      ...(markdown ? withoutCode(text) : (text ?? "")).matchAll(
        GITHUB_CLOSING_KEYWORD,
      ),
    ].map((match) => match[1]),
  ),
];

/**
 * @typedef {{ kind: "body" }
 *   | { kind: "commit", sha: string, subject: string }} ClosureSource
 */

/**
 * Which issues GitHub would close that the author never declared, and where
 * each one comes from.
 *
 * `declared` is the loop's own answer — `linkedIssues(body)` — not a set the
 * caller composes by hand, so what this reports is exactly the divergence
 * between the two models and nothing else. An issue reached by both a declared
 * line and a stray sentence is not reported: GitHub closing it is what the
 * author asked for.
 *
 * Sources are collected rather than counted because the remedy differs by
 * source. A body can be edited after the pull request is open; a commit message
 * on a pushed branch effectively cannot, so a commit-sourced match is the one
 * that has to be caught before the pull request exists.
 *
 * @param {{
 *   body?: string | null,
 *   declared: string[],
 *   commits?: { sha: string, message: string }[],
 * }} input
 * @returns {{ issue: string, sources: ClosureSource[] }[]}
 */
export const closureDrift = ({ body, declared, commits = [] }) => {
  const known = new Set(declared);
  /** @type {Map<string, ClosureSource[]>} */
  const found = new Map();

  /**
   * @param {string} issue
   * @param {ClosureSource} source
   */
  const record = (issue, source) => {
    if (known.has(issue)) return;
    found.set(issue, [...(found.get(issue) ?? []), source]);
  };

  for (const issue of githubClosedIssues(body, { markdown: true })) {
    record(issue, { kind: "body" });
  }

  for (const commit of commits) {
    for (const issue of githubClosedIssues(commit.message)) {
      record(issue, {
        kind: "commit",
        sha: commit.sha,
        subject: commit.message.split("\n", 1)[0] ?? "",
      });
    }
  }

  return [...found.entries()]
    .map(([issue, sources]) => ({ issue, sources }))
    .sort((a, b) => Number(a.issue) - Number(b.issue));
};

/**
 * The refusal text for a drift result.
 *
 * There is deliberately **no escape hatch** — no pragma, no trailer, nothing of
 * the shape `Migration-Removal-Ok:` or `// supabase-audit-ok:`. Those hatches
 * work because the thing they suppress is a *guess* about consequences a human
 * can overrule with better information. This one is not a guess: GitHub will
 * close the issue, and asserting in writing that it is fine does not stop it.
 * The only remedy that changes the outcome is changing the text, so the only
 * remedy offered is changing the text.
 *
 * @param {ReturnType<typeof closureDrift>} drift
 * @param {{ declared: string[] }} input
 * @returns {string}
 */
export const closureDriftMessage = (drift, { declared }) => {
  const lines = [
    "GitHub's closing-keyword parser would close " +
      `${drift.map((entry) => `#${entry.issue}`).join(", ")} on merge, which ` +
      (declared.length
        ? `this pull request does not declare (it declares ${declared.map((issue) => `#${issue}`).join(", ")}).`
        : "this pull request declares nothing about."),
    "",
    "GitHub matches a closing keyword followed by an issue number anywhere in " +
      "the text — in the middle of a sentence, and in a sentence whose meaning " +
      "is that the issue stays open. It scans the pull request body and the " +
      "message of every commit in the pull request.",
    "",
  ];

  for (const entry of drift) {
    lines.push(`#${entry.issue}:`);

    for (const source of entry.sources) {
      lines.push(
        source.kind === "body"
          ? "  - the prepared pull request body"
          : `  - commit ${source.sha.slice(0, 8)} ${source.subject}`,
      );
    }
  }

  lines.push(
    "",
    "Reword so the keyword and the number are not adjacent. `issue 34`, " +
      "`#34 was closed`, and a bracketed `[#34]` all say the same thing and " +
      "none of them matches. If the closure is intended, declare it instead " +
      "with its own closing line at the start of a line in the body.",
    "",
    "A commit message on a pushed branch cannot be edited without rewriting " +
      "the branch, so a commit-sourced match is cheapest to fix now: " +
      "`git rebase -i` the message, force-push with `--force-with-lease`, and " +
      "run this again. There is no pragma to suppress this — GitHub closes the " +
      "issue whatever anybody writes about it here.",
  );

  return lines.join("\n");
};

/**
 * GitHub's own answer for a pull request that already exists, compared against
 * what the author declares.
 *
 * Advisory, never a refusal, and the asymmetry is the reason: this reads the
 * body **already on the pull request**, while `--body` is the body the session
 * is about to use. The two differ by exactly the edit being prepared, so a
 * difference here is as likely to be the fix in progress as a defect. What it
 * is good for is the case the local model cannot see at all — a form of
 * reference this module deliberately does not match, or a change in GitHub's
 * parser — reported by GitHub itself rather than inferred.
 *
 * @param {{ declared: string[], github: string[] }} input
 * @returns {{ extra: string[], missing: string[] }} `extra` is what GitHub
 *   links and the prepared body does not declare; `missing` is the reverse.
 */
export const closingReferenceDivergence = ({ declared, github }) => {
  const declaredSet = new Set(declared);
  const githubSet = new Set(github);

  return {
    extra: github.filter((issue) => !declaredSet.has(issue)),
    missing: declared.filter((issue) => !githubSet.has(issue)),
  };
};

export default closureDrift;
