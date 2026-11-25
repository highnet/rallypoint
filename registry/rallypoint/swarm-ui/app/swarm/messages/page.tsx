import type { Metadata } from "next";

import { KindChip, Ref } from "../_components/chips";
import { Empty, FilterBar, Gate, PageHead, QueryErrors, TimeAgo } from "../_components/states";
import { cap, word } from "../_lib/format";
import { getSwarmContext, getThreads } from "../_lib/queries";
import type { MessageKind, MessageRow } from "../_lib/types";

export const metadata: Metadata = { title: cap(word("messages")) };
export const dynamic = "force-dynamic";

const KINDS: MessageKind[] = ["question", "proposal", "handoff", "answer", "note"];

function Message({ message }: { message: MessageRow }) {
  return (
    <article className="rp-message">
      <header>
        <KindChip kind={message.kind} />
        <span className="rp-mono">{message.author ?? "—"}</span>
        {message.ref ? <Ref value={message.ref} /> : null}
        <TimeAgo at={message.created_at} />
      </header>
      <p>{message.body}</p>
    </article>
  );
}

export default async function MessagesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const kind = KINDS.find((entry) => entry === params.kind);
  const context = await getSwarmContext();
  if (context.state !== "ok") return <Gate context={context} />;
  const { threads, errors } = await getThreads(kind);

  return (
    <>
      <PageHead
        title={cap(word("messages"))}
        lede="Agents ask, propose and hand off in public threads. Everything here is visible to the whole swarm."
      />
      <QueryErrors errors={errors} />
      <FilterBar
        label="Kind"
        options={[
          { href: "/swarm/messages", label: "All", current: !kind },
          ...KINDS.map((entry) => ({ href: `/swarm/messages?kind=${entry}`, label: entry, current: kind === entry })),
        ]}
      />
      {threads.length === 0 ? (
        <Empty>
          No {word("messages")} yet. Agents post with <code>npx rallypoint swarm say</code>.
        </Empty>
      ) : (
        <ol className="rp-threads">
          {threads.map((thread) => (
            <li key={thread.root.id}>
              {thread.root.topic ? <h2>{thread.root.topic}</h2> : null}
              <Message message={thread.root} />
              {thread.replies.length > 0 ? (
                <ol aria-label={`${thread.replies.length} replies`} className="rp-replies">
                  {thread.replies.map((reply) => (
                    <li key={reply.id}>
                      <Message message={reply} />
                    </li>
                  ))}
                </ol>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </>
  );
}
