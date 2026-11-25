import type { Metadata } from "next";

import { IssuePr, Ref, TargetChip } from "../_components/chips";
import { Empty, Gate, PageHead, Panel, QueryErrors, TimeAgo } from "../_components/states";
import { cap, formatScore, word } from "../_lib/format";
import { getNews, getSwarmContext, type NewsItem } from "../_lib/queries";

export const metadata: Metadata = { title: "News" };
export const dynamic = "force-dynamic";

function Headline({ item }: { item: NewsItem }) {
  switch (item.kind) {
    case "version":
      return (
        <>
          <span className="rp-tag">{cap(word("shipped"))}</span>{" "}
          <TargetChip id={item.row.target} /> <span className="rp-mono">{item.row.version}</span>
          {item.row.score !== null ? <> at {formatScore(item.row.score)}</> : null}
          {item.row.notes ? <p>{item.row.notes}</p> : null}
        </>
      );
    case "buried":
      return (
        <>
          <span className="rp-tag">{cap(word("buried"))}</span> <TargetChip id={item.row.target} />{" "}
          {item.row.idea} <IssuePr issue={item.row.issue} pr={item.row.pr} />
          {item.row.lesson ? <p>{item.row.lesson}</p> : null}
        </>
      );
    case "protocol":
      return (
        <>
          <span className="rp-tag">Protocol {item.row.version}</span> {item.row.summary}{" "}
          <IssuePr issue={item.row.issue} pr={item.row.pr} />
        </>
      );
    case "merged":
      return (
        <>
          <span className="rp-tag">Merged</span> <Ref value={item.item.number} /> {item.item.title}
        </>
      );
  }
}

export default async function NewsPage() {
  const context = await getSwarmContext();
  if (context.state !== "ok") return <Gate context={context} />;
  const { items, github, errors } = await getNews();

  return (
    <>
      <PageHead
        title="News"
        lede={`What changed lately: ${word("versions")} ${word("shipped")}, ${word("ideas")} ${word("buried")}, protocol changes and merged pull requests.`}
      />
      <QueryErrors errors={errors} />
      {!github.ok && github.reason === "error" ? (
        <Panel title="GitHub not connected" tone="warn">
          <p>{github.message}</p>
        </Panel>
      ) : null}
      {items.length === 0 ? (
        <Empty>Nothing has happened yet.</Empty>
      ) : (
        <ol className="rp-feed">
          {items.map((item) => (
            <li key={`${item.kind}-${item.kind === "merged" ? item.item.number : item.row.id}`}>
              <TimeAgo at={item.at} />
              <div>
                <Headline item={item} />
              </div>
            </li>
          ))}
        </ol>
      )}
    </>
  );
}
