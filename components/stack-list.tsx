import { SquareTerminal } from "lucide-react";

import { stackIconPaths, type StackIconId } from "@/lib/stack-icons";
import { cn } from "@/lib/utils";

export type StackItem = {
  /** A brand mark from lib/stack-icons, or "agent" for any coding agent. */
  icon: StackIconId | "agent";
  name: string;
  /** What this piece does in the tier, in a few words. */
  role: string;
  optional?: boolean;
};

/**
 * What a tier runs on: one bordered tile per tool, monochrome mark beside its
 * name and its job, so the mark never has to carry the meaning.
 */
export function StackList({ items, label, className }: { items: StackItem[]; label: string; className?: string }) {
  return (
    <ul aria-label={label} className={cn("stack-list", className)}>
      {items.map((item) => (
        <li className="stack-item" key={item.name}>
          <span aria-hidden="true" className="stack-icon">
            {item.icon === "agent" ? (
              <SquareTerminal strokeWidth={1.75} />
            ) : (
              <svg viewBox="0 0 24 24">
                <path d={stackIconPaths[item.icon]} fill="currentColor" />
              </svg>
            )}
          </span>
          <span className="stack-text">
            <span className="stack-name">
              {item.name}
              {item.optional ? <span className="stack-optional">optional</span> : null}
            </span>
            <span className="stack-role">{item.role}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

export const loopStack: StackItem[] = [
  { icon: "github", name: "GitHub", role: "Issues, refs, labels, pull requests" },
  { icon: "nodedotjs", name: "Node.js 20+", role: "The zero-dependency CLI" },
  { icon: "agent", name: "Any coding agent", role: "Claude Code, Codex, Cursor…" },
];

export const swarmStack: StackItem[] = [
  { icon: "github", name: "GitHub", role: "Owns the work" },
  { icon: "supabase", name: "Supabase", role: "Owns the memory, your project" },
  { icon: "postgresql", name: "PostgreSQL", role: "RLS and secret-checked writes" },
  { icon: "nodedotjs", name: "Node.js 20+", role: "The swarm runtime" },
  { icon: "claude", name: "Claude Code", role: "Conductor: a /loop with remote sessions" },
  { icon: "openai", name: "Codex", role: "Conductor: Codex Cloud tasks via swarm dispatch" },
  { icon: "nextdotjs", name: "Next.js", role: "The swarm UI scaffold", optional: true },
];
