import type { Metadata } from "next";

import { NewsList } from "../_components/news";
import { Empty, Gate, PageHead, Panel, QueryErrors } from "../_components/states";
import { word } from "../_lib/format";
import { getNews, getSwarmContext } from "../_lib/queries";

export const metadata: Metadata = { title: "News" };
export const dynamic = "force-dynamic";

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
        <Empty
          next={
            <>
              Stories come from <code>swarm ship</code>, <code>swarm bury</code> and{" "}
              <code>swarm protocol change</code>; merged pull requests join them once GitHub is connected.
            </>
          }
        >
          Nothing has happened yet.
        </Empty>
      ) : (
        <NewsList items={items} />
      )}
    </>
  );
}
