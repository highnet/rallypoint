import Link from "next/link";
import type { ReactNode } from "react";

import { Band, Hero, NextLink, Steps, TargetCard } from "./_components/bands";
import { DeliveryBar, ScoreChart } from "./_components/charts";
import { IssuePr, TargetChip } from "./_components/chips";
import { ResultsTable } from "./_components/results";
import { RoleTag } from "./_components/role";
import { Empty, Gate, Panel, QueryErrors, TimeAgo } from "./_components/states";
import { cap, formatNumber, formatScore, word } from "./_lib/format";
import { findTarget, getProgress, getSwarmContext, getTargets, type ProgressData } from "./_lib/queries";
import { swarmConfig } from "./swarm.config";

/** The newest thing in memory, as one sentence with a link. */
function latestEvent(data: ProgressData): { at: string; text: ReactNode; href: string } | null {
  const events: { at: string; text: ReactNode; href: string }[] = [];
  const version = data.versions[data.versions.length - 1];
  if (version) {
    const name = version.target ? (findTarget(version.target)?.name ?? version.target) : "";
    events.push({
      at: version.created_at,
      href: "/swarm/versions",
      text: (
        <>
          <span className="rp-soft">{cap(word("shipped"))}:</span> {name ? `${name} ` : ""}
          <span className="rp-mono">{version.version}</span>
          {version.score !== null ? ` at ${formatScore(version.score)}` : ""}
          {version.notes ? `. ${version.notes}` : ""}
        </>
      ),
    });
  }
  const buried = data.lastBuried;
  if (buried) {
    events.push({
      at: buried.created_at,
      href: "/swarm/buried",
      text: (
        <>
          <span className="rp-soft">{cap(word("buried"))}:</span> {buried.idea}
        </>
      ),
    });
  }
  const result = data.results[0];
  if (result) {
    const name = result.target ? (findTarget(result.target)?.name ?? result.target) : "";
    events.push({
      at: result.created_at,
      href: `/swarm/results/${result.id}`,
      text: (
        <>
          <span className="rp-soft">{cap(word("result"))}:</span> {name ? `${name} ` : ""}
          {result.passed === null ? "measured" : result.passed ? "passed" : "failed"}
          {result.pr ? ` on PR #${result.pr}` : result.issue ? ` on #${result.issue}` : ""}
        </>
      ),
    });
  }
  events.sort((a, b) => b.at.localeCompare(a.at));
  return events[0] ?? null;
}

function measureLine(data: ProgressData): ReactNode {
  const { measure } = swarmConfig;
  if (data.mode === "score") {
    return (
      <>
        Measured by {measure.label}
        {measure.unit ? ` in ${measure.unit}` : ""}, {measure.direction} is better
      </>
    );
  }
  if (data.mode === "checks") {
    return data.checkNames.length > 0 ? (
      <>
        Gated by {data.checkNames.length} {data.checkNames.length === 1 ? "check" : "checks"}:{" "}
        {data.checkNames.map((name, index) => (
          <span key={name}>
            {index > 0 ? ", " : ""}
            <code>{name}</code>
          </span>
        ))}
      </>
    ) : (
      <>Gated by named checks that must all pass</>
    );
  }
  return <>Gated by independent review against each issue&rsquo;s acceptance criteria</>;
}

export default async function ProgressPage() {
  const context = await getSwarmContext();
  if (context.state !== "ok") return <Gate context={context} />;
  const [data, summary] = await Promise.all([getProgress(context.settings), getTargets()]);
  const { measure } = swarmConfig;
  const title = data.goal.title || swarmConfig.project.name;
  const lede =
    data.goal.statement ||
    swarmConfig.project.tagline ||
    `The public record of this swarm: who is working now, every ${word("result")} the referee measured, what ${word("shipped")} and what was ${word("buried")}.`;
  const latest = latestEvent(data);
  const working = data.fleet.filter((row) => row.status === "working");
  const targets = summary.targets;
  const metric = measure.label || cap(word("score"));

  const gate =
    data.mode === "score"
      ? `A referee measures ${metric}${measure.unit ? ` in ${measure.unit}` : ""} against the current ${word("version")}. Only a change that beats it ${word("shipped")}.`
      : data.mode === "checks"
        ? "A referee runs the named checks on every change. Anything less than all green is not merged."
        : "An independent reviewer checks every change against the issue's acceptance criteria before it merges.";

  return (
    <div className="rp-overview">
      {latest ? (
        <p className="rp-justin">
          <span className="rp-justin-label">
            <span aria-hidden="true" className="rp-live-dot" />
            Latest
          </span>
          <span className="rp-justin-text">{latest.text}</span>
          <span className="rp-justin-time">
            <TimeAgo at={latest.at} />
          </span>
          <NextLink href={latest.href}>Read it</NextLink>
        </p>
      ) : null}

      <Hero
        actions={
          <>
            <Link className="rp-button rp-button-hero" href={targets.length > 0 ? "/swarm/targets" : "/swarm/how-it-works"}>
              {targets.length > 0 ? `See the ${word("targets")}` : "See how it works"}
            </Link>
            {data.mode === "score" ? (
              <NextLink href="#b-progress">Watch them improve</NextLink>
            ) : (
              <NextLink href="#b-progress">See delivery</NextLink>
            )}
            <NextLink href="/swarm/results">Every {word("result")}</NextLink>
            {targets.length > 0 ? <NextLink href="/swarm/how-it-works">How it works</NextLink> : null}
          </>
        }
        note={measureLine(data)}
        lede={lede}
        title={title}
      />

      <QueryErrors errors={[...data.errors, ...summary.errors]} />

      <Band id="b-right-now" title="Right now" tone="sunk">
        <div className="rp-now">
          <div className="rp-now-main">
            <p className="rp-now-status">
              {working.length === 0
                ? "Nobody is working right now."
                : `${working.length} ${working.length === 1 ? `${word("agent")} is` : `${word("agent")}s are`} working right now.`}
            </p>
            {working.length === 0 ? (
              <p className="rp-soft">
                An {word("agent")} shows up here as soon as it opens a {word("session")} with{" "}
                <code>npx rallypoint swarm prepare</code> and takes a role with <code>swarm next</code>.
                Run <code>npx rallypoint swarm doctor</code> first if the swarm has never run.
              </p>
            ) : (
              <ul className="rp-now-list">
                {working.map((row) => (
                  <li key={row.id}>
                    <RoleTag role={row.role} />
                    <span className="rp-now-what">
                      {row.summary || row.latest_note || "Working"}
                      <span className="rp-now-who">
                        <span className="rp-mono">{row.agent ?? ""}</span>
                        {row.issue || row.pr ? <IssuePr issue={row.issue} pr={row.pr} /> : null}
                        {row.last_seen_at ? <TimeAgo at={row.last_seen_at} /> : null}
                      </span>
                    </span>
                    {row.target ? <TargetChip id={row.target} /> : null}
                  </li>
                ))}
              </ul>
            )}
            <NextLink href="/swarm/fleet">See the fleet</NextLink>
          </div>
          <div className="rp-now-side">
            {latest ? (
              <>
                <p className="rp-now-meta">
                  Latest · <TimeAgo at={latest.at} />
                </p>
                <p className="rp-now-latest">{latest.text}</p>
              </>
            ) : (
              <>
                <p className="rp-now-meta">Latest</p>
                <p className="rp-now-latest">
                  <span className="rp-soft">Nothing recorded yet.</span> The record starts with the first
                  referee run. Seed work with <code>npx rallypoint swarm plan plan.json</code>.
                </p>
              </>
            )}
            <NextLink href="/swarm/board">The whole record</NextLink>
          </div>
        </div>
      </Band>

      <Band
        action={targets.length > 0 ? <NextLink href="/swarm/targets">Compare all {targets.length}</NextLink> : undefined}
        id="b-targets"
        lede={
          targets.length > 0
            ? `${targets.length === 1 ? "One part" : `${cap(numberWord(targets.length))} parts`} of the goal, each with its own record. ${
                data.mode === "score" ? `Each ${word("score")} comes only from referee runs.` : `Each ${word("version")} merged only after its gate.`
              }`
            : undefined
        }
        title={`The ${word("targets")}`}
      >
        {targets.length === 0 ? (
          <Empty>
            No {word("targets")} yet. Add them to <code>targets</code> in <code>.rallypoint/swarm.json</code>,
            run <code>npx rallypoint swarm init</code> to create their labels, then add each one to{" "}
            <code>swarm.config.ts</code> (or regenerate it with{" "}
            <code>npx rallypoint swarm ui-config --force</code>).
          </Empty>
        ) : (
          <div className="rp-tcards">
            {targets.map((entry) => (
              <TargetCard entry={entry} key={entry.target.id} />
            ))}
          </div>
        )}
      </Band>

      {data.mode === "score" ? (
        <Band
          id="b-progress"
          lede={`Each line is one ${word("target")}'s ${metric}, ${word("version")} by ${word("version")}. A step up means a new ${word("version")} beat the one before it.`}
          title={`Watch ${metric} improve`}
          tone="sunk"
        >
          {data.versions.some((row) => row.score !== null) ? (
            <ScoreChart label={`${metric} of ${word("shipped")} ${word("versions")}`} now={data.readAt} targets={data.targets} versions={data.versions} />
          ) : (
            <Empty>
              Nothing {word("shipped")} with a {word("score")} yet. The first point appears when the merger runs{" "}
              <code>npx rallypoint swarm ship --score &lt;n&gt;</code> after a passing referee run.
            </Empty>
          )}
        </Band>
      ) : (
        <Band id="b-progress" lede="Every issue counted once, at the furthest point it has reached." title="Delivery" tone="sunk">
          {data.github && !data.github.ok ? (
            <Panel title={data.github.reason === "no-repo" ? "GitHub is not connected" : "GitHub could not be read"} tone="warn">
              <p>
                Delivery is counted from the repository&rsquo;s issues and pull requests.{" "}
                {data.github.reason === "no-repo" ? (
                  <>
                    Set <code>RALLYPOINT_GITHUB_REPO=owner/name</code> (and optionally{" "}
                    <code>RALLYPOINT_GITHUB_TOKEN</code>) and restart the dashboard.
                  </>
                ) : (
                  data.github.message
                )}
              </p>
              <p className="rp-soft">
                Everything else on this page comes from memory and works without it.
              </p>
            </Panel>
          ) : data.delivery && data.delivery.total > 0 ? (
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
          ) : (
            <Empty>
              No issues yet. Write the work as a list of tasks and open them with{" "}
              <code>npx rallypoint swarm plan plan.json</code>; each one becomes an issue an {word("agent")} can claim.
            </Empty>
          )}
        </Band>
      )}

      <Band
        action={data.results.length > 0 ? <NextLink href="/swarm/results">All {word("results")}</NextLink> : undefined}
        lede="Each row is one referee run on a candidate change."
        title={`Latest ${word("results")}`}
      >
        <ResultsTable results={data.results} />
      </Band>

      <Band
        action={<NextLink href="/swarm/how-it-works">The whole story</NextLink>}
        lede={
          <>
            No {word("agent")} grades its own work. So far: {formatNumber(data.sessionCount ?? 0)} {word("sessions")},{" "}
            {formatNumber(data.metrics?.shipped ?? 0)} {word("versions")} {word("shipped")} and{" "}
            {formatNumber(data.metrics?.buried ?? 0)} {word("ideas")} {word("buried")}.
          </>
        }
        title="How it works"
        tone="sunk"
      >
        <Steps
          steps={[
            { title: "One task, one agent", body: `Every change starts as a GitHub issue. One ${word("agent")} claims it, and nobody else can.` },
            { title: data.mode === "review" ? "Review decides" : "The referee decides", body: gate },
            { title: "Another agent merges", body: `A separate ${word("agent")} reviews the pull request and a merger lands it, recording the new ${word("version")}.` },
            { title: "Failures are kept", body: `An ${word("idea")} that loses is ${word("buried")} with its numbers and the lesson, so nobody tries it blind again.` },
          ]}
        />
      </Band>
    </div>
  );
}

function numberWord(value: number): string {
  return ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"][value] ?? String(value);
}
