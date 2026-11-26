import type { Metadata } from "next";

import { TargetCard } from "../_components/bands";
import { Empty, Gate, PageHead, QueryErrors } from "../_components/states";
import { cap, word } from "../_lib/format";
import { getSwarmContext, getTargets } from "../_lib/queries";
import { swarmConfig } from "../swarm.config";

export const metadata: Metadata = { title: cap(word("targets")) };

export default async function TargetsPage() {
  const context = await getSwarmContext();
  if (context.state !== "ok") return <Gate context={context} />;
  const { targets, errors } = await getTargets();
  const score = swarmConfig.measure.mode === "score";

  return (
    <>
      <PageHead
        title={cap(word("targets"))}
        lede={`The parts of the goal the swarm works on, side by side. ${
          score
            ? `Each ${swarmConfig.measure.label || word("score")} is the latest ${word("version")} ${word("shipped")}, measured by the referee.`
            : `Each counts the ${word("versions")} ${word("shipped")} after passing the gate.`
        } Issues carry a target:<id> label.`}
      />
      <QueryErrors errors={errors} />
      {targets.length === 0 ? (
        <Empty>
          No {word("targets")} yet. Add them to <code>targets</code> in <code>.rallypoint/swarm.json</code>, run{" "}
          <code>npx rallypoint swarm init</code> to create their labels, then add each one to{" "}
          <code>swarm.config.ts</code> (or regenerate it with <code>npx rallypoint swarm ui-config --force</code>).
        </Empty>
      ) : (
        <div className="rp-tcards">
          {targets.map((entry) => (
            <TargetCard entry={entry} headingLevel={2} key={entry.target.id} />
          ))}
        </div>
      )}
    </>
  );
}
