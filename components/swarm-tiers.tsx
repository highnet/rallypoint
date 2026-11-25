import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { CommandCopy } from "@/components/command-copy";
import { loopStack, StackList, swarmStack } from "@/components/stack-list";
import { SwarmMark } from "@/components/swarm-mark";
import { swarmCommands } from "@/lib/swarm";

/**
 * The two-tier choice, side by side, directly under the hero: what each tier
 * costs, what it gives, and the first working step for either.
 */
export function SwarmTiers() {
  return (
    <section aria-labelledby="tiers-title" className="tiers" id="tiers">
      <h2 className="sr-only" id="tiers-title">
        Choose a tier
      </h2>
      <div className="tier">
        <SwarmMark className="tier-mark" variant="rank" />
        <p className="tier-name">Rallypoint</p>
        <p className="tier-cost">GitHub only · zero setup</p>
        <p className="tier-gives">
          Roles, labels, an atomic claim and independent review, coordinated through issues and pull
          requests alone.
        </p>
        <StackList items={loopStack} label="Rallypoint runs on" />
        <CommandCopy command={swarmCommands.addLoop} id="tier-loop" label="install command" />
        <p className="tier-links">
          <Link className="text-link" href="#install">
            Install steps <ArrowRight aria-hidden="true" />
          </Link>
        </p>
      </div>
      <div className="tier tier-swarm swarm-mark-trigger">
        <p className="tier-badge">Next tier</p>
        <SwarmMark className="tier-mark" />
        <p className="tier-name">
          Rallypoint <span className="tier-name-swarm">Swarm</span>
        </p>
        <p className="tier-cost">Builds on the loop · + your own Supabase · more setup, more capability</p>
        <p className="tier-gives">
          Shared memory, a referee on every change, roles that pick themselves, a retro from every
          session, and a conductor loop that keeps the swarm running on hard goals.
        </p>
        <StackList items={swarmStack} label="Rallypoint Swarm runs on" />
        <CommandCopy command={swarmCommands.addSwarm} id="tier-swarm" label="Swarm install command" />
        <p className="tier-links">
          <Link className="text-link" href="/swarm/wizard">
            Describe your swarm <ArrowRight aria-hidden="true" />
          </Link>
          <Link className="text-link" href="#swarm">
            Compare the tiers
          </Link>
        </p>
      </div>
    </section>
  );
}
