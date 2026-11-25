import type { CSSProperties } from "react";

import type { SwarmTarget } from "../_lib/config-types";
import { formatDate, formatNumber, formatScore, formatShortDate } from "../_lib/format";
import type { Delivery } from "../_lib/github";
import type { VersionRow } from "../_lib/types";

/* ───────────────────────── Score step chart (score mode) ───────────────────────── */

type Series = { target: SwarmTarget; marker: number; points: { t: number; score: number; row: VersionRow }[] };

const MARKERS = ["circle", "square", "triangle", "diamond", "bar"] as const;

function Marker({ kind, x, y }: { kind: number; x: number; y: number }) {
  const shape = MARKERS[kind % MARKERS.length];
  if (shape === "circle") return <circle cx={x} cy={y} r={4.5} />;
  if (shape === "square") return <rect height={8} width={8} x={x - 4} y={y - 4} />;
  if (shape === "triangle") return <path d={`M${x} ${y - 5.5}L${x + 5.5} ${y + 4.5}H${x - 5.5}z`} />;
  if (shape === "diamond") return <path d={`M${x} ${y - 6}L${x + 6} ${y}L${x} ${y + 6}L${x - 6} ${y}z`} />;
  return <rect height={10} width={4} x={x - 2} y={y - 5} />;
}

function LegendMarker({ kind }: { kind: number }) {
  return (
    <svg aria-hidden="true" className="rp-legend-marker" height="14" viewBox="0 0 14 14" width="14">
      <Marker kind={kind} x={7} y={7} />
    </svg>
  );
}

function niceTicks(min: number, max: number, count: number): number[] {
  if (min === max) return [min];
  const span = max - min;
  const step0 = span / count;
  const magnitude = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= step0) ?? step0;
  const ticks: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) ticks.push(Number(v.toPrecision(12)));
  return ticks;
}

function Plot({ series, width, height, label }: { series: Series[]; width: number; height: number; label: string }) {
  const pad = { top: 16, right: width < 500 ? 16 : 120, bottom: 32, left: 52 };
  const all = series.flatMap((s) => s.points);
  const now = Date.now();
  const t0 = Math.min(...all.map((p) => p.t));
  const t1 = Math.max(now, ...all.map((p) => p.t));
  let lo = Math.min(...all.map((p) => p.score));
  let hi = Math.max(...all.map((p) => p.score));
  if (lo === hi) {
    lo -= 1;
    hi += 1;
  }
  const yTicks = niceTicks(lo, hi, 4);
  lo = Math.min(lo, yTicks[0] ?? lo);
  hi = Math.max(hi, yTicks[yTicks.length - 1] ?? hi);
  const x = (t: number) => pad.left + ((t - t0) / Math.max(1, t1 - t0)) * (width - pad.left - pad.right);
  const y = (v: number) => pad.top + (1 - (v - lo) / (hi - lo)) * (height - pad.top - pad.bottom);
  const xTicks = [t0, t0 + (t1 - t0) / 2, t1];

  return (
    <svg className="rp-plot" role="img" aria-label={label} viewBox={`0 0 ${width} ${height}`}>
      <g className="rp-plot-grid">
        {yTicks.map((tick) => (
          <g key={tick}>
            <line x1={pad.left} x2={width - pad.right} y1={y(tick)} y2={y(tick)} />
            <text textAnchor="end" x={pad.left - 8} y={y(tick) + 4}>
              {formatNumber(tick)}
            </text>
          </g>
        ))}
        {xTicks.map((tick, index) => (
          <text
            key={tick}
            textAnchor={index === 0 ? "start" : index === xTicks.length - 1 ? "end" : "middle"}
            x={x(tick)}
            y={height - 10}
          >
            {formatShortDate(tick)}
          </text>
        ))}
      </g>
      {series.map((s) => {
        let d = "";
        s.points.forEach((p, index) => {
          d += index === 0 ? `M${x(p.t)} ${y(p.score)}` : `H${x(p.t)}V${y(p.score)}`;
        });
        const last = s.points[s.points.length - 1]!;
        d += `H${x(t1)}`;
        return (
          <g className="rp-plot-series" key={s.target.id} style={{ "--rp-series": s.target.color } as CSSProperties}>
            <path d={d} />
            {s.points.map((p) => (
              <Marker key={p.row.id} kind={s.marker} x={x(p.t)} y={y(p.score)} />
            ))}
            {pad.right > 40 ? (
              <text className="rp-plot-label" x={x(t1) + 8} y={y(last.score) + 4}>
                {s.target.name}
              </text>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}

/**
 * Shipped versions' scores over time, one step line per target. Each target
 * has its own colour AND marker shape, is named in the legend and at the
 * line's end, and the same data is available as a table.
 */
export function ScoreChart({
  versions,
  targets,
  label,
}: {
  versions: VersionRow[];
  targets: SwarmTarget[];
  label: string;
}) {
  const series: Series[] = targets
    .map((target, index) => ({
      target,
      marker: index,
      points: versions
        .filter((row) => row.target === target.id && typeof row.score === "number")
        .map((row) => ({ t: new Date(row.created_at).getTime(), score: row.score as number, row }))
        .sort((a, b) => a.t - b.t),
    }))
    .filter((s) => s.points.length > 0);
  if (series.length === 0) return null;
  const summary = `${label}: ${series
    .map((s) => `${s.target.name} ${formatScore(s.points[s.points.length - 1]!.score)}`)
    .join(", ")}`;

  return (
    <figure className="rp-chart">
      <ul className="rp-legend">
        {series.map((s) => (
          <li key={s.target.id} style={{ "--rp-series": s.target.color } as CSSProperties}>
            <LegendMarker kind={s.marker} />
            {s.target.name}
          </li>
        ))}
      </ul>
      <div className="rp-plot-wide">
        <Plot height={300} label={summary} series={series} width={760} />
      </div>
      <div className="rp-plot-narrow">
        <Plot height={240} label={summary} series={series} width={360} />
      </div>
      <details className="rp-details">
        <summary>Show the data as a table</summary>
        <div className="rp-scroll">
          <table className="rp-table">
            <thead>
              <tr>
                <th scope="col">Target</th>
                <th scope="col">Version</th>
                <th scope="col">Score</th>
                <th scope="col">When</th>
              </tr>
            </thead>
            <tbody>
              {series.flatMap((s) =>
                s.points.map((p) => (
                  <tr key={p.row.id}>
                    <td>{s.target.name}</td>
                    <td className="rp-mono">{p.row.version}</td>
                    <td>{formatScore(p.score)}</td>
                    <td>{formatDate(p.row.created_at)}</td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}

/* ───────────────────────── Delivery bar (checks / review mode) ───────────────────────── */

const SEGMENTS = [
  { key: "merged", label: "merged" },
  { key: "approved", label: "approved" },
  { key: "inReview", label: "in review" },
  { key: "inBranch", label: "in a branch" },
  { key: "open", label: "open" },
] as const;

/** "71% of 97 issues merged · 69 merged · 0 approved · …", drawn as one bar. */
export function DeliveryBar({ delivery, label }: { delivery: Delivery; label?: string }) {
  const total = Math.max(delivery.total, 1);
  const share = Math.round((delivery.merged / total) * 100);
  return (
    <div className="rp-delivery">
      <p className="rp-delivery-head">
        {label ? <strong>{label}: </strong> : null}
        <strong>{delivery.total === 0 ? "No issues yet" : `${share}% of ${delivery.total} issues merged`}</strong>
      </p>
      <div aria-hidden="true" className="rp-bar">
        {SEGMENTS.map((segment) =>
          delivery[segment.key] > 0 ? (
            <span
              className={`rp-bar-${segment.key}`}
              key={segment.key}
              style={{ flexGrow: delivery[segment.key] }}
            />
          ) : null,
        )}
      </div>
      <ul className="rp-bar-legend">
        {SEGMENTS.map((segment) => (
          <li key={segment.key}>
            <span aria-hidden="true" className={`rp-bar-key rp-bar-${segment.key}`} />
            {delivery[segment.key]} {segment.label}
          </li>
        ))}
      </ul>
    </div>
  );
}
