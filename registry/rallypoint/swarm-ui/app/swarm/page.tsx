import Link from "next/link";

import { DeliveryBar, ScoreChart } from "./_components/charts";
import { ResultsTable } from "./_components/results";
import { Empty, Figures, Gate, PageHead, Panel, QueryErrors, Section } from "./_components/states";
import { cap, formatNumber, word } from "./_lib/format";
import { getProgress, getSwarmContext } from "./_lib/queries";
import { swarmConfig } from "./swarm.config";

export const dynamic = "force-dynamic";

export default async function ProgressPage() {
  const context = await getSwarmContext();
  if (context.state !== "ok") return <Gate context={context} />;
  const data = await getProgress(context.settings);
  const { measure } = swarmConfig;
  const title = data.goal.title || swarmConfig.project.name;

  return (
    <>
      <PageHead title={title} lede={data.goal.statement || swarmConfig.project.tagline}>
        <p className="rp-measure">
          {data.mode === "score" ? (
            <>
              Measured by {measure.label}
              {measure.unit ? ` (${measure.unit})` : ""}, {measure.direction} is better
            </>
          ) : data.mode === "checks" ? (
            <>
              Gated by {data.checkNames.length > 0 ? data.checkNames.length : "named"} checks
              {data.checkNames.length > 0 ? (
                <>
                  :{" "}
                  {data.checkNames.map((name, index) => (
                    <span key={name}>
                      {index > 0 ? ", " : ""}
                      <code>{name}</code>
                    </span>
                  ))}
                </>
              ) : null}
            </>
          ) : (
            <>Gated by independent review against each issue&rsquo;s acceptance criteria</>
          )}
          {data.measureCommand && data.mode === "score" ? (
            <>
              {" "}
              · <code>{data.measureCommand}</code>
            </>
          ) : null}
        </p>
      </PageHead>
      <QueryErrors errors={data.errors} />

      <Figures
        items={[
          { label: cap(word("sessions")), value: formatNumber(data.sessionCount) },
          { label: "Working now", value: formatNumber(data.metrics?.sessions_working) },
          { label: cap(word("shipped")), value: formatNumber(data.metrics?.shipped) },
          { label: cap(word("buried")), value: formatNumber(data.metrics?.buried) },
        ]}
      />

      {data.mode === "score" ? (
        <Section
          title={`${measure.label || cap(word("score"))} over time`}
          lede={`Each step is a ${word("version")} ${word("shipped")} after it beat the baseline.`}
        >
          {data.versions.some((row) => row.score !== null) ? (
            <ScoreChart
              label={`${measure.label || cap(word("score"))} of ${word("shipped")} ${word("versions")}`}
              targets={data.targets}
              versions={data.versions}
            />
          ) : (
            <Empty>
              Nothing {word("shipped")} with a {word("score")} yet. The merger records one with{" "}
              <code>npx rallypoint swarm ship</code>.
            </Empty>
          )}
        </Section>
      ) : (
        <Section title="Delivery" lede="Every issue counted once, at the furthest point it has reached.">
          {data.github && !data.github.ok ? (
            <Panel title="GitHub not connected" tone="warn">
              <p>{data.github.message}</p>
            </Panel>
          ) : data.delivery ? (
            <>
              <DeliveryBar delivery={data.delivery} />
              {data.deliveryByTarget.length > 0 ? (
                <div className="rp-stack">
                  {data.deliveryByTarget.map((entry) => (
                    <DeliveryBar delivery={entry.delivery} key={entry.target.id} label={entry.target.name} />
                  ))}
                </div>
              ) : null}
            </>
          ) : null}
        </Section>
      )}

      <Section title={`Latest ${word("results")}`} lede="Each row is one referee run.">
        <ResultsTable results={data.results} />
        {data.results.length > 0 ? (
          <p>
            <Link href="/swarm/results">All {word("results")}</Link>
          </p>
        ) : null}
      </Section>
    </>
  );
}
