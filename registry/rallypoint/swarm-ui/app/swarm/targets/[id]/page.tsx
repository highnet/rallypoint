import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { DeliveryBar, ScoreChart } from "../../_components/charts";
import { IssuePr, LabelChip, Ref } from "../../_components/chips";
import { ResultsTable } from "../../_components/results";
import { TargetMark, targetStyle } from "../../_components/icons";
import { Empty, Gate, GithubProblem, QueryErrors, Section, TimeAgo } from "../../_components/states";
import { cap, formatNumber, formatScore, word } from "../../_lib/format";
import { swarmConfig } from "../../swarm.config";
import { findTarget, getSwarmContext, getTarget, measureMode } from "../../_lib/queries";

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
      <header className="rp-head rp-target-head" style={targetStyle(data.target)}>
        <div className="rp-target-title">
          <TargetMark size="l" target={data.target} />
          <h1>{data.target.name}</h1>
        </div>
        {data.target.description ? <p className="rp-lede">{data.target.description}</p> : null}
        <p className="rp-measure">
          Issues for this {word("target")} carry the label <code>target:{data.target.id}</code>.{" "}
          <Link href="/swarm/targets">All {word("targets")}</Link>
        </p>
        <dl className="rp-tcard-figs rp-target-figs">
          {mode === "score" ? (
            <div>
              <dt>{swarmConfig.measure.label || cap(word("score"))}</dt>
              <dd className="rp-big">
                {formatNumber(data.versions[0]?.score ?? null)}
                {swarmConfig.measure.unit && data.versions[0]?.score != null ? (
                  <span className="rp-unit">{swarmConfig.measure.unit}</span>
                ) : null}
              </dd>
            </div>
          ) : null}
          <div>
            <dt>{cap(word("version"))}</dt>
            <dd className="rp-mid">{data.versions[0]?.version ?? "—"}</dd>
          </div>
          <div>
            <dt>{cap(word("results"))} passed</dt>
            <dd className="rp-mid">
              {formatNumber(data.results.filter((row) => row.passed).length)}
              <span className="rp-unit">of {formatNumber(data.results.length)}</span>
            </dd>
          </div>
          <div>
            <dt>{cap(word("buried"))}</dt>
            <dd className="rp-mid">{formatNumber(data.buried.length)}</dd>
          </div>
        </dl>
      </header>
      <QueryErrors errors={data.errors} />

      {mode === "score" ? (
        <Section title={`${swarmConfig.measure.label || cap(word("score"))} over time`}>
          {data.versions.some((row) => row.score !== null) ? (
            <ScoreChart label={`${data.target.name} ${word("score")}`} now={data.readAt} targets={[data.target]} versions={data.versions} />
          ) : (
            <Empty>
              Nothing {word("shipped")} with a {word("score")} yet. The first point appears when the merger runs{" "}
              <code>npx rallypoint swarm ship --target {data.target.id} --score &lt;n&gt;</code>.
            </Empty>
          )}
        </Section>
      ) : (
        <Section title="Delivery">
          {data.delivery && data.delivery.total > 0 ? (
            <DeliveryBar delivery={data.delivery} />
          ) : !data.github.ok ? (
            <GithubProblem failure={data.github}>
              <p className="rp-soft">
                Delivery is counted from issues labelled <code>target:{data.target.id}</code>.
              </p>
            </GithubProblem>
          ) : (
            <Empty>
              No issues for this {word("target")} yet. Open some with <code>npx rallypoint swarm plan plan.json</code>,
              giving each task <code>&quot;target&quot;: &quot;{data.target.id}&quot;</code>.
            </Empty>
          )}
        </Section>
      )}

      <Section title={`${cap(word("versions"))} ${word("shipped")}`}>
        {data.versions.length === 0 ? (
          <Empty>
            None yet. A merger records each one with <code>npx rallypoint swarm ship --target {data.target.id}</code>.
          </Empty>
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
          <Empty>
            None yet. An {word("idea")} that loses its referee run is recorded with{" "}
            <code>npx rallypoint swarm bury</code>.
          </Empty>
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
        {!data.github.ok ? (
          mode === "score" ? (
            <GithubProblem failure={data.github}>
              <p className="rp-soft">Open issues are read from GitHub.</p>
            </GithubProblem>
          ) : (
            <Empty>Open issues are read from GitHub, which could not be read: see Delivery above.</Empty>
          )
        ) : data.openIssues.length === 0 ? (
          <Empty>
            No open issues with the <code>target:{data.target.id}</code> label. Plan more with{" "}
            <code>npx rallypoint swarm plan plan.json</code>.
          </Empty>
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
