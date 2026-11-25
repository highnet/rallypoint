import Link from "next/link";

import { checksOf, formatDelta, formatDuration, formatScore, resultMode, word } from "../_lib/format";
import type { ResultRow } from "../_lib/types";
import { IssuePr, TargetChip, Verdict } from "./chips";
import { Empty, TimeAgo } from "./states";

/** What a referee run measured, in whichever mode it ran. Never assumes a score. */
export function ResultOutcome({ result }: { result: ResultRow }) {
  const mode = resultMode(result);
  if (mode === "score" && result.candidate_score !== null) {
    return (
      <span>
        {formatScore(result.candidate_score)}{" "}
        <span className="rp-soft">
          vs {formatScore(result.baseline_score)} ({formatDelta(result.delta)})
        </span>
      </span>
    );
  }
  const checks = checksOf(result);
  if (checks.length > 0) {
    const passed = checks.filter((check) => check.passed).length;
    return (
      <span>
        {passed}/{checks.length} checks passed
        {checks.some((check) => !check.passed) ? (
          <span className="rp-soft">
            {" "}
            · failed: {checks.filter((check) => !check.passed).map((check) => check.name).join(", ")}
          </span>
        ) : null}
      </span>
    );
  }
  if (mode === "review") return <span className="rp-soft">Gate is the reviewer&rsquo;s verdict</span>;
  return <span className="rp-soft">No measurements recorded</span>;
}

/** Named checks, each with a symbol and a word. */
export function ChecksList({ result }: { result: ResultRow }) {
  const checks = checksOf(result);
  if (checks.length === 0) return null;
  return (
    <ul className="rp-checks">
      {checks.map((check) => (
        <li key={check.name}>
          <Verdict passed={check.passed} />
          <code>{check.name}</code>
          <span className="rp-soft">
            {check.exitCode !== null && check.exitCode !== undefined ? `exit ${check.exitCode}` : ""}
            {check.durationMs !== null && check.durationMs !== undefined ? ` · ${formatDuration(check.durationMs)}` : ""}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function ResultsTable({ results, showTarget = true }: { results: ResultRow[]; showTarget?: boolean }) {
  if (results.length === 0) {
    return (
      <Empty>
        No {word("results")} yet. Each <code>npx rallypoint swarm referee</code> run records one.
      </Empty>
    );
  }
  return (
    <table className="rp-table rp-reflow">
      <thead>
        <tr>
          <th scope="col">Run</th>
          <th scope="col">When</th>
          {showTarget ? <th scope="col">{word("target", true)}</th> : null}
          <th scope="col">Issue / PR</th>
          <th scope="col">Measured</th>
          <th scope="col">Verdict</th>
        </tr>
      </thead>
      <tbody>
        {results.map((result) => (
          <tr key={result.id}>
            <td data-label="Run">
              <Link className="rp-mono" href={`/swarm/results/${result.id}`}>
                #{result.id}
              </Link>
            </td>
            <td data-label="When">
              <TimeAgo at={result.created_at} />
            </td>
            {showTarget ? (
              <td data-label={word("target", true)}>
                <TargetChip id={result.target} />
              </td>
            ) : null}
            <td data-label="Issue / PR">
              <IssuePr issue={result.issue} pr={result.pr} />
            </td>
            <td data-label="Measured">
              <ResultOutcome result={result} />
            </td>
            <td data-label="Verdict">
              <Verdict passed={result.passed} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
