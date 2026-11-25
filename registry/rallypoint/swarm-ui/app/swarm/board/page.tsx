import type { Metadata } from "next";
import Link from "next/link";

import { IssuePr, KindChip, Ref, TargetChip, Verdict } from "../_components/chips";
import { ResultOutcome } from "../_components/results";
import { Empty, FilterBar, Gate, PageHead, QueryErrors, TimeAgo } from "../_components/states";
import { cap, formatScore, word } from "../_lib/format";
import { BOARD_KINDS, getBoard, getSwarmContext, type BoardEntry, type BoardKind } from "../_lib/queries";
import { swarmConfig } from "../swarm.config";

export const metadata: Metadata = { title: "Board" };
export const dynamic = "force-dynamic";

const kindLabel = (kind: BoardKind): string =>
  ({
    result: cap(word("results")),
    version: cap(word("versions")),
    buried: cap(word("buried")),
    protocol: "Protocol",
    message: cap(word("messages")),
  })[kind];

function Entry({ entry }: { entry: BoardEntry }) {
  switch (entry.kind) {
    case "result":
      return (
        <>
          <span className="rp-tag">{cap(word("result"))}</span>{" "}
          <Link className="rp-mono" href={`/swarm/results/${entry.row.id}`}>
            #{entry.row.id}
          </Link>{" "}
          <TargetChip id={entry.row.target} /> <IssuePr issue={entry.row.issue} pr={entry.row.pr} />{" "}
          <Verdict passed={entry.row.passed} /> <ResultOutcome result={entry.row} />
        </>
      );
    case "version":
      return (
        <>
          <span className="rp-tag">{cap(word("shipped"))}</span> <TargetChip id={entry.row.target} />{" "}
          <span className="rp-mono">{entry.row.version}</span>
          {entry.row.score !== null ? <> · {formatScore(entry.row.score)}</> : null} · PR <Ref value={entry.row.pr} />
        </>
      );
    case "buried":
      return (
        <>
          <span className="rp-tag">{cap(word("buried"))}</span> <TargetChip id={entry.row.target} /> {entry.row.idea}{" "}
          <IssuePr issue={entry.row.issue} pr={entry.row.pr} />
          {entry.row.lesson ? <p className="rp-soft">{entry.row.lesson}</p> : null}
        </>
      );
    case "protocol":
      return (
        <>
          <span className="rp-tag">Protocol {entry.row.version}</span> {entry.row.summary}{" "}
          <IssuePr issue={entry.row.issue} pr={entry.row.pr} />
        </>
      );
    case "message":
      return (
        <>
          <KindChip kind={entry.row.kind} /> <span className="rp-mono">{entry.row.author ?? "—"}</span>
          {entry.row.ref ? (
            <>
              {" "}
              on <Ref value={entry.row.ref} />
            </>
          ) : null}
          : {entry.row.body}
        </>
      );
  }
}

function href(params: { kind?: string; target?: string }) {
  const query = new URLSearchParams();
  if (params.kind) query.set("kind", params.kind);
  if (params.target) query.set("target", params.target);
  const text = query.toString();
  return text ? `/swarm/board?${text}` : "/swarm/board";
}

export default async function BoardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const kind = BOARD_KINDS.find((entry) => entry === params.kind);
  const target = typeof params.target === "string" ? params.target : undefined;
  const context = await getSwarmContext();
  if (context.state !== "ok") return <Gate context={context} />;
  const { entries, errors } = await getBoard({ kind, target });

  return (
    <>
      <PageHead
        title="Board"
        lede={`The full record from memory, newest first: ${word("results")}, ${word("versions")}, ${word("ideas")} ${word("buried")}, protocol changes and ${word("messages")}.`}
      />
      <QueryErrors errors={errors} />
      <FilterBar
        label="Kind"
        options={[
          { href: href({ target }), label: "All", current: !kind },
          ...BOARD_KINDS.map((entry) => ({ href: href({ kind: entry, target }), label: kindLabel(entry), current: kind === entry })),
        ]}
      />
      <FilterBar
        label={cap(word("target"))}
        options={[
          { href: href({ kind }), label: "All", current: !target },
          ...swarmConfig.targets.map((entry) => ({
            href: href({ kind, target: entry.id }),
            label: entry.name,
            current: target === entry.id,
          })),
        ]}
      />
      {entries.length === 0 ? (
        <Empty>Nothing recorded{kind || target ? " for this filter" : " yet"}.</Empty>
      ) : (
        <ol className="rp-feed">
          {entries.map((entry) => (
            <li key={`${entry.kind}-${entry.row.id}`}>
              <TimeAgo at={entry.at} />
              <div>
                <Entry entry={entry} />
              </div>
            </li>
          ))}
        </ol>
      )}
    </>
  );
}
