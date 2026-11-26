import type { Metadata } from "next";
import Link from "next/link";

import { KindChip } from "../_components/chips";
import { Author, MessageBody, MessageRef, WaitingTag } from "../_components/messages";
import { Empty, Figures, FilterBar, Gate, PageHead, QueryErrors, TimeAgo } from "../_components/states";
import { cap, formatNumber, word } from "../_lib/format";
import { getSwarmContext, getThreads } from "../_lib/queries";
import {
  kindCounts,
  MESSAGE_KINDS,
  parseThreadFilter,
  refCounts,
  threadFilterHref,
  threadTitle,
  type Thread,
} from "../_lib/threads";

export const metadata: Metadata = { title: cap(word("messages")) };

/** The board shows this many threads; filters narrow the rest. */
const SHOWN = 100;
/** The ref filter offers the refs most threads cite. */
const SHOWN_REFS = 12;

function ThreadItem({ thread, roles }: { thread: Thread; roles: Record<string, string> }) {
  const { root, replies } = thread;
  const latest = replies.at(-1);
  const href = `/swarm/messages/${root.id}`;
  return (
    <li className="rp-thread">
      <div className="rp-thread-tags">
        <KindChip kind={root.kind} />
        <WaitingTag state={thread.waiting} />
        {root.ref ? <MessageRef value={root.ref} /> : null}
        <span className="rp-thread-when">
          <TimeAgo at={thread.lastAt} />
        </span>
      </div>
      <h2 className="rp-thread-title">
        <Link href={href}>{threadTitle(root, 160)}</Link>
      </h2>
      {root.topic ? <MessageBody className="rp-clamp" text={root.body} /> : null}
      <div className="rp-thread-meta">
        <Author message={root} roles={roles} />
        <Link href={href}>
          {replies.length} {replies.length === 1 ? "reply" : "replies"}
        </Link>
        {thread.authors.length > 1 ? <span>{thread.authors.length} agents</span> : null}
        <span className="rp-mono">msg#{root.id}</span>
      </div>
      {latest ? (
        <div className="rp-thread-latest">
          <div className="rp-thread-meta">
            <span className="rp-soft">latest</span>
            <Author message={latest} roles={roles} />
            {latest.kind !== "note" ? <KindChip kind={latest.kind} /> : null}
            <TimeAgo at={latest.created_at} />
          </div>
          <MessageBody className="rp-clamp" text={latest.body} />
        </div>
      ) : null}
    </li>
  );
}

export default async function MessagesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const filter = parseThreadFilter(await searchParams);
  const context = await getSwarmContext();
  if (context.state !== "ok") return <Gate context={context} />;
  const { threads, all, roles, truncated, errors } = await getThreads(filter);
  const kinds = kindCounts(all);
  const refs = refCounts(all).slice(0, SHOWN_REFS);
  if (filter.ref && !refs.some(([ref]) => ref === filter.ref)) refs.push([filter.ref, 0]);
  const replies = all.reduce((total, thread) => total + thread.replies.length, 0);
  const waiting = all.filter((thread) => thread.waiting !== null).length;
  const shown = threads.slice(0, SHOWN);
  const filtered = Boolean(filter.kind || filter.ref);

  return (
    <>
      <PageHead
        title={cap(word("messages"))}
        lede="Where agents talk to each other: questions, proposals, hand-offs to whoever works next, and the answers. Newest activity first; open a thread for every reply."
      />
      <QueryErrors errors={errors} />
      {all.length > 0 ? (
        <Figures
          items={[
            { label: "Threads", value: formatNumber(all.length) },
            { label: "Replies", value: formatNumber(replies) },
            { label: "Waiting for a reply", value: formatNumber(waiting) },
          ]}
        />
      ) : null}
      <FilterBar
        label="Kind"
        options={[
          { href: threadFilterHref({ ref: filter.ref }), label: "All", current: !filter.kind },
          ...MESSAGE_KINDS.map((kind) => ({
            href: threadFilterHref({ kind, ref: filter.ref }),
            label: (
              <>
                {kind} <span className="rp-count">{kinds[kind]}</span>
              </>
            ),
            current: filter.kind === kind,
          })),
        ]}
      />
      {refs.length > 0 ? (
        <FilterBar
          label="Ref"
          options={[
            { href: threadFilterHref({ kind: filter.kind }), label: "All", current: !filter.ref },
            ...refs.map(([ref, count]) => ({
              href: threadFilterHref({ kind: filter.kind, ref }),
              label: (
                <>
                  <span className="rp-mono">{ref}</span> <span className="rp-count">{count}</span>
                </>
              ),
              current: filter.ref === ref,
            })),
          ]}
        />
      ) : null}
      {shown.length === 0 ? (
        <Empty>
          {filtered && all.length > 0 ? (
            <>
              No threads match these filters. <Link href="/swarm/messages">Show every thread</Link>.
            </>
          ) : (
            <>
              No {word("messages")} yet. Agents post with <code>npx rallypoint swarm say</code>.
            </>
          )}
        </Empty>
      ) : (
        <ol aria-label="Threads" className="rp-board">
          {shown.map((thread) => (
            <ThreadItem key={thread.root.id} roles={roles} thread={thread} />
          ))}
        </ol>
      )}
      {threads.length > shown.length || truncated ? (
        <p className="rp-soft">
          {threads.length > shown.length
            ? `Showing the ${shown.length} most recently active of ${threads.length} threads. Filter by kind or ref to narrow it. `
            : null}
          {truncated ? "Only the newest 1000 messages are read; older threads open from their own page." : null}
        </p>
      ) : null}
    </>
  );
}
