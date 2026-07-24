import Link from "next/link";

import { agents } from "@/lib/agents";

const ROMAN_NUMERALS = ["I", "II", "III", "IV", "V", "VI", "VII"];

export function RoleParty() {
  return (
    <div className="role-party">
      {agents.map((agent, index) => (
        <Link
          aria-label={`Open the ${agent.name} role contract`}
          className="role-sheet"
          href={`/agents/${agent.slug}`}
          key={agent.slug}
        >
          <span aria-hidden="true" className="role-index">
            {ROMAN_NUMERALS[index] ?? index + 1}
          </span>
          <span className={`role-sigil role-${agent.color}`}>
            <svg aria-hidden="true">
              <use href={`#charge-${agent.charge}`} />
            </svg>
          </span>
          <span className="role-identity">
            <span className="role-name">{agent.name}</span>
            <h3>{agent.title}</h3>
          </span>
          <p className="role-duty">{agent.summary}</p>
          <span aria-hidden="true" className="role-open">
            Open contract
          </span>
        </Link>
      ))}
    </div>
  );
}
