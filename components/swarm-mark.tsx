import { SignalFlag, type SignalId } from "@/components/signal-flag";
import { cn } from "@/lib/utils";

/**
 * The two tiers as one drawing, in the site's own signal code.
 *
 * - `rank`: the loop. Role flags stand in one orderly rank, each waiting its
 *   turn: GitHub hands the work from one role to the next.
 * - `swarm`: the swarm. The same flags in flight, converging on the
 *   Rallypoint mark. Inside a `.swarm-mark-trigger`, hover or focus closes
 *   them into rank at the rally point.
 *
 * Decorative: always printed beside the tier's name.
 */
const roles: SignalId[] = ["planner", "worker", "reviewer", "fixer", "merger", "improver"];

export function SwarmMark({
  variant = "swarm",
  className,
}: {
  variant?: "swarm" | "rank";
  className?: string;
}) {
  return (
    <span aria-hidden="true" className={cn("swarm-mark", `swarm-mark-${variant}`, className)}>
      {roles.map((signal, index) => (
        <SignalFlag className={`swarm-mark-flag swarm-mark-flag-${index + 1}`} key={signal} signal={signal} />
      ))}
      <SignalFlag className="swarm-mark-point" signal="rallypoint" />
    </span>
  );
}
