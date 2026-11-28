import type { Metadata } from "next";

import { IssuePr, TargetChip } from "../_components/chips";
import { FleetGraph } from "../_components/fleet-graph";
import { RoleTag } from "../_components/role";
import { Empty, Gate, PageHead, QueryErrors, TimeAgo } from "../_components/states";
import { cap, word } from "../_lib/format";
import { githubRepoUrl } from "../_lib/github";
import { getFleet, getFleetGraph, getSwarmContext } from "../_lib/queries";

export const metadata: Metadata = { title: "Fleet" };

export default async function FleetPage() {
  const context = await getSwarmContext();
  if (context.state !== "ok") return <Gate context={context} />;
  const [{ fleet, errors }, graph] = await Promise.all([getFleet(), getFleetGraph()]);
  // One panel for every failed read, the table's and the graph's.
  const failed = [...errors, ...graph.errors];

  return (
    <>
      <PageHead
        title="Fleet"
        lede={`Where the swarm's effort goes, live, with a replay of its whole history. Below it, every ${word("session")} working now and seen in the last ten minutes, with its latest progress note.`}
      />
      <QueryErrors errors={failed} />
      <FleetGraph
        input={graph.input}
        note={graph.githubNote ? `GitHub is not shown: ${graph.githubNote}` : null}
        repoUrl={githubRepoUrl()}
      />
      {fleet.length === 0 ? (
        <Empty>
          Nobody is working right now. An {word("agent")} shows up here within seconds of opening a{" "}
          {word("session")} with <code>npx rallypoint swarm prepare</code>, and drops off ten minutes after its last
          heartbeat.
        </Empty>
      ) : (
        <table className="rp-table rp-reflow">
          <thead>
            <tr>
              <th scope="col">{cap(word("agent"))}</th>
              <th scope="col">Role</th>
              <th scope="col">{cap(word("target"))}</th>
              <th scope="col">Issue / PR</th>
              <th scope="col">Latest note</th>
              <th scope="col">Last seen</th>
            </tr>
          </thead>
          <tbody>
            {fleet.map((row) => (
              <tr key={row.id}>
                <td className="rp-mono" data-label={cap(word("agent"))}>
                  {row.agent ?? "—"}
                </td>
                <td data-label="Role">
                  <RoleTag role={row.role} />
                </td>
                <td data-label={cap(word("target"))}>
                  <TargetChip id={row.target} />
                </td>
                <td data-label="Issue / PR">
                  <IssuePr issue={row.issue} pr={row.pr} />
                </td>
                <td data-label="Latest note">
                  {row.latest_note ?? <span className="rp-soft">—</span>}
                  {row.latest_note_at ? (
                    <span className="rp-soft">
                      {" "}
                      · <TimeAgo at={row.latest_note_at} />
                    </span>
                  ) : null}
                </td>
                <td data-label="Last seen">
                  <TimeAgo at={row.last_seen_at} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
