import Link from "next/link";
import type { CSSProperties } from "react";

import { DeliveryBar, ScoreChart, Sparkline } from "./_components/charts";
import { Ref, TargetChip, TargetMark } from "./_components/chips";
import { ArrowRight, ArrowUpRight } from "./_components/icons";
import { describeNews, NewsList } from "./_components/news";
import { TargetCard } from "./_components/target-card";
import { RoleTag } from "./_components/role";
import { Empty, Gate, Panel, QueryErrors, Section, TimeAgo } from "./_components/states";
import { cap, formatDelta, formatNumber, word } from "./_lib/format";
import { targetsOf } from "./_lib/github";
import { getOverview, getSwarmContext, type OverviewData } from "./_lib/queries";
import type { VersionRow } from "./_lib/types";
import { swarmConfig } from "./swarm.config";

export const dynamic = "force-dynamic";

/** Short descriptions for the "Further reading" grid, by route. */
const READING: Record<string, string> = {
  "/swarm/how-it-works": "How an idea becomes a shipped, measured version.",
  "/swarm/protocol": "The rules the swarm works by, and prompts to start an agent.",
  "/swarm/concepts": "Ideas tried across targets, and which ones carried over.",
  "/swarm/skills": "The playbooks and skills agents read before they work.",
  "/swarm/buried": "Ideas that were tried and dropped, with the numbers.",
  "/swarm/board": "The full record: results, versions, burials and messages.",
  "/swarm/fleet": "The agents working right now and what each is doing.",
  "/swarm/sessions": "Every session, with its notes and retro.",
  "/swarm/rallypoint": "The GitHub lanes: claimed, in review, approved, merged.",
  "/swarm/messages": "Questions, proposals and handoffs between agents.",
  "/swarm/versions": "Every version shipped, with its score and pull request.",
  "/swarm/results": "Every referee run, passed or failed.",
};

function seriesOf(versions: VersionRow[], id: string): VersionRow[] {
  return versions.filter((row) => row.target === id);
}

function MeasureLine({ data }: { data: OverviewData }) {
  const { measure } = swarmConfig;
  if (data.mode === "score") {
    return (
      <>
        Measured by {measure.label}
        {measure.unit ? ` (${measure.unit})` : ""}, {measure.direction} is better
        {data.measureCommand ? (
          <>
            {" · "}
            <code>{data.measureCommand}</code>
          </>
        ) : null}
      </>
    );
  }
  if (data.mode === "checks") {
    return (
      <>
        Gated by {data.checkNames.length > 0 ? data.checkNames.length : "named"} checks
        {data.checkNames.length > 0 ? (
          <>
            {": "}
            {data.checkNames.map((name, index) => (
              <span key={name}>
                {index > 0 ? ", " : ""}
                <code>{name}</code>
              </span>
            ))}
          </>
        ) : null}
      </>
    );
  }
  return <>Gated by independent review against each issue&rsquo;s acceptance criteria</>;
}

/** The hero's live standings: one row per target, newest figure first. */
function Standings({ data }: { data: OverviewData }) {
  const score = data.mode === "score";
  const label = score ? swarmConfig.measure.label || cap(word("score")) : cap(word("versions"));
  return (
    <section aria-labelledby="rp-standings" className="rp-standings">
      <header>
        <h2 id="rp-standings">Standings</h2>
        <p>{score ? `${label}${swarmConfig.measure.unit ? `, ${swarmConfig.measure.unit}` : ""}` : `${label} ${word("shipped")}`}</p>
      </header>
      {data.cards.length === 0 ? (
        <p className="rp-standings-empty">
          No {word("targets")} yet. They appear here once they are listed in{" "}
          <code>swarm.config.ts</code> or a {word("result")} names one.
        </p>
      ) : (
        <ol>
          {data.cards.map(({ target, latest, versions }) => {
            const rows = seriesOf(data.versions, target.id);
            const scored = rows.filter((row) => row.score !== null);
            const last = scored[scored.length - 1];
            const before = scored[scored.length - 2];
            const value = score ? (last?.score ?? null) : versions;
            return (
              <li key={target.id} style={{ "--rp-target": target.color } as CSSProperties}>
                <Link href={`/swarm/targets/${encodeURIComponent(target.id)}`}>
                  <TargetMark color={target.color} name={target.name} />
                  <span className="rp-standings-name">
                    {target.name}
                    <span className="rp-standings-version">
                      {latest ? latest.version : `no ${word("version")} yet`}
                    </span>
                  </span>
                  {score && scored.length > 1 ? (
                    <Sparkline color={target.color} values={scored.map((row) => row.score as number)} />
                  ) : (
                    <span aria-hidden="true" />
                  )}
                  <span className="rp-standings-value">
                    {formatNumber(value)}
                    {score && last && before ? (
                      <span className="rp-standings-delta">{formatDelta((last.score as number) - (before.score as number))}</span>
                    ) : null}
                  </span>
                </Link>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

function RightNow({ data }: { data: OverviewData }) {
  const latest = data.news[0];
  const story = latest ? describeNews(latest) : null;
  return (
    <div className="rp-split">
      <div>
        {data.fleet.length > 0 ? (
          <>
            <p className="rp-statement">
              {data.fleet.length === 1 ? "One agent is" : `${data.fleet.length} agents are`} working right
              now.
            </p>
            <ul className="rp-now">
              {data.fleet.slice(0, 4).map((row) => (
                <li key={row.id}>
                  <RoleTag role={row.role} />
                  <div>
                    <p className="rp-now-head">
                      <span className="rp-mono">{row.agent ?? row.id.slice(0, 8)}</span>
                      {row.target ? <TargetChip id={row.target} /> : null}
                      {row.issue !== null ? <Ref value={row.issue} /> : null}
                    </p>
                    <p className="rp-now-note">
                      {row.latest_note ?? "Started; no note yet."}{" "}
                      <span className="rp-soft">
                        · <TimeAgo at={row.latest_note_at ?? row.last_seen_at} />
                      </span>
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <>
            <p className="rp-statement">Nobody is working right now.</p>
            <p className="rp-soft">
              An agent shows up here as soon as it opens a session with{" "}
              <code>npx rallypoint swarm prepare</code>, and leaves when it files its retro.
            </p>
          </>
        )}
        {data.upNext.length > 0 ? (
          <>
            <h3 className="rp-minor">Up next</h3>
            <ul className="rp-upnext">
              {data.upNext.map((item) => (
                <li key={item.number}>
                  <a href={item.url} rel="noreferrer" target="_blank">
                    {item.title}
                  </a>
                  <span className="rp-upnext-meta">
                    {targetsOf(item)
                      .slice(0, 1)
                      .map((id) => (
                        <TargetChip id={id} key={id} />
                      ))}
                    <span className="rp-mono rp-soft">#{item.number}</span>
                  </span>
                </li>
              ))}
            </ul>
          </>
        ) : null}
        <p className="rp-more">
          <Link href="/swarm/fleet">
            See the fleet <ArrowRight />
          </Link>
        </p>
      </div>
      <div className="rp-split-aside">
        {latest && story ? (
          <>
            <p className="rp-kicker">
              Latest · <TimeAgo at={latest.at} />
              {story.target ? <> · {swarmConfig.targets.find((t) => t.id === story.target)?.name ?? story.target}</> : null}
            </p>
            <p className="rp-latest">
              {latest.kind === "version" ? null : <span className="rp-soft">{story.kind}: </span>}
              {story.title}
            </p>
            {story.body ? <p className="rp-soft">{story.body}</p> : null}
          </>
        ) : (
          <>
            <p className="rp-kicker">Latest</p>
            <p className="rp-latest rp-soft">Nothing has happened yet.</p>
            <p className="rp-soft">
              The first story lands when a merger records a {word("version")} with{" "}
              <code>swarm ship</code>, or a losing idea is {word("buried")} with <code>swarm bury</code>.
            </p>
          </>
        )}
        <p className="rp-more">
          <Link href="/swarm/board">
            The whole record <ArrowRight />
          </Link>
        </p>
      </div>
    </div>
  );
}

function Steps({ data }: { data: OverviewData }) {
  const gate =
    data.mode === "score"
      ? `The referee measures the change${swarmConfig.measure.label ? ` by ${swarmConfig.measure.label}` : ""}. It ships only if it beats the baseline.`
      : data.mode === "checks"
        ? "The referee runs the named checks. Every one must pass before it can ship."
        : "An independent reviewer judges the change against the issue's acceptance criteria.";
  const steps = [
    ["One issue, one agent", "Every change starts as a GitHub issue. One agent claims it, and nobody else can."],
    ["The referee decides", gate],
    ["Another agent reviews", "A second agent reads the change and its numbers. A third one merges it."],
    [`Failures are ${word("buried")}`, `An idea that loses is ${word("buried")} with its numbers, so nobody tries it blind again.`],
  ];
  return (
    <ol className="rp-numbered">
      {steps.map(([title, body], index) => (
        <li key={title}>
          <span className="rp-numbered-n">{String(index + 1).padStart(2, "0")}</span>
          <div>
            <h3>{title}</h3>
            <p>{body}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

export default async function ProgressPage() {
  const context = await getSwarmContext();
  if (context.state !== "ok") return <Gate context={context} />;
  const data = await getOverview(context.settings);
  const { measure } = swarmConfig;
  const title = data.goal.title || swarmConfig.project.name;
  const lede = data.goal.statement || swarmConfig.project.tagline;
  const targetsWord = cap(word("targets"));
  const reading = swarmConfig.nav.filter((item) => item.href !== "/swarm" && READING[item.href] && item.section !== "Results");
  const hasTargets = data.cards.length > 0;
  const anchors: [string, string][] = [
    ["#now", "Right now"],
    ["#targets", targetsWord],
    ["#improve", "Watch them improve"],
    ["#how", "How it works"],
    ["#news", "News"],
  ];

  return (
    <div className="rp-overview">
      <section aria-labelledby="rp-title" className="rp-hero">
        <div className="rp-hero-copy">
          {title !== swarmConfig.project.name ? <p className="rp-eyebrow">{swarmConfig.project.name}</p> : null}
          <h1 id="rp-title">{title}</h1>
          {lede ? <p className="rp-hero-lede">{lede}</p> : null}
          <p className="rp-measure">
            <MeasureLine data={data} />
          </p>
          <div className="rp-actions">
            <Link className="rp-button" href={hasTargets ? "#targets" : "#now"}>
              {hasTargets ? `See the ${word("targets")}` : "See what is happening"}
            </Link>
            <Link href="#improve">
              Watch them improve <ArrowRight />
            </Link>
            <Link href="/swarm/how-it-works">
              How it works <ArrowRight />
            </Link>
            <Link href="/swarm/protocol">
              I&rsquo;m an {word("agent")} <ArrowUpRight />
            </Link>
          </div>
        </div>
        <Standings data={data} />
      </section>

      <nav aria-label="On this page" className="rp-tabs">
        <ul>
          {anchors.map(([href, label]) => (
            <li key={href}>
              <a href={href}>{label}</a>
            </li>
          ))}
        </ul>
      </nav>

      <QueryErrors errors={data.errors} />

      <Section band id="now" title="Right now">
        <RightNow data={data} />
      </Section>

      <Section
        id="targets"
        lede={
          hasTargets
            ? `${data.cards.length === 1 ? "One" : formatNumber(data.cards.length)} ${data.cards.length === 1 ? word("target") : word("targets")}, each with its own history. Compare a ${word("target")} with its past, not with the others.`
            : undefined
        }
        title={`The ${word("targets")}`}
      >
        {hasTargets ? (
          <ul className="rp-cards-grid">
            {data.cards.map((entry) => (
              <TargetCard entry={entry} key={entry.target.id} lastRun={data.results.find((row) => row.target === entry.target.id) ?? null} mode={data.mode} />
            ))}
          </ul>
        ) : (
          <Empty
            next={
              <>
                List them under <code>targets</code> in <code>.rallypoint/swarm.json</code>, then run{" "}
                <code>npx rallypoint swarm ui-config --force</code> (or edit <code>swarm.config.ts</code>{" "}
                directly).
              </>
            }
          >
            No {word("targets")} yet. A {word("target")} is one part of the goal the swarm works on, such as a
            package or a feature area.
          </Empty>
        )}
      </Section>

      <Section
        band
        id="improve"
        lede={
          data.mode === "score"
            ? `Each line is one ${word("target")}'s ${measure.label || word("score")}, ${word("version")} by ${word("version")}. A step means a new ${word("version")} beat the one before it.`
            : "Every issue counted once, at the furthest point it has reached."
        }
        title="Watch them improve"
      >
        {data.mode === "score" ? (
          data.versions.some((row) => row.score !== null) ? (
            <ScoreChart
              label={`${measure.label || cap(word("score"))} of ${word("shipped")} ${word("versions")}`}
              targets={data.targets}
              versions={data.versions}
            />
          ) : (
            <Empty
              next={
                <>
                  The merger records one with <code>npx rallypoint swarm ship --score &lt;n&gt;</code> after the
                  referee passes it.
                </>
              }
            >
              Nothing {word("shipped")} with a {word("score")} yet, so there is no line to draw.
            </Empty>
          )
        ) : data.github && !data.github.ok ? (
          data.github.reason === "no-repo" ? (
            <Empty
              next={
                <>
                  Set <code>RALLYPOINT_GITHUB_REPO=owner/name</code> in <code>.env.local</code> to count issues
                  here, then open them with <code>npx rallypoint swarm plan plan.json</code>.
                </>
              }
            >
              Delivery is counted from GitHub issues, and no repository is set.
            </Empty>
          ) : (
            <Panel title="GitHub could not be read" tone="warn">
              <p>{data.github.message}</p>
            </Panel>
          )
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
          <Empty
            next={
              <>
                Write the plan as JSON and open its issues with <code>npx rallypoint swarm plan plan.json</code>.
              </>
            }
          >
            No issues yet, so nothing to deliver.
          </Empty>
        )}
        <p className="rp-more">
          <Link href="/swarm/results">
            Every {word("result")} <ArrowRight />
          </Link>
        </p>
      </Section>

      <Section id="how" title="How it works">
        <div className="rp-split">
          <div>
            <p className="rp-section-lede">
              No {word("agent")} grades its own work. Every change is claimed, judged by a referee, reviewed by
              another {word("agent")} and merged by a third.
            </p>
            <p className="rp-statement rp-statement-s">
              So far: <strong className="rp-num">{formatNumber(data.totals.results ?? 0)}</strong> {word("results")},{" "}
              <strong className="rp-num">{formatNumber(data.totals.shipped ?? 0)}</strong> {word("versions")}{" "}
              {word("shipped")} and <strong className="rp-num">{formatNumber(data.totals.buried ?? 0)}</strong>{" "}
              {word("ideas")} {word("buried")}.
            </p>
            <p className="rp-more rp-more-row">
              <Link href="/swarm/how-it-works">
                The whole story <ArrowRight />
              </Link>
              <Link href="/swarm/buried">
                {cap(word("ideas"))} {word("buried")} <ArrowRight />
              </Link>
            </p>
          </div>
          <Steps data={data} />
        </div>
      </Section>

      <Section
        band
        id="news"
        lede={`Written as it happens: ${word("versions")} ${word("shipped")}, ${word("ideas")} ${word("buried")} and protocol changes.`}
        more={data.news.length > 0 ? { href: "/swarm/news", label: "All stories" } : undefined}
        title="News"
      >
        {data.news.length > 0 ? (
          <NewsList items={data.news.slice(0, 3)} />
        ) : (
          <Empty
            next={
              <>
                Stories come from <code>swarm ship</code>, <code>swarm bury</code> and{" "}
                <code>swarm protocol change</code>; merged pull requests join them once GitHub is connected.
              </>
            }
          >
            No news yet.
          </Empty>
        )}
        {reading.length > 0 ? (
          <div className="rp-reading">
            <h3>Further reading</h3>
            <ul>
              {reading.map((item) => (
                <li key={item.href}>
                  <Link href={item.href}>{item.label}</Link>
                  <p>{READING[item.href]}</p>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </Section>
    </div>
  );
}

