import type { Metadata } from "next";

import { IssuePr, TargetChip } from "../_components/chips";
import { Empty, Gate, PageHead, QueryErrors, TimeAgo } from "../_components/states";
import { cap, jsonEntries, word } from "../_lib/format";
import { getBuried, getSwarmContext } from "../_lib/queries";

export const metadata: Metadata = { title: `${cap(word("ideas"))} ${word("buried")}` };
export const dynamic = "force-dynamic";

export default async function BuriedPage() {
  const context = await getSwarmContext();
  if (context.state !== "ok") return <Gate context={context} />;
  const { buried, errors } = await getBuried();

  return (
    <>
      <PageHead
        title={`${cap(word("ideas"))} ${word("buried")}`}
        lede={`${cap(word("ideas"))} that lost to the baseline or failed their checks, kept with their numbers and the lesson, so no session tries them blind again.`}
      />
      <QueryErrors errors={errors} />
      {buried.length === 0 ? (
        <Empty>
          Nothing {word("buried")} yet. A worker records one with <code>npx rallypoint swarm bury</code>.
        </Empty>
      ) : (
        <ol className="rp-cards">
          {buried.map((row) => {
            const numbers = jsonEntries(row.numbers);
            return (
              <li key={row.id}>
                <div className="rp-card-meta">
                  <TargetChip id={row.target} />
                  <IssuePr issue={row.issue} pr={row.pr} />
                  {row.concept ? (
                    <span>
                      {word("concept")} <code>{row.concept}</code>
                    </span>
                  ) : null}
                  <TimeAgo at={row.created_at} />
                </div>
                <h2>{row.idea}</h2>
                <dl className="rp-facts">
                  {row.reason ? (
                    <div>
                      <dt>Why</dt>
                      <dd>{row.reason}</dd>
                    </div>
                  ) : null}
                  {row.lesson ? (
                    <div>
                      <dt>Lesson</dt>
                      <dd>{row.lesson}</dd>
                    </div>
                  ) : null}
                  {numbers.map(([key, value]) => (
                    <div key={key}>
                      <dt>
                        <code>{key}</code>
                      </dt>
                      <dd className="rp-break">{value}</dd>
                    </div>
                  ))}
                </dl>
              </li>
            );
          })}
        </ol>
      )}
    </>
  );
}
