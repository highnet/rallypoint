#!/usr/bin/env node

// One janitor pass, as one command.
//
// `janitor.md` used to specify four separate invocations — `report.mjs`,
// `release-claim.mjs`, `cleanup.mjs`, `lease.mjs --sweep` — with nothing
// verifying that all four ran. On 2026-08-03 they did not: session
// `rp-janitor-20260803b` held `refs/heads/rallypoint-sessions/janitor` from
// 17:19:55Z while three leases sat `targetGone` (`pr-888-merger`,
// `pr-888-reviewer`, `pr-892-reviewer`), every one of them deletable by the
// sweep step. A pass ran and a step was skipped, and the only way to notice was
// to read the next report by hand.
//
// A checklist that is followed four times out of five is a checklist that
// silently drops a fifth of the maintenance. This makes the pass mechanical:
// one command, every step, each step's exit code reported. Priority labels are
// audited here too: the rubric is only authoritative while every open issue
// carries exactly one of them.
//
// Two properties matter more than tidiness:
//
// - **A failing step does not abort the rest.** The steps are independent
//   maintenance, not a pipeline: a stale claim that cannot be released is no
//   reason to leave dead leases behind. Every step runs, and the pass reports
//   the worst outcome at the end.
// - **Nothing here decides eligibility.** It dispatches to the commands that
//   already prove it, and each keeps its own refusals and exit codes. This
//   file must never grow a rule of its own about when a claim is stale — that
//   judgement lives in `release-claim.mjs`, which refuses rather than guesses.
//
// `--dry-run` is passed through to every step that has one, so a whole pass can
// be previewed before any of it is performed.

import { spawnSync } from "node:child_process";
import process from "node:process";
import { fileURLToPath } from "node:url";

export const EXIT = {
  ok: 0,
  usage: 1,
  incomplete: 2, // at least one step did not complete cleanly
};

const USAGE = "Usage: janitor-pass.mjs --agent-id <id> [--dry-run]";

/**
 * An empty or flag-shaped agent id is a usage error here, not something to pass
 * along. `release-claim.mjs` drops an empty `--agent-id` value and exits `1`,
 * which is outside this pass's tolerated set, so every issue in the survey
 * would fail in turn and print a usage banner. Catching it once is the whole
 * fix. `--agent-id --dry-run` is the same mistake wearing a value.
 *
 * @param {string[]} argv
 */
export const parseArgs = (argv) => {
  const dryRun = argv.includes("--dry-run");
  const at = argv.indexOf("--agent-id");
  const value = at === -1 ? undefined : argv[at + 1];
  const agentId =
    value === undefined || value === "" || value.startsWith("-")
      ? null
      : value;
  const rest = argv.filter(
    (candidate, index) =>
      candidate !== "--dry-run" && index !== at && index !== at + 1,
  );

  return { dryRun, agentId, ok: agentId !== null && rest.length === 0 };
};

/**
 * The issues a pass should *offer* to `release-claim.mjs`, from a
 * `report.mjs --json` survey.
 *
 * Offer, not release: this list is deliberately wider than the set that will
 * actually be released, because the command proves eligibility itself and
 * refuses harmlessly when a claim is not releasable. Deciding here which of
 * them qualifies would put a second copy of that rule in the repository, and
 * `provenance.mjs` already records how those copies drift apart.
 *
 * Two sources feed it:
 *
 * - `claimCandidates` — every `status:claimed` issue with no open pull request,
 *   whatever its age. Wider than the report's own `janitorCandidate` list on
 *   purpose: a session that claims, pushes, merges, and ends inside the window
 *   is releasable on settled-pull-request grounds while the age-based
 *   classification would never nominate it.
 * - `unclaimable` — an orphaned reservation on an issue that was moved to
 *   `status:blocked` without releasing it.
 *
 * Everything else the report classifies is deliberately not acted on:
 * `unreservedWithOpenPr` and `unclaimedWithOpenPr` take no janitor action at
 * all, and `stranded` is refused by the command by design so the fix stays
 * auditable. `wouldFailRecord` is likewise inert here: its recovery is
 * an edit to a pull request body, which is authoring work rather than
 * coordination-state repair.
 *
 * @param {{
 *   disagreements?: { kind?: string, issue?: string }[],
 *   claimCandidates?: string[],
 * }} survey
 * @returns {string[]}
 */
export const releasableIssues = (survey) => [
  ...new Set([
    ...(survey.claimCandidates ?? []),
    ...(survey.disagreements ?? [])
      .filter((item) => item.kind === "unclaimable")
      .flatMap((item) => (item.issue === undefined ? [] : [item.issue])),
  ]),
];

/**
 * `report.mjs` remains the read-only nominator for stale assignees.
 * The release command re-reads the issue and proves the reservation ref absent
 * before it mutates anything; including every drift here deliberately avoids a
 * second, weaker copy of that eligibility rule in the pass.
 *
 * @param {{ disagreements?: { kind?: string, issue?: string }[] }} survey
 * @returns {string[]}
 */
export const staleAssigneeIssues = (survey) => [
  ...new Set(
    (survey.disagreements ?? [])
      .filter((item) => item.kind === "assigneeDrift")
      .flatMap((item) => (item.issue === undefined ? [] : [item.issue])),
  ),
];

/**
 * Cleared dependency holds nominated by the read-only report.
 * @param {{ disagreements?: { kind?: string, issue?: string }[] }} survey
 * @returns {string[]}
 */
export const clearedBlockerIssues = (survey) => [
  ...new Set(
    (survey.disagreements ?? [])
      .filter((item) => item.kind === "blockedWithClearedDependencies")
      .flatMap((item) => (item.issue === undefined ? [] : [item.issue])),
  ),
];

/**
 * The issues whose reservation `cleanup.mjs` should be offered.
 *
 * `cleanup.mjs` takes one closed issue at a time rather than sweeping, and the
 * survey does not report issue state directly — but an `unclaimable`
 * reservation is precisely one whose issue does not carry `status:claimed`,
 * which is the shape a closed issue leaves behind. Offering it the whole set
 * and letting it refuse an open one with its own `notClosed` exit keeps the
 * "is this closed" judgement in the command that already makes it.
 *
 * @param {{ disagreements?: { kind?: string, issue?: string }[] }} survey
 * @returns {string[]}
 */
export const cleanableIssues = (survey) => [
  ...new Set(
    (survey.disagreements ?? [])
      .filter((item) => item.kind === "unclaimable")
      .flatMap((item) => (item.issue === undefined ? [] : [item.issue])),
  ),
];

/**
 * Closed issues the survey found still carrying a stale `status:*` label
 * — `report.mjs`'s `closedWithStatusLabel` classification. Unlike
 * `cleanableIssues` above, this needs no cross-check against another source:
 * `classify` only ever emits this kind for an issue GitHub itself reports as
 * closed, so there is nothing here for a second command to confirm.
 *
 * @param {{ disagreements?: { kind?: string, issue?: string }[] }} survey
 * @returns {string[]}
 */
export const staleClosedLabelIssues = (survey) => [
  ...new Set(
    (survey.disagreements ?? [])
      .filter((item) => item.kind === "closedWithStatusLabel")
      .flatMap((item) => (item.issue === undefined ? [] : [item.issue])),
  ),
];

/**
 * @param {{
 *   steps: { name: string, code: number | null, tolerated?: number[] }[],
 * }} input
 * @returns {number}
 */
export const passExit = ({ steps }) =>
  steps.every((step) => step.code === 0 || (step.tolerated ?? []).includes(step.code ?? -1))
    ? EXIT.ok
    : EXIT.incomplete;

/**
 * @param {{
 *   argv: string[],
 *   run?: (script: string, args: string[]) => { code: number | null, stdout: string },
 *   stdout?: (line: string) => void,
 *   stderr?: (line: string) => void,
 * }} input
 * @returns {number} Process exit code.
 */
export const janitorPass = ({
  argv,
  run = defaultRun,
  stdout = console.log,
  stderr = console.error,
}) => {
  const args = parseArgs(argv);

  if (!args.ok) {
    stderr(USAGE);
    return EXIT.usage;
  }

  const dry = args.dryRun ? ["--dry-run"] : [];
  /** @type {{ name: string, code: number | null, tolerated?: number[] }[]} */
  const steps = [];

  /**
   * @param {string} name
   * @param {string} script
   * @param {string[]} scriptArgs
   * @param {number[]} [tolerated] Exit codes that are an outcome, not a fault.
   */
  const step = (name, script, scriptArgs, tolerated = []) => {
    const { code, stdout: output } = run(script, scriptArgs);
    stdout(`\n## ${name} (exit ${code})\n`);
    if (output.trim() !== "") stdout(output.trimEnd());
    steps.push({ name, code, tolerated });
    return { code, output };
  };

  // 1. Survey. `--json` because the release step below acts on the
  //    classifications; the prose form is for a human reading the same pass.
  //    Exit 2 is "disagreements found", which is the normal reason to run a
  //    pass at all, and 3 is "a source could not be read" — both are findings,
  //    not failures of the step.
  const survey = step("Coordination state", "report.mjs", ["--json"], [2, 3]);

  /** @type {{ disagreements?: { kind?: string, issue?: string }[] }} */
  let parsed = {};

  try {
    parsed = JSON.parse(survey.output);
  } catch {
    stderr(
      "The survey could not be parsed, so no claim release was attempted. The remaining steps still run.",
    );
    steps.push({ name: "Survey parse", code: 1 });
  }

  // 2. Release what the survey says is releasable. Every refusal code is
  //    tolerated: the command proves eligibility itself and refusing is the
  //    correct outcome for a claim that is not releasable yet. Only a code
  //    outside that set — a reservation that would not go (6), or a half-done
  //    release (7) — is a fault a pass should report.
  const releaseIssues = releasableIssues(parsed);

  for (const issue of releaseIssues) {
    step(
      `Release claim on #${issue}`,
      "release-claim.mjs",
      // `args.ok` above guarantees a non-empty, non-flag id; the fallback is
      // only here to satisfy the type, and an empty one can no longer reach it.
      ["--issue", issue, "--agent-id", args.agentId ?? "", ...dry],
      [2, 3, 4, 5],
    );
  }

  // 3. Assignees left after their claim reservation disappeared.
  //    The survey only offers the disagreement. `release-claim.mjs` uses the
  //    same exact-ref lookup as every other release path and acts immediately
  //    only when that ref is established absent. A live ref (exit 3) or an
  //    already-clean issue (exit 2) is a harmless refusal; unreadable evidence
  //    and a failed edit keep the pass visibly incomplete.
  for (const issue of staleAssigneeIssues(parsed).filter(
    (issue) => !releaseIssues.includes(issue),
  )) {
    step(
      `Stale assignee on #${issue}`,
      "release-claim.mjs",
      ["--issue", issue, "--agent-id", args.agentId ?? "", ...dry],
      [2, 3, 4, 5],
    );
  }

  // Cleared dependency holds. The command re-reads the body, labels, blockers,
  // and needs:human veto; the survey only nominates candidates.
  for (const issue of clearedBlockerIssues(parsed)) {
    step(
      `Cleared blockers on #${issue}`,
      "unblock-cleared.mjs",
      ["--issue", issue, ...dry],
      [2],
    );
  }

  // 4. Reservation refs for issues that are already closed. Exit 2 is
  //    `notClosed` — the issue is still open, so there is nothing here for this
  //    command — and 3 is a presence it could not establish. Both are the
  //    command declining, not failing.
  //
  //    `cleanup.mjs` has no `--dry-run`, and its argument parser reads only
  //    `--issue` and ignores everything else, so passing the flag through would
  //    not preview the delete — it would perform it. A dry run says what it
  //    would have offered instead.
  for (const issue of cleanableIssues(parsed)) {
    if (args.dryRun) {
      stdout(
        `\n## Closed-issue reservation for #${issue} (skipped)\n\nWould offer #${issue} to \`cleanup.mjs\`, which has no --dry-run of its own.`,
      );
      continue;
    }

    step(
      `Closed-issue reservation for #${issue}`,
      "cleanup.mjs",
      ["--issue", issue],
      [2, 3],
    );
  }

  // 5. Stale status:* labels left on issues that closed without passing
  //    through the claim protocol. `clearStatusLabels` re-confirms the
  //    issue is closed and re-reads its labels itself before touching
  //    anything, so an issue reopened between the survey and this step is
  //    refused with `notClosed` rather than acted on against a survey that is
  //    already stale.
  for (const issue of staleClosedLabelIssues(parsed)) {
    step(
      `Stale status label on closed #${issue}`,
      "clear-status-labels.mjs",
      ["--issue", issue, ...dry],
      [2, 3],
    );
  }

  // 6. Session leases whose target is gone or whose TTL has passed. Last
  //    because it is the step most easily forgotten when a pass is run as
  //    separate commands by hand, which is the whole reason this file exists.
  step("Session leases", "lease.mjs", ["--sweep", ...dry]);

  const code = passExit({ steps });

  stdout(`\n## Pass summary\n`);
  for (const { name, code: stepCode } of steps) {
    stdout(`- ${name}: exit ${stepCode}`);
  }
  stdout(
    code === EXIT.ok
      ? "\nEvery step completed."
      : "\nAt least one step did not complete cleanly; see its output above.",
  );

  return code;
};

/**
 * @param {string} script
 * @param {string[]} args
 */
const defaultRun = (script, args) => {
  const result = spawnSync(
    process.execPath,
    [fileURLToPath(new URL(script, import.meta.url)), ...args],
    { encoding: "utf8" },
  );

  return {
    code: result.status,
    stdout: `${result.stdout ?? ""}${result.stderr ?? ""}`,
  };
};

const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === new URL(`file://${process.argv[1]}`).href;

if (invokedDirectly) {
  process.exit(janitorPass({ argv: process.argv.slice(2) }));
}

export default janitorPass;
