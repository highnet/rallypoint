import { Binoculars, BrushCleaning, Hammer, Map, ShieldCheck, Wrench } from "lucide-react";
import Link from "next/link";

const roles = [
  {
    name: "Planner",
    title: "The cartographer",
    detail: "Keeps 5–15 quests ready, scoped, ordered, and unblocked.",
    icon: Map,
    color: "role-violet",
  },
  {
    name: "Worker",
    title: "The builder",
    detail: "Claims exactly one quest and ships exactly one pull request.",
    icon: Hammer,
    color: "role-red",
  },
  {
    name: "Reviewer",
    title: "The gatekeeper",
    detail: "Inspects someone else’s work and alone may grant approval.",
    icon: ShieldCheck,
    color: "role-blue",
  },
  {
    name: "Tester",
    title: "The scout",
    detail: "Finds the weakest coverage, records the gap, then closes it.",
    icon: Binoculars,
    color: "role-amber",
  },
  {
    name: "Fixer",
    title: "The mender",
    detail: "Brings a reviewed pull request back to a mergeable state.",
    icon: Wrench,
    color: "role-green",
  },
  {
    name: "Janitor",
    title: "The keeper",
    detail: "Releases stale claims and clears abandoned reservations.",
    icon: BrushCleaning,
    color: "role-slate",
  },
];

export function RoleParty() {
  return (
    <div className="role-party">
      {roles.map((role) => {
        const Icon = role.icon;
        return (
          <Link
            aria-label={`Open the ${role.name} role contract`}
            className="role-sheet"
            href={`/agents/${role.name.toLowerCase()}`}
            key={role.name}
          >
            <div className={`role-sigil ${role.color}`}>
              <Icon aria-hidden="true" />
            </div>
            <div>
              <p className="role-name">{role.name}</p>
              <h3>{role.title}</h3>
              <p>{role.detail}</p>
            </div>
            <span className="role-open" aria-hidden="true">Open contract →</span>
          </Link>
        );
      })}
    </div>
  );
}
