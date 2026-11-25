// The referee: the measurement gate between "a pull request exists" and "it
// may be reviewed". It never approves anything — it records what the measure
// says, and review and merge stay independent.
//
// Three modes, because not every swarm has a reward function:
//   score  — a command prints a number; the candidate must beat the baseline
//            by `margin` in `direction`. (Swarm Arena: Elo against a ladder.)
//   checks — named commands must all exit 0 (build, tests, e2e, a budget
//            script). No number, no baseline run. (A website or product.)
//   review — nothing automated; independent review against the issue's
//            acceptance criteria is the gate. (Vanilla Rallypoint.)
//
// Everything here is pure except `runCommand`, which the caller injects.

export const MODES = ["score", "checks", "review"];

/**
 * Reads a score from command output: JSON `{"score": n}` on the last
 * non-empty line, or else the first number on that line.
 * @param {string} stdout
 * @returns {number|null}
 */
export const parseScore = (stdout) => {
  const lines = String(stdout ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const last = lines.at(-1);
  if (!last) return null;
  try {
    const parsed = JSON.parse(last);
    if (parsed && typeof parsed === "object" && Number.isFinite(Number(parsed.score))) return Number(parsed.score);
    if (typeof parsed === "number" && Number.isFinite(parsed)) return parsed;
  } catch {
    // not JSON — fall through to the last token
  }
  // The FIRST number on the last line: "elo 1530 ± 40" is 1530, not the
  // error bar.
  const match = /[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/i.exec(last);
  return match ? Number(match[0]) : null;
};

/**
 * Compares a candidate score to a baseline.
 * @param {{candidate:number, baseline:number|null, direction?:"higher"|"lower", margin?:number}} input
 */
export const compareScores = ({ candidate, baseline, direction = "higher", margin = 0 }) => {
  if (!Number.isFinite(candidate)) return { passed: false, delta: null, reason: "the measure printed no score for the candidate" };
  if (baseline === null || baseline === undefined || !Number.isFinite(baseline)) {
    return { passed: true, delta: null, reason: "no baseline score yet: the first measured version sets it" };
  }
  const delta = direction === "lower" ? baseline - candidate : candidate - baseline;
  const passed = delta > (margin ?? 0);
  const word = direction === "lower" ? "lower" : "higher";
  return {
    passed,
    delta,
    reason: passed
      ? `candidate is ${Math.abs(delta)} ${word === "higher" ? "above" : "below"} the baseline (margin ${margin})`
      : `candidate does not beat the baseline by more than ${margin} (${word} is better; delta ${delta})`,
  };
};

/** Validates the `measure` block of `.rallypoint/swarm.json`. Returns a list of problems. */
export const validateMeasure = (measure) => {
  const problems = [];
  if (!measure || typeof measure !== "object") return ["measure is missing"];
  const mode = measure.mode ?? "review";
  if (!MODES.includes(mode)) problems.push(`measure.mode must be one of ${MODES.join(", ")}`);
  if (mode === "score") {
    if (!measure.command) problems.push("measure.command is required in score mode");
    if (!["higher", "lower"].includes(measure.direction ?? "higher")) problems.push('measure.direction must be "higher" or "lower"');
    if (measure.margin !== undefined && !Number.isFinite(Number(measure.margin))) problems.push("measure.margin must be a number");
  }
  if (mode === "checks") {
    const checks = measure.checks ?? [];
    if (!Array.isArray(checks) || checks.length === 0) problems.push("measure.checks needs at least one {name, command} in checks mode");
    for (const [i, check] of (Array.isArray(checks) ? checks : []).entries()) {
      if (!check?.name || !check?.command) problems.push(`measure.checks[${i}] needs a name and a command`);
    }
  }
  return problems;
};

/**
 * Runs the configured measure and returns the record to store in
 * `swarm_results`, without storing it.
 *
 * @param {{
 *   measure: any,
 *   runCommand: (command: string, options: {cwd: string, timeoutSeconds: number}) => {status:number|null, stdout:string, stderr:string, durationMs:number},
 *   cwd: string,
 *   baselineCwd?: string|null,
 *   requireBaseline?: boolean,
 * }} input
 *
 * Score mode fails closed: when a baseline is required (the default) and it
 * could not be measured, the candidate does not pass. Only the very first
 * measured version may skip it, explicitly (`requireBaseline: false`).
 */
export const referee = ({ measure, runCommand, cwd, baselineCwd = null, requireBaseline = true }) => {
  const mode = measure?.mode ?? "review";
  const timeoutSeconds = Number(measure?.timeoutSeconds ?? 1800);

  if (mode === "review") {
    return {
      mode,
      passed: true,
      candidate_score: null,
      baseline_score: null,
      delta: null,
      reason: "review mode: nothing automated to measure; the independent review is the gate",
      details: { mode },
    };
  }

  if (mode === "checks") {
    const checks = (measure.checks ?? []).map((check) => {
      const run = runCommand(check.command, { cwd, timeoutSeconds });
      return {
        name: check.name,
        command: check.command,
        passed: run.status === 0,
        exitCode: run.status,
        durationMs: run.durationMs,
        tail: tail(run.status === 0 ? run.stdout : `${run.stdout}\n${run.stderr}`),
      };
    });
    const failed = checks.filter((check) => !check.passed).map((check) => check.name);
    return {
      mode,
      passed: failed.length === 0,
      candidate_score: null,
      baseline_score: null,
      delta: null,
      reason: failed.length ? `failed: ${failed.join(", ")}` : `all ${checks.length} checks passed`,
      details: { mode, checks },
    };
  }

  const direction = measure.direction ?? "higher";
  const margin = Number(measure.margin ?? 0);
  const candidateRun = runCommand(measure.command, { cwd, timeoutSeconds });
  const candidate = candidateRun.status === 0 ? parseScore(candidateRun.stdout) : null;
  let baseline = null;
  let baselineRun = null;
  if (baselineCwd) {
    baselineRun = runCommand(measure.command, { cwd: baselineCwd, timeoutSeconds });
    baseline = baselineRun.status === 0 ? parseScore(baselineRun.stdout) : null;
  }
  const verdict =
    candidateRun.status !== 0
      ? { passed: false, delta: null, reason: `the measure exited ${candidateRun.status} on the candidate` }
      : requireBaseline && baseline === null
        ? {
            passed: false,
            delta: null,
            reason: baselineRun
              ? `the baseline could not be measured (exit ${baselineRun.status}); nothing to beat, so nothing passes`
              : "no baseline was available to measure; pass --first only for the very first version",
          }
        : compareScores({ candidate, baseline, direction, margin });
  return {
    mode,
    passed: verdict.passed,
    candidate_score: candidate,
    baseline_score: baseline,
    delta: verdict.delta,
    reason: verdict.reason,
    details: {
      mode,
      unit: measure.unit ?? null,
      direction,
      margin,
      candidate: { exitCode: candidateRun.status, durationMs: candidateRun.durationMs, tail: tail(candidateRun.stdout) },
      baseline: baselineRun
        ? { exitCode: baselineRun.status, durationMs: baselineRun.durationMs, tail: tail(baselineRun.stdout) }
        : null,
    },
  };
};

const tail = (text, lines = 12) => String(text ?? "").trimEnd().split(/\r?\n/).slice(-lines).join("\n");
