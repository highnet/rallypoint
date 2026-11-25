import type { Metadata } from "next";

import { Ref, TargetChip } from "../_components/chips";
import { Empty, Gate, PageHead, QueryErrors } from "../_components/states";
import { TimeAgo } from "../_components/states";
import { cap, formatScore, shortSha, word } from "../_lib/format";
import { getSwarmContext, getVersions } from "../_lib/queries";

export const metadata: Metadata = { title: cap(word("versions")) };
export const dynamic = "force-dynamic";

export default async function VersionsPage() {
  const context = await getSwarmContext();
  if (context.state !== "ok") return <Gate context={context} />;
  const { versions, errors } = await getVersions();
  const anyScore = versions.some((row) => row.score !== null);

  return (
    <>
      <PageHead
        title={cap(word("versions"))}
        lede={`Every ${word("version")} ${word("shipped")}: recorded by the merger after the pull request merged.`}
      />
      <QueryErrors errors={errors} />
      {versions.length === 0 ? (
        <Empty>
          Nothing {word("shipped")} yet. The merger records a {word("version")} with{" "}
          <code>npx rallypoint swarm ship</code>.
        </Empty>
      ) : (
        <table className="rp-table rp-reflow">
          <thead>
            <tr>
              <th scope="col">{cap(word("version"))}</th>
              <th scope="col">{cap(word("target"))}</th>
              {anyScore ? <th scope="col">{cap(word("score"))}</th> : null}
              <th scope="col">PR</th>
              <th scope="col">Commit</th>
              <th scope="col">When</th>
              <th scope="col">Notes</th>
            </tr>
          </thead>
          <tbody>
            {versions.map((row) => (
              <tr key={row.id}>
                <td className="rp-mono" data-label={cap(word("version"))}>
                  {row.version}
                </td>
                <td data-label={cap(word("target"))}>
                  <TargetChip id={row.target} />
                </td>
                {anyScore ? <td data-label={cap(word("score"))}>{formatScore(row.score)}</td> : null}
                <td data-label="PR">
                  <Ref value={row.pr} />
                </td>
                <td className="rp-mono" data-label="Commit">
                  {shortSha(row.commit_sha)}
                </td>
                <td data-label="When">
                  <TimeAgo at={row.created_at} />
                </td>
                <td data-label="Notes">{row.notes ?? <span className="rp-soft">—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
