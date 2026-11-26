import type { Metadata } from "next";

import { LabelChip, Ref, TargetChip } from "../_components/chips";
import { Empty, Figures, Gate, GithubProblem, PageHead, Section, TimeAgo } from "../_components/states";
import { githubRepoUrl, targetsOf } from "../_lib/github";
import { getLanes, getSwarmContext } from "../_lib/queries";

export const metadata: Metadata = { title: "Rallypoint" };

const LANE_PREVIEW = 12;

export default async function RallypointPage() {
  const context = await getSwarmContext();
  if (context.state !== "ok") return <Gate context={context} />;
  const { lanes, github, repo } = await getLanes();

  return (
    <>
      <PageHead
        title="Rallypoint"
        lede="The swarm works through GitHub. Each task is an issue and each change is a pull request. Another agent reviews it, then a merger merges it."
      >
        {repo ? (
          <p>
            <a href={githubRepoUrl("/issues") ?? "#"} rel="noreferrer" target="_blank">
              Issues on GitHub
            </a>{" "}
            ·{" "}
            <a href={githubRepoUrl("/pulls") ?? "#"} rel="noreferrer" target="_blank">
              Pull requests
            </a>
          </p>
        ) : null}
      </PageHead>

      {!github.ok ? (
        <GithubProblem failure={github}>
          <p className="rp-soft">Lanes are read from GitHub and refresh every two minutes.</p>
        </GithubProblem>
      ) : (
        <>
          <Figures items={lanes.map((lane) => ({ label: lane.label, value: lane.items.length }))} />
          {github.truncated ? (
            <p className="rp-soft">Counted from the 300 most recently updated issues and pull requests.</p>
          ) : null}
          {lanes.map((lane) => (
            <Section key={lane.id} lede={lane.description} title={`${lane.label} (${lane.items.length})`}>
              {lane.items.length === 0 ? (
                <Empty>Nothing here.</Empty>
              ) : (
                <ul className="rp-list">
                  {lane.items.slice(0, LANE_PREVIEW).map((item) => (
                    <li key={item.number}>
                      <span className="rp-item-head">
                        <Ref value={item.number} />{" "}
                        <a href={item.url} rel="noreferrer" target="_blank">
                          {item.title}
                        </a>
                      </span>
                      <span className="rp-item-meta">
                        {targetsOf(item).map((id) => (
                          <TargetChip id={id} key={id} />
                        ))}
                        {item.labels
                          .filter((label) => !label.name.startsWith("target:"))
                          .map((label) => (
                            <LabelChip color={label.color} key={label.name} name={label.name} />
                          ))}
                        <span className="rp-soft">
                          {lane.id === "merged" ? "merged " : "updated "}
                          <TimeAgo at={lane.id === "merged" ? item.mergedAt : item.updatedAt} />
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {lane.items.length > LANE_PREVIEW ? (
                <p className="rp-soft">and {lane.items.length - LANE_PREVIEW} more on GitHub.</p>
              ) : null}
            </Section>
          ))}
        </>
      )}
    </>
  );
}
