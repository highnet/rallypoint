// Validation for `.rallypoint/config.json`.
//
// The reservation ref is the only mutual exclusion primitive the loop has when
// several agent sessions share one GitHub identity, and its name comes entirely
// from this file. A config that names refs badly does not fail loudly — it fails
// as two agents claiming one issue, which looks like a coordination accident
// rather than a configuration error.

// `deferred` joined this list when `task` and `ready` left it. The
// claimable pool is now the *absence* of a hold label, so every hold label is
// load-bearing in a way it was not before: a missing `labels.deferred` would
// not narrow the pool, it would silently widen it to include work somebody
// deliberately postponed.
const REQUIRED_LABELS = [
  "claimed",
  "blocked",
  "deferred",
  "human",
  "approved",
];

/**
 * @param {unknown} value
 * @returns {value is string}
 */
const isNonEmptyString = (value) =>
  typeof value === "string" && value.trim() !== "";

// Mirrors the ref-name constraints enforced by `git check-ref-format` without
// spawning Git during config loading. Prefixes are checked after appending the
// safe suffix their callers add, while still rejecting a raw trailing dot or
// `.lock` that the suffix could otherwise conceal.
/**
 * @param {string} value
 * @param {string} [suffix]
 */
const isGitRefPath = (value, suffix = "") => {
  if (!isNonEmptyString(value)) return false;
  if (value.endsWith(".") || value.endsWith(".lock")) return false;

  const ref = `${value}${suffix}`;

  if (
    ref === "@" ||
    ref.startsWith("/") ||
    ref.endsWith("/") ||
    ref.includes("//") ||
    ref.includes("..") ||
    ref.includes("@{") ||
    /[\u0000-\u0020\u007f~^:?*[\]\\]/u.test(ref)
  ) {
    return false;
  }

  return ref
    .split("/")
    .every(
      (component) =>
        component !== "" &&
        !component.startsWith(".") &&
        !component.endsWith(".lock"),
    );
};

/**
 * @param {unknown} config Parsed `config.json`.
 * @returns {{ ok: true } | { ok: false, problems: string[] }}
 */
export const validateConfig = (config) => {
  const problems = [];

  if (typeof config !== "object" || config === null) {
    return { ok: false, problems: ["Config must be an object."] };
  }

  const {
    integrationBranch,
    promotionBranch,
    promotionSnapshotPrefix,
    branchPrefix,
    claimRefPrefix,
    sessionRefPrefix,
    labels,
  } = /** @type {Record<string, unknown>} */ (config);

  if (!isNonEmptyString(integrationBranch)) {
    problems.push("`integrationBranch` must be a non-empty string.");
  } else if (
    integrationBranch.startsWith("-") ||
    !isGitRefPath(integrationBranch)
  ) {
    problems.push("`integrationBranch` is not a valid Git branch name.");
  }

  // Optional: absent means one integration tier, and `integrationBranch` is
  // what promotes into the default branch. Present and malformed is worth
  // rejecting, because `verify-promotion-source.mjs` would compare the head
  // against a branch name that can never match and report every promotion as
  // unapproved.
  if (promotionBranch !== undefined) {
    if (!isNonEmptyString(promotionBranch)) {
      problems.push(
        "`promotionBranch` must be a non-empty string when present.",
      );
    } else if (
      promotionBranch.startsWith("-") ||
      !isGitRefPath(promotionBranch)
    ) {
      problems.push("`promotionBranch` is not a valid Git branch name.");
    }
  }

  // Optional: absent means `provenance.mjs` falls back to its built-in
  // `promotion/`, so an older config keeps working unchanged. Present and
  // malformed is worth rejecting for the same reason as `promotionBranch` above
  // — `isPromotionBranch` would then refuse every snapshot promotion as an
  // ordinary agent pull request with no claim, and `review.mjs` would call it
  // unidentifiable rather than saying the configuration is wrong.
  //
  // The overlap rule below is a **security** rule, not a hygiene one. The
  // snapshot shape is the one head shape that skips the self-review guard
  //, and containment is what makes it unforgeable. A prefix that is a
  // prefix of `branchPrefix`, or that `branchPrefix` is a prefix of, would let
  // an ordinary claimed branch be parsed as a snapshot head — the one way to
  // re-open the bypass without touching `provenance.mjs` at all. Reject it in
  // configuration rather than relying on the parse to reject it by accident.
  if (promotionSnapshotPrefix !== undefined) {
    if (!isNonEmptyString(promotionSnapshotPrefix)) {
      problems.push(
        "`promotionSnapshotPrefix` must be a non-empty string when present.",
      );
    } else if (
      promotionSnapshotPrefix.startsWith("-") ||
      // Validated with a suffix, the way the generated-ref prefixes below are:
      // a prefix that is only invalid once a snapshot name is appended is the
      // trap those avoid, and the same one applies here.
      !isGitRefPath(`${promotionSnapshotPrefix}release-2026-01-01`)
    ) {
      problems.push(
        "`promotionSnapshotPrefix` is not a valid Git branch name prefix.",
      );
    } else if (
      isNonEmptyString(branchPrefix) &&
      (promotionSnapshotPrefix.startsWith(branchPrefix) ||
        branchPrefix.startsWith(promotionSnapshotPrefix))
    ) {
      problems.push(
        "`promotionSnapshotPrefix` must not overlap `branchPrefix`: a claimed " +
          "agent branch would then parse as a promotion snapshot head, which " +
          "skips the self-review guard.",
      );
    }
  }

  /** @type {[string, unknown, string][]} */
  const generatedRefs = [
    ["branchPrefix", branchPrefix, "1-safe-title"],
    ["claimRefPrefix", claimRefPrefix, "1"],
    // The longest name `lease.mjs` generates under this prefix. Validating the
    // prefix alone would accept one that only produces an invalid ref once the
    // suffix is appended, which is the same trap the two above avoid.
    ["sessionRefPrefix", sessionRefPrefix, "pr-1-reviewer"],
  ];

  for (const [key, value, generatedSuffix] of generatedRefs) {
    if (!isNonEmptyString(value)) {
      problems.push(`\`${key}\` must be a non-empty string.`);
    } else if (
      (key === "branchPrefix" && value.startsWith("-")) ||
      !isGitRefPath(value, generatedSuffix)
    ) {
      problems.push(`\`${key}\` would not generate a valid Git ref.`);
    }
  }

  // No two namespaces may overlap in either direction. If a reservation ref
  // could also be read as an issue branch, `branchIssue` would resolve a
  // reservation to an author and the janitor could mistake live work for an
  // abandoned reservation — or delete a real branch while releasing a claim.
  // The session namespace joins the same rule: `report.mjs` lists reservations
  // and leases by prefix and classifies them differently, so an overlap would
  // have a lease counted as a claim (or swept as one) purely by name.
  /** @type {[string, unknown][]} */
  const namespaces = [
    ["branchPrefix", branchPrefix],
    ["claimRefPrefix", claimRefPrefix],
    ["sessionRefPrefix", sessionRefPrefix],
  ];

  for (const [leftKey, left] of namespaces) {
    for (const [rightKey, right] of namespaces) {
      if (leftKey >= rightKey) continue;
      if (!isNonEmptyString(left) || !isNonEmptyString(right)) continue;
      if (!left.startsWith(right) && !right.startsWith(left)) continue;

      problems.push(
        `\`${leftKey}\` (${left}) and \`${rightKey}\` (${right}) must not be prefixes of one another; their refs would share a namespace.`,
      );
    }
  }

  if (typeof labels !== "object" || labels === null) {
    problems.push("`labels` must be an object.");
  } else {
    const labelValues = /** @type {Record<string, unknown>} */ (labels);
    for (const key of REQUIRED_LABELS) {
      if (!isNonEmptyString(labelValues[key])) {
        problems.push(`\`labels.${key}\` must be a non-empty string.`);
      }
    }
  }

  return problems.length === 0 ? { ok: true } : { ok: false, problems };
};

export default validateConfig;
