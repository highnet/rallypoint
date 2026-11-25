import type { Metadata } from "next";

import { Outcome, TargetChip } from "../_components/chips";
import { Empty, Gate, PageHead, QueryErrors, Section } from "../_components/states";
import { cap, formatDelta, word } from "../_lib/format";
import { getConcepts, getSwarmContext } from "../_lib/queries";
import type { ConceptTrialRow, TrialOutcome } from "../_lib/types";

export const metadata: Metadata = { title: cap(word("concepts")) };
export const dynamic = "force-dynamic";

/** The cell for one concept on one target: its latest outcome and how many trials. */
function Cell({ trials }: { trials: ConceptTrialRow[] }) {
  if (trials.length === 0) {
    return (
      <span className="rp-soft">
        <span aria-hidden="true">–</span> untried
      </span>
    );
  }
  const latest = trials[trials.length - 1]!;
  const counts = trials.reduce<Record<TrialOutcome, number>>(
    (acc, trial) => ({ ...acc, [trial.outcome]: acc[trial.outcome] + 1 }),
    { gained: 0, lost: 0, neutral: 0 },
  );
  return (
    <span className="rp-cell">
      <Outcome outcome={latest.outcome} />
      {latest.delta !== null ? <span className="rp-soft">{formatDelta(latest.delta)}</span> : null}
      {trials.length > 1 ? (
        <span className="rp-soft">
          {trials.length} trials: {counts.gained} gained, {counts.lost} lost, {counts.neutral} neutral
        </span>
      ) : null}
    </span>
  );
}

export default async function ConceptsPage() {
  const context = await getSwarmContext();
  if (context.state !== "ok") return <Gate context={context} />;
  const { concepts, trials, targets, errors } = await getConcepts();

  return (
    <>
      <PageHead
        title={cap(word("concepts"))}
        lede={`Ideas that can travel between ${word("targets")}. A ${word("concept")} that gained on one ${word("target")} is the first thing to try on the others.`}
      />
      <QueryErrors errors={errors} />
      {concepts.length === 0 ? (
        <Empty>
          No {word("concepts")} yet. Add one with <code>npx rallypoint swarm concept add</code>.
        </Empty>
      ) : (
        <>
          <Section title={`${cap(word("concept"))} × ${word("target")}`} lede="The latest trial outcome in each cell, with its symbol and its word.">
            <div className="rp-scroll" role="region" aria-label={`${cap(word("concepts"))} matrix`} tabIndex={0}>
              <table className="rp-table rp-matrix">
                <thead>
                  <tr>
                    <th scope="col">{cap(word("concept"))}</th>
                    {targets.map((target) => (
                      <th key={target.id} scope="col">
                        <TargetChip id={target.id} />
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {concepts.map((concept) => (
                    <tr key={concept.id}>
                      <th scope="row">
                        {concept.name}
                        <br />
                        <code className="rp-soft">{concept.id}</code>
                      </th>
                      {targets.map((target) => (
                        <td key={target.id}>
                          <Cell
                            trials={trials.filter((trial) => trial.concept_id === concept.id && trial.target === target.id)}
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
          <Section title={`What each ${word("concept")} means`}>
            <dl className="rp-facts">
              {concepts.map((concept) => (
                <div key={concept.id}>
                  <dt>{concept.name}</dt>
                  <dd>{concept.description ?? "—"}</dd>
                </div>
              ))}
            </dl>
          </Section>
        </>
      )}
    </>
  );
}
