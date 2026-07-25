import Link from "next/link";
import type { CSSProperties } from "react";

import { agentFieldGuides, agents } from "@/lib/agents";

const ROMAN_NUMERALS = ["I", "II", "III", "IV", "V", "VI", "VII"];

export function RoleParty() {
  return (
    <div className="role-party">
      {agents.map((agent, index) => {
        const guide = agentFieldGuides[agent.slug];

        return (
          <Link
            aria-label={`Open the ${agent.name} role contract`}
            className={`role-sheet role-sheet-${agent.slug}`}
            href={`/agents/${agent.slug}`}
            key={agent.slug}
          >
            <span
              aria-hidden="true"
              className="role-portrait"
              style={
                {
                  backgroundImage: `url(/world/roles/${agent.slug}.jpg)`,
                } as CSSProperties
              }
            />
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
            <span className="role-habitat">
              <strong>Habitat</strong>
              {guide.habitat} · {guide.habitatDetail}
            </span>
            <span className="role-tools">
              <strong>Field kit</strong>
              {guide.fieldKit}
            </span>
            <span className="role-statline" aria-label={`${agent.name} field statistics`}>
              <span>
                <strong>Capacity</strong>
                {guide.capacity}
              </span>
              <span>
                <strong>Authority</strong>
                {guide.authority}
              </span>
              <span>
                <strong>Yield</strong>
                {guide.yield}
              </span>
            </span>
            <span className="role-boundary">
              <strong>Boundary</strong>
              {agent.never.join(" · ")}
            </span>
            <span className="role-handoff">
              <strong>Handoff</strong>
              {agent.handoff}
            </span>
            <span aria-hidden="true" className="role-open">
              Open contract
            </span>
          </Link>
        );
      })}
    </div>
  );
}
