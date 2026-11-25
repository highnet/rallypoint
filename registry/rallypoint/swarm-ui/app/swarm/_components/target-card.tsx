import Link from "next/link";
import type { CSSProperties } from "react";

import type { MeasureMode } from "../_lib/config-types";
import { cap, formatDelta, formatNumber, word } from "../_lib/format";
import type { TargetSummary } from "../_lib/queries";
import type { ResultRow } from "../_lib/types";
import { swarmConfig } from "../swarm.config";
import { TargetMark } from "./chips";
import { ArrowRight } from "./icons";
import { TimeAgo } from "./states";

/** One target as a card: its mark, its headline figure, and its last run. */
export function TargetCard({
  entry,
  mode,
  lastRun,
}: {
  entry: TargetSummary;
  mode: MeasureMode;
  /** The newest referee run for this target, when known. */
  lastRun: ResultRow | null;
}) {
  const { target, latest } = entry;
  const score = mode === "score";
  const href = `/swarm/targets/${encodeURIComponent(target.id)}`;
  return (
    <li className="rp-card" style={{ "--rp-target": target.color } as CSSProperties}>
      <header className="rp-card-head">
        <TargetMark color={target.color} name={target.name} size="l" />
        <div>
          <h3>
            <Link className="rp-card-link" href={href}>
              {target.name}
            </Link>
          </h3>
          <p className="rp-soft">{target.description || `target:${target.id}`}</p>
        </div>
        <ArrowRight />
      </header>
      <dl className="rp-card-figures">
        <div>
          <dt>{score ? swarmConfig.measure.label || cap(word("score")) : cap(word("versions"))}</dt>
          <dd className="rp-big">
            {score ? formatNumber(latest?.score ?? null) : formatNumber(entry.versions)}
            {score && swarmConfig.measure.unit && latest?.score != null ? (
              <span className="rp-big-unit">{swarmConfig.measure.unit}</span>
            ) : null}
          </dd>
        </div>
        <div>
          <dt>{cap(word("version"))}</dt>
          <dd className="rp-mid">{latest?.version ?? "—"}</dd>
        </div>
      </dl>
      <p className="rp-card-line">
        {lastRun ? (
          <>
            Last {word("result")}:{" "}
            <span className={lastRun.passed ? "rp-pass" : lastRun.passed === false ? "rp-fail" : ""}>
              {lastRun.passed ? "passed" : lastRun.passed === false ? "failed" : "pending"}
            </span>
            {lastRun.delta !== null ? <> {formatDelta(lastRun.delta)}</> : null}, <TimeAgo at={lastRun.created_at} />.
          </>
        ) : entry.results > 0 ? (
          <>
            {entry.results} {word("results")}, {entry.passed} passed, {entry.buried} {word("buried")}.
          </>
        ) : (
          <>No {word("results")} yet. The referee records the first one.</>
        )}
        {entry.delivery && entry.delivery.total > 0 ? (
          <>
            {" "}
            {entry.delivery.merged} of {entry.delivery.total} issues merged.
          </>
        ) : null}
      </p>
    </li>
  );
}
