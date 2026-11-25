import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { SwarmMark } from "@/components/swarm-mark";

/**
 * The hero's pointer to the next tier: the swarm in flight, which closes into
 * rank at the rally point on hover or focus. The link text carries the
 * meaning on its own.
 */
export function SwarmTierCta({ href = "#tiers" }: { href?: string }) {
  return (
    <Link className="tier-cta swarm-mark-trigger" href={href}>
      <SwarmMark />
      <span className="tier-cta-text">
        <span className="tier-cta-kicker">Next tier</span>
        <span className="tier-cta-name">Rallypoint Swarm</span>
      </span>
      <ArrowRight aria-hidden="true" className="tier-cta-arrow" />
    </Link>
  );
}
