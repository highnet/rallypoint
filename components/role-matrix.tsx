import { ArrowUpRight } from "lucide-react";
import Link from "next/link";

import { SignalFlag } from "@/components/signal-flag";
import { agents } from "@/lib/agents";
import { cn } from "@/lib/utils";

const yes = (value: string) => value !== "No";

export function RoleMatrix() {
  return (
    <div className="table-wrap">
      <table className="code-table role-matrix">
        <caption className="sr-only">
          The eight Rallypoint roles, whether each claims issues or reviews, and what it is responsible for
        </caption>
        <thead>
          <tr>
            <th scope="col">Role</th>
            <th scope="col">Claims issues</th>
            <th scope="col">Reviews</th>
            <th scope="col">Responsibility</th>
            <th scope="col">
              <span className="sr-only">Contract</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {agents.map((agent) => (
            <tr key={agent.slug}>
              <th scope="row">
                <Link className="role-cell" href={`/agents/${agent.slug}`}>
                  <SignalFlag className="role-flag" signal={agent.slug} />
                  <span>{agent.name}</span>
                </Link>
              </th>
              <td data-label="Claims issues">
                <span className={cn("cap", yes(agent.claims) && "cap-yes")}>{agent.claims}</span>
              </td>
              <td data-label="Reviews">
                <span className={cn("cap", yes(agent.reviews) && "cap-yes")}>{agent.reviews}</span>
              </td>
              <td data-label="Responsibility">{agent.responsibility}</td>
              <td className="role-open">
                <Link aria-label={`${agent.name} contract`} href={`/agents/${agent.slug}`}>
                  Contract
                  <ArrowUpRight aria-hidden="true" />
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
