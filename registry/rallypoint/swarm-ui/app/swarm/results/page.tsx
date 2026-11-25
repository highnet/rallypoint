import type { Metadata } from "next";

import { ResultsTable } from "../_components/results";
import { FilterBar, Gate, PageHead, QueryErrors } from "../_components/states";
import { cap, word } from "../_lib/format";
import { getResults, getSwarmContext } from "../_lib/queries";

export const metadata: Metadata = { title: cap(word("results")) };
export const dynamic = "force-dynamic";

type Search = Promise<Record<string, string | string[] | undefined>>;

function href(params: { target?: string; verdict?: string }) {
  const query = new URLSearchParams();
  if (params.target) query.set("target", params.target);
  if (params.verdict) query.set("verdict", params.verdict);
  const text = query.toString();
  return text ? `/swarm/results?${text}` : "/swarm/results";
}

export default async function ResultsPage({ searchParams }: { searchParams: Search }) {
  const params = await searchParams;
  const target = typeof params.target === "string" ? params.target : undefined;
  const verdict = params.verdict === "passed" || params.verdict === "failed" ? params.verdict : undefined;
  const context = await getSwarmContext();
  if (context.state !== "ok") return <Gate context={context} />;
  const data = await getResults({ target, verdict });

  return (
    <>
      <PageHead
        title={cap(word("results"))}
        lede="Every referee run: what it measured, against which baseline, and whether it passed."
      />
      <QueryErrors errors={data.errors} />
      <FilterBar
        label={cap(word("target"))}
        options={[
          { href: href({ verdict }), label: "All", current: !target },
          ...data.targets.map((entry) => ({
            href: href({ target: entry.id, verdict }),
            label: entry.name,
            current: target === entry.id,
          })),
        ]}
      />
      <FilterBar
        label="Verdict"
        options={[
          { href: href({ target }), label: "All", current: !verdict },
          { href: href({ target, verdict: "passed" }), label: "✓ Passed", current: verdict === "passed" },
          { href: href({ target, verdict: "failed" }), label: "✗ Failed", current: verdict === "failed" },
        ]}
      />
      <ResultsTable results={data.results} />
    </>
  );
}
