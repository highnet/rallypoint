import Link from "next/link";

import { SignalFlag, type SignalId } from "@/components/signal-flag";

/**
 * Rallypoint already runs a fleet: the orchestrator surveys the board and
 * starts one session per role, each on its own issue or pull request. The
 * targets are illustrative; the commands and rules are the protocol's own.
 */
const fleet: { role: SignalId; name: string; target: string }[] = [
  { role: "worker", name: "Worker", target: "#142" },
  { role: "worker", name: "Worker", target: "#143" },
  { role: "worker", name: "Worker", target: "#145" },
  { role: "reviewer", name: "Reviewer", target: "PR #388" },
  { role: "fixer", name: "Fixer", target: "PR #380" },
  { role: "merger", name: "Merger", target: "PR #377" },
  { role: "janitor", name: "Janitor", target: "stale claims" },
];

export function FleetDispatch() {
  return (
    <figure className="fleet">
      <div className="fleet-head">
        <span className="role-cell fleet-orchestrator">
          <SignalFlag className="role-flag" signal="orchestrator" />
          <Link href="/agents/orchestrator">Orchestrator</Link>
        </span>
        <code>node .rallypoint/scripts/report.mjs</code>
        <span className="fleet-head-note">surveys the board, leases the work, dispatches</span>
      </div>
      <ul aria-label="Sessions the orchestrator dispatched" className="fleet-sessions">
        {fleet.map((session, index) => (
          <li key={`${session.role}-${index}`}>
            <SignalFlag className="role-flag" signal={session.role} />
            <span className="fleet-session-name">{session.name}</span>
            <code>{session.target}</code>
          </li>
        ))}
      </ul>
      <figcaption>
        One orchestrator, a fleet of sessions, each in its own role on its own issue or pull request.
        Several orchestrators may run at once: leases keep them from dispatching the same job twice,
        and <code>claim.mjs</code> keeps two workers off one issue.
      </figcaption>
    </figure>
  );
}
