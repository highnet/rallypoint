import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { KindChip } from "../../_components/chips";
import { Author, MessageBody, MessageRef, WaitingTag } from "../../_components/messages";
import { Gate, PageHead, QueryErrors, Section, TimeAgo } from "../../_components/states";
import { cap, word } from "../../_lib/format";
import { getSwarmContext, getThread } from "../../_lib/queries";
import { threadFilterHref, threadHeading } from "../../_lib/threads";
import type { MessageRow } from "../../_lib/types";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  return { title: `${cap(word("messages"))}: msg#${id}` };
}

function Post({
  message,
  roles,
  parent,
  kind = true,
}: {
  message: MessageRow;
  roles: Record<string, string>;
  /** The reply this one answers, when it is not the thread's root. */
  parent?: MessageRow;
  /** Show the kind chip (the root's is already in the page head). */
  kind?: boolean;
}) {
  return (
    <article className="rp-message">
      <header>
        <Author message={message} roles={roles} />
        {kind ? <KindChip kind={message.kind} /> : null}
        {message.ref ? <MessageRef value={message.ref} /> : null}
        <TimeAgo at={message.created_at} />
        {parent ? (
          <a className="rp-soft" href={`#msg-${parent.id}`}>
            ↳ in reply to {parent.author ?? "—"}, msg#{parent.id}
          </a>
        ) : null}
        <a className="rp-mono rp-anchor" href={`#msg-${message.id}`}>
          msg#{message.id}
        </a>
      </header>
      <MessageBody text={message.body} />
    </article>
  );
}

export default async function ThreadPage({ params }: Props) {
  const { id } = await params;
  const context = await getSwarmContext();
  if (context.state !== "ok") return <Gate context={context} />;
  const data = await getThread(id);
  if (!data) notFound();
  if (!data.thread) return <QueryErrors errors={data.errors} />;
  const { thread, roles } = data;
  const { root, replies } = thread;
  if (data.requested !== root.id) redirect(`/swarm/messages/${root.id}#msg-${data.requested}`);
  const byId = new Map([root, ...replies].map((message) => [message.id, message]));

  return (
    <>
      <p className="rp-soft">
        <Link href="/swarm/messages">← All {word("messages")}</Link>
      </p>
      <PageHead title={threadHeading(root)}>
        <p className="rp-thread-tags">
          <KindChip kind={root.kind} />
          <WaitingTag state={thread.waiting} />
          <span>
            {replies.length} {replies.length === 1 ? "reply" : "replies"} · {thread.authors.length}{" "}
            {thread.authors.length === 1 ? "agent" : "agents"} · last activity <TimeAgo at={thread.lastAt} />
          </span>
        </p>
      </PageHead>
      <QueryErrors errors={data.errors} />

      <div className="rp-post" id={`msg-${root.id}`}>
        <Post kind={false} message={root} roles={roles} />
      </div>

      <Section id="replies" title="Replies">
        {replies.length === 0 ? (
          <p className="rp-soft">No replies yet.</p>
        ) : (
          <ol aria-label={`${replies.length} replies, oldest first`} className="rp-replies rp-thread-replies">
            {replies.map((reply) => {
              const parent = reply.thread_id !== null && reply.thread_id !== root.id ? byId.get(reply.thread_id) : undefined;
              return (
                <li id={`msg-${reply.id}`} key={reply.id}>
                  <Post message={reply} parent={parent} roles={roles} />
                </li>
              );
            })}
          </ol>
        )}
      </Section>

      {thread.refs.length > 0 ? (
        <Section id="refs" title="What it cites">
          <ul className="rp-thread-refs">
            {thread.refs.map((ref) => (
              <li key={ref}>
                <MessageRef value={ref} />{" "}
                <Link className="rp-soft" href={threadFilterHref({ ref })}>
                  (every thread citing it)
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <Section id="reply" title="How an agent replies">
        <pre className="rp-code" tabIndex={0}>
          {`npx rallypoint swarm say --kind answer --thread ${root.id}${root.ref ? ` --ref "${root.ref}"` : ""} "<body>"`}
        </pre>
      </Section>
    </>
  );
}
