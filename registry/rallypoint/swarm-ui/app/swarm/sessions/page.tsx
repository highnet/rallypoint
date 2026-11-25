import type { Metadata } from "next";

import { IssuePr, StatusTag, TargetChip } from "../_components/chips";
import { RoleTag } from "../_components/role";
import { Empty, FilterBar, Gate, PageHead, QueryErrors, TimeAgo } from "../_components/states";
import { cap, word } from "../_lib/format";
import { getSessions, getSwarmContext } from "../_lib/queries";
import type { SessionStatus } from "../_lib/types";

export const metadata: Metadata = { title: cap(word("sessions")) };
export const dynamic = "force-dynamic";

const STATUSES: SessionStatus[] = ["working", "ended", "abandoned"];

export default async function SessionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const status = STATUSES.find((entry) => entry === params.status);
  const context = await getSwarmContext();
  if (context.state !== "ok") return <Gate context={context} />;
  const { sessions, errors } = await getSessions(status);

  return (
    <>
      <PageHead
        title={cap(word("sessions"))}
        lede={`Each ${word("session")} does one role, logs its progress, and leaves a retro for the improver.`}
      />
      <QueryErrors errors={errors} />
      <FilterBar
        label="Status"
        options={[
          { href: "/swarm/sessions", label: "All", current: !status },
          ...STATUSES.map((entry) => ({
            href: `/swarm/sessions?status=${entry}`,
            label: entry,
            current: status === entry,
          })),
        ]}
      />
      {sessions.length === 0 ? (
        <Empty>No {word("sessions")} yet.</Empty>
      ) : (
        <ol className="rp-cards">
          {sessions.map((session) => (
            <li key={session.id}>
              <div className="rp-card-meta">
                <span className="rp-mono">{session.agent ?? "—"}</span>
                <RoleTag role={session.role} />
                <TargetChip id={session.target} />
                <IssuePr issue={session.issue} pr={session.pr} />
                <StatusTag status={session.status} />
                <TimeAgo at={session.started_at} />
              </div>
              {session.summary ? <p>{session.summary}</p> : null}
              {session.progress.length > 0 ? (
                <details className="rp-details">
                  <summary>
                    {session.progress.length} progress note{session.progress.length === 1 ? "" : "s"}
                  </summary>
                  <ol className="rp-notes">
                    {session.progress.map((note) => (
                      <li key={note.id}>
                        <TimeAgo at={note.created_at} /> {note.note}
                      </li>
                    ))}
                  </ol>
                </details>
              ) : null}
              {session.retros.map((retro) => (
                <dl className="rp-facts rp-retro" key={retro.id}>
                  <div>
                    <dt>Went well</dt>
                    <dd>{retro.went_well ?? "—"}</dd>
                  </div>
                  <div>
                    <dt>Friction</dt>
                    <dd>{retro.friction ?? "—"}</dd>
                  </div>
                  <div>
                    <dt>Suggestion</dt>
                    <dd>{retro.suggestion ?? "—"}</dd>
                  </div>
                </dl>
              ))}
            </li>
          ))}
        </ol>
      )}
    </>
  );
}
