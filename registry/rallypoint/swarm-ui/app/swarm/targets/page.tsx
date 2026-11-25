import type { Metadata } from "next";

import { TargetCard } from "../_components/target-card";
import { Empty, Gate, PageHead, QueryErrors } from "../_components/states";
import { cap, word } from "../_lib/format";
import { getOverview, getSwarmContext } from "../_lib/queries";

export const metadata: Metadata = { title: cap(word("targets")) };
export const dynamic = "force-dynamic";

export default async function TargetsPage() {
  const context = await getSwarmContext();
  if (context.state !== "ok") return <Gate context={context} />;
  const data = await getOverview(context.settings);

  return (
    <>
      <PageHead
        eyebrow="Results"
        title={cap(word("targets"))}
        lede={`The parts of the goal the swarm works on, each with its own history. Issues carry a target:<id> label.`}
      />
      <QueryErrors errors={data.errors} />
      {data.cards.length === 0 ? (
        <Empty
          next={
            <>
              List them under <code>targets</code> in <code>.rallypoint/swarm.json</code>, then run{" "}
              <code>npx rallypoint swarm ui-config --force</code> (or edit <code>swarm.config.ts</code> directly).
            </>
          }
        >
          No {word("targets")} yet.
        </Empty>
      ) : (
        <ul className="rp-cards-grid">
          {data.cards.map((entry) => (
            <TargetCard
              entry={entry}
              key={entry.target.id}
              lastRun={data.results.find((row) => row.target === entry.target.id) ?? null}
              mode={data.mode}
            />
          ))}
        </ul>
      )}
    </>
  );
}
