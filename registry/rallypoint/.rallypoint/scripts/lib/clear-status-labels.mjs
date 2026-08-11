// Clears stale `status:*` labels off a closed issue, with every call to `gh`
// injected.
//
// `report.mjs`'s survey only ever lists open issues, so a closed issue
// that never passed through `claim.mjs` — because a pull request closed it
// natively with `Closes #<issue>` — keeps whatever `status:*` label it last
// carried forever. The concrete case this fixes is an issue that closed with
// a stale status label still on it. This command is the repair `report.mjs` names in
// its `closedWithStatusLabel` detail; it never decides eligibility on its
// own — see the refusal below, the same shape as `cleanup.mjs`'s.

// Exit codes are a public interface, as they are for `cleanup.mjs`,
// `release-claim.mjs`, and `review.mjs`. Keep them in sync with the table in
// docs/AGENT_LOOP.md.
export const EXIT = {
  ok: 0,
  usage: 1,
  notClosed: 2,
  inconclusive: 3, // labels could not be read; no removal attempted
  removeFailed: 4, // at least one label was confirmed present but failed to clear
};

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

/** @param {string[]} argv */
export const parseArgs = (argv) => {
  const index = argv.indexOf("--issue");
  return {
    issue: index === -1 ? undefined : argv[index + 1],
    dryRun: argv.includes("--dry-run"),
  };
};

/**
 * The `status:*` labels among `labels`, in the order they were given — never
 * a hardcoded label set, so a label added to `config.labels` later is covered
 * without editing this file, the same reasoning `report.mjs`'s own
 * `startsWith("status:")` check follows.
 *
 * @param {{ name?: string }[]} labels
 * @returns {string[]}
 */
export const staleLabels = (labels) =>
  labels.flatMap((label) =>
    typeof label?.name === "string" && label.name.startsWith("status:")
      ? [label.name]
      : [],
  );

/**
 * @param {{
 *   argv: string[],
 *   gh: (...args: string[]) => string,
 *   stdout?: (line: string) => void,
 *   stderr?: (line: string) => void,
 * }} input
 * @returns {number} Process exit code.
 */
export const clearStatusLabels = ({
  argv,
  gh,
  stdout = console.log,
  stderr = console.error,
}) => {
  const { issue, dryRun } = parseArgs(argv);

  if (!issue) {
    stderr("Usage: clear-status-labels.mjs --issue <closed-issue-number> [--dry-run]");
    return EXIT.usage;
  }

  /** @type {{ state?: string, labels?: { name?: string }[] } | null} */
  let details = null;

  try {
    details = JSON.parse(
      gh("issue", "view", issue, "--json", "state,labels"),
    );
  } catch (error) {
    stderr(`#${issue}'s state and labels could not be read (${describeError(error)}).`);
    return EXIT.inconclusive;
  }

  const state = details?.state;

  if (state !== "CLOSED") {
    stderr(`Issue #${issue} is ${String(state ?? "unknown").toLowerCase()}; labels preserved.`);
    return EXIT.notClosed;
  }

  const labels = Array.isArray(details?.labels) ? details.labels : null;

  if (labels === null) {
    stderr(`#${issue}'s labels could not be read as a list. No removal was attempted.`);
    return EXIT.inconclusive;
  }

  const stale = staleLabels(labels);

  if (stale.length === 0) {
    stdout(`#${issue} carries no status:* label; already clean.`);
    return EXIT.ok;
  }

  if (dryRun) {
    stdout(
      `Would remove ${stale.map((name) => `\`${name}\``).join(", ")} from closed issue #${issue}.`,
    );
    return EXIT.ok;
  }

  const failures = [];

  for (const label of stale) {
    try {
      gh("issue", "edit", issue, "--remove-label", label);
    } catch (error) {
      failures.push(`\`${label}\` (${describeError(error)})`);
    }
  }

  if (failures.length > 0) {
    stderr(`Could not remove every stale label from #${issue}: ${failures.join(", ")}.`);
    return EXIT.removeFailed;
  }

  stdout(
    `Removed ${stale.map((name) => `\`${name}\``).join(", ")} from closed issue #${issue}.`,
  );
  return EXIT.ok;
};

export default clearStatusLabels;
