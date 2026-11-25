import type { Metadata } from "next";
import Link from "next/link";

import { TargetChip } from "../_components/chips";
import { Empty, Gate, PageHead, QueryErrors } from "../_components/states";
import { cap, formatPercent, formatScore, word } from "../_lib/format";
import { getSwarmContext, getTargets } from "../_lib/queries";

export const metadata: Metadata = { title: cap(word("targets")) };
export const dynamic = "force-dynamic";

export default async function TargetsPage() {
  const context = await getSwarmContext();
  if (context.state !== "ok") return <Gate context={context} />;
  const { targets, errors } = await getTargets();

  return (
    <>
      <PageHead
        title={cap(word("targets"))}
        lede={`The parts of the goal the swarm works on. Issues carry a target:<id> label.`}
      />
      <QueryErrors errors={errors} />
      {targets.length === 0 ? (
        <Empty>No {word("targets")} configured. Add them in swarm.config.ts.</Empty>
      ) : (
        <table className="rp-table rp-reflow">
          <thead>
            <tr>
              <th scope="col">{cap(word("target"))}</th>
              <th scope="col">Latest {word("version")}</th>
              <th scope="col">{cap(word("results"))}</th>
              <th scope="col">{cap(word("buried"))}</th>
              <th scope="col">Issues merged</th>
            </tr>
          </thead>
          <tbody>
            {targets.map((entry) => (
              <tr key={entry.target.id}>
                <td data-label={cap(word("target"))}>
                  <Link className="rp-row-link" href={`/swarm/targets/${encodeURIComponent(entry.target.id)}`}>
                    <TargetChip id={entry.target.id} />
                  </Link>
                  {entry.target.description ? <p className="rp-soft">{entry.target.description}</p> : null}
                </td>
                <td data-label={`Latest ${word("version")}`}>
                  {entry.latest ? (
                    <>
                      <span className="rp-mono">{entry.latest.version}</span>
                      {entry.latest.score !== null ? <> · {formatScore(entry.latest.score)}</> : null}
                    </>
                  ) : (
                    <span className="rp-soft">—</span>
                  )}
                </td>
                <td data-label={cap(word("results"))}>
                  {entry.results} ({entry.passed} passed)
                </td>
                <td data-label={cap(word("buried"))}>{entry.buried}</td>
                <td data-label="Issues merged">
                  {entry.delivery && entry.delivery.total > 0
                    ? `${entry.delivery.merged} of ${entry.delivery.total} (${formatPercent(entry.delivery.merged / entry.delivery.total)})`
                    : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
