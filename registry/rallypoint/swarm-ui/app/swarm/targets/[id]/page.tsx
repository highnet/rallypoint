import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { DeliveryBar, ScoreChart } from "../../_components/charts";
import { IssuePr, LabelChip, Ref, TargetChip } from "../../_components/chips";
import { ResultsTable } from "../../_components/results";
import { Empty, Gate, PageHead, Panel, QueryErrors, Section, TimeAgo } from "../../_components/states";
import { cap, formatScore, word } from "../../_lib/format";
import { swarmConfig } from "../../swarm.config";
import { findTarget, getSwarmContext, getTarget, measureMode } from "../../_lib/queries";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  return { title: findTarget(decodeURIComponent(id))?.name ?? decodeURIComponent(id) };
}

export default async function TargetPage({ params }: Props) {
  const { id: raw } = await params;
  const id = decodeURIComponent(raw);
  const context = await getSwarmContext();
  if (context.state !== "ok") return <Gate context={context} />;
  const data = await getTarget(id);
  if (!data) notFound();
  const mode = measureMode(context.settings);

  return (
    <>
      <PageHead title={data.target.name} lede={data.target.description || undefined}>
        <p>
          <TargetChip id={data.target.id} /> · label <code>target:{data.target.id}</code>
        </p>
      </PageHead>
      <QueryErrors errors={data.errors} />

      {mode === "score" ? (
        <Section title={`${swarmConfig.measure.label || cap(word("score"))} over time`}>
          {data.versions.some((row) => row.score !== null) ? (
            <ScoreChart label={`${data.target.name} ${word("score")}`} targets={[data.target]} versions={data.versions} />
          ) : (
            <Empty>Nothing {word("shipped")} with a {word("score")} yet.</Empty>
          )}
        </Section>
      ) : (
        <Section title="Delivery">
          {data.delivery ? (
            <DeliveryBar delivery={data.delivery} />
          ) : !data.github.ok ? (
            <Panel title="GitHub not connected" tone="warn">
              <p>{data.github.message}</p>
            </Panel>
          ) : null}
        </Section>
      )}

      <Section title={`${cap(word("versions"))} ${word("shipped")}`}>
        {data.versions.length === 0 ? (
          <Empty>None yet.</Empty>
        ) : (
          <ul className="rp-list">
            {data.versions.map((row) => (
              <li key={row.id}>
                <span className="rp-mono">{row.version}</span>
                {row.score !== null ? <> · {formatScore(row.score)}</> : null} · PR <Ref value={row.pr} /> ·{" "}
                <TimeAgo at={row.created_at} />
                {row.notes ? <p className="rp-soft">{row.notes}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={cap(word("results"))}>
        <ResultsTable results={data.results} showTarget={false} />
      </Section>

      <Section title={`${cap(word("ideas"))} ${word("buried")}`}>
        {data.buried.length === 0 ? (
          <Empty>None yet.</Empty>
        ) : (
          <ul className="rp-list">
            {data.buried.map((row) => (
              <li key={row.id}>
                <strong>{row.idea}</strong> <IssuePr issue={row.issue} pr={row.pr} />
                {row.lesson ? <p>{row.lesson}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Open issues">
        {data.openIssues.length === 0 ? (
          <Empty>No open issues with the target:{data.target.id} label.</Empty>
        ) : (
          <ul className="rp-list">
            {data.openIssues.map((item) => (
              <li key={item.number}>
                <Ref value={item.number} /> {item.title}{" "}
                {item.labels
                  .filter((label) => !label.name.startsWith("target:"))
                  .map((label) => (
                    <LabelChip color={label.color} key={label.name} name={label.name} />
                  ))}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>
  );
}
