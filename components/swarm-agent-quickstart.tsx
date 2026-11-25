import Link from "next/link";

import { CommandCopy } from "@/components/command-copy";
import {
  agentSetupPrompt,
  buildSwarmConfig,
  emptyWizard,
  swarmCliCommands,
  swarmCommands,
  swarmPrompts,
} from "@/lib/swarm";

/**
 * /swarm, read as an agent: no pitch, just what to run. Two entry points: the
 * repository has no swarm yet (set it up), or it has one (take a role).
 */
export function SwarmAgentQuickstart() {
  const setup = agentSetupPrompt(
    "<the operator's pitch>",
    JSON.stringify(buildSwarmConfig(emptyWizard), null, 2),
    "none",
  );
  return (
    <div className="swarm-agent-page">
    <div className="agent-quickstart">
      <h1>Set up the swarm, or take your role.</h1>
      <p className="lede">
        Rallypoint Swarm runs on top of the loop: GitHub owns the work, the operator&rsquo;s own
        Supabase owns the memory. Check which case you are in with{" "}
        <code>test -f .rallypoint/swarm.json</code>.
      </p>

      <h2>No swarm here yet: set it up</h2>
      <p className="agent-constraint">
        Ask the operator for the pitch, or have them generate a tailored prompt at{" "}
        <Link className="text-link" href="/swarm/wizard">
          /swarm/wizard
        </Link>
        . Stop for Supabase access and the secret; never print or commit it.
      </p>
      <CommandCopy className="command-block command-json command-tall" command={setup} id="agent-swarm-setup" label="setup prompt" shell={false} />

      <h2>A swarm is installed: take your role</h2>
      <div className="agent-commands">
        <CommandCopy command={swarmCommands.doctor} id="agent-swarm-doctor-2" />
        <CommandCopy command="npx rallypoint@latest swarm prepare" id="agent-swarm-prepare" />
        <CommandCopy command="npx rallypoint@latest swarm next" id="agent-swarm-next-2" />
      </div>
      <p className="agent-constraint">
        <code>next</code> prints <code>ROLE</code>, <code>TARGET</code> and the files to{" "}
        <code>READ</code>. Do that one role, <code>swarm log</code> as you go, referee before you open a
        pull request, and end with <code>swarm retro</code>.
      </p>

      <h2>Prompts by situation</h2>
      <ul className="agent-prompts">
        {swarmPrompts().map((item) => (
          <li key={item.id}>
            <p className="step-title">{item.title}</p>
            <p className="install-detail">{item.when}</p>
            <CommandCopy command={item.prompt} id={`agent-prompt-${item.id}`} label={`${item.title.toLowerCase()} prompt`} shell={false} />
          </li>
        ))}
      </ul>

      <h2>Commands</h2>
      <ul className="agent-cli">
        {swarmCliCommands.map((item) => (
          <li key={item.command}>
            <code>swarm {item.command}</code> {item.does}
          </li>
        ))}
      </ul>

      <p className="agent-constraint">
        Constraints: one role per session; never review or merge your own work; a change that loses at
        the referee is buried, not merged; the referee, scripts and schema are frozen; the swarm secret
        never leaves the environment.
      </p>
    </div>
    </div>
  );
}
