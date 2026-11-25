import type { Metadata } from "next";

import { IssuePr, TargetChip } from "../_components/chips";
import { RoleTag } from "../_components/role";
import { Empty, Gate, PageHead, QueryErrors, TimeAgo } from "../_components/states";
import { cap, word } from "../_lib/format";
import { getFleet, getSwarmContext } from "../_lib/queries";

export const metadata: Metadata = { title: "Fleet" };
export const dynamic = "force-dynamic";

export default async function FleetPage() {
  const context = await getSwarmContext();
  if (context.state !== "ok") return <Gate context={context} />;
  const { fleet, errors } = await getFleet();

  return (
    <>
      <PageHead
        title="Fleet"
        lede={`Every ${word("session")} working now and seen in the last two hours, with its latest progress note.`}
      />
      <QueryErrors errors={errors} />
      {fleet.length === 0 ? (
        <Empty>
          No {word("sessions")} working right now. Start one with <code>npx rallypoint swarm prepare</code>.
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
