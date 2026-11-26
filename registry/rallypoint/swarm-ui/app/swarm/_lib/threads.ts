import type { MessageKind, MessageRow } from "./types";

/**
 * The message board's pure logic: grouping `swarm_messages` rows into threads,
 * the refs they cite, what each thread waits for, and the URL filters. No
 * reads and no React here, so `scripts/test-swarm.mjs` can test it directly.
 * Keep it that way: type-only imports, nothing Node cannot strip.
 */

export const MESSAGE_KINDS: MessageKind[] = ["question", "proposal", "handoff", "answer", "note"];

/** What an open thread waits for: nobody answered, or nobody took the hand-off. */
export type WaitingState = "unanswered" | "unacknowledged";

export type Thread = {
  root: MessageRow;
  /** Every later message in the thread, oldest first, however deeply nested. */
  replies: MessageRow[];
  /** The newest message's time: the board sorts on it. */
  lastAt: string;
  /** Everyone who posted, the root's author first. */
  authors: string[];
  /** Ref keys (`#12`, or the raw ref) from the `ref` column and the bodies. */
  refs: string[];
  waiting: WaitingState | null;
};

export type ThreadFilter = { kind?: MessageKind; ref?: string };

/**
 * A ref as a stable key: `#12` for anything naming a number (`12`, `#12`,
 * `PR #12`, `pr#12`), otherwise the trimmed text. Empty becomes null.
 */
export function refKey(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!text) return null;
  const number = text.match(/^(?:(?:pr|issue)\s*)?#?\s*(\d+)$/i);
  return number ? `#${Number(number[1])}` : text;
}

/** The issue or PR number a ref key names, if it names one. */
export function refNumber(key: string | null | undefined): number | null {
  const match = key?.match(/^#(\d+)$/);
  return match ? Number(match[1]) : null;
}

/** A ref key as a `?ref=` value: `12` rather than `%2312`. */
export function refParam(key: string): string {
  const number = refNumber(key);
  return number !== null ? String(number) : key;
}

export type TextSegment =
  | { type: "text"; text: string }
  | { type: "issue"; text: string; number: number }
  | { type: "message"; text: string; id: number };

// `#12` and `pr#12` name an issue or PR; `msg#12` names another message. A `#`
// inside a word, a URL path or an HTML entity (`&#39;`) is left alone.
const REF_PATTERN = /(^|[^\w&/#])((?:pr)?#(\d+)|msg#(\d+))(?!\w)/gi;

/** Body text split into plain runs and the refs it cites, in order. */
export function textSegments(text: string): TextSegment[] {
  const segments: TextSegment[] = [];
  let cursor = 0;
  for (const match of text.matchAll(REF_PATTERN)) {
    // Groups 1 and 2 always take part in a match; the `?? ""` is for
    // `noUncheckedIndexedAccess` (the standalone dashboard's tsconfig).
    const lead = match[1] ?? "";
    const ref = match[2] ?? "";
    const start = (match.index ?? 0) + lead.length;
    if (start > cursor) segments.push({ type: "text", text: text.slice(cursor, start) });
    segments.push(
      match[4] !== undefined
        ? { type: "message", text: ref, id: Number(match[4]) }
        : { type: "issue", text: ref, number: Number(match[3]) },
    );
    cursor = start + ref.length;
  }
  if (cursor < text.length) segments.push({ type: "text", text: text.slice(cursor) });
  return segments;
}

/** The issue and PR numbers a body cites, as ref keys. */
export function bodyRefs(text: string): string[] {
  return textSegments(text).flatMap((segment) => (segment.type === "issue" ? [`#${segment.number}`] : []));
}

/** A thread's heading: its topic, else the body's first line, shortened. */
export function threadTitle(message: Pick<MessageRow, "topic" | "body">, max = 120): string {
  const topic = message.topic?.trim();
  const text = topic || message.body.trim().split(/\r?\n/)[0]?.trim() || "(empty)";
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

const byTime = (a: MessageRow, b: MessageRow) => a.created_at.localeCompare(b.created_at) || a.id - b.id;

/** Each kind as a reader says it. */
export const KIND_LABEL: Record<MessageKind, string> = {
  question: "Question",
  proposal: "Proposal",
  handoff: "Hand-off",
  answer: "Answer",
  note: "Note",
};

/**
 * A thread page's heading: its topic, else who posted what ("Hand-off from
 * reviewer-cms-25"), since a body's first line is often a paragraph.
 */
export function threadHeading(message: Pick<MessageRow, "topic" | "kind" | "author">): string {
  const topic = message.topic?.trim();
  if (topic) return topic;
  const label = KIND_LABEL[message.kind] ?? "Message";
  return message.author ? `${label} from ${message.author}` : label;
}

/**
 * The root a message belongs to, following `thread_id` up. A missing parent
 * stops the walk; a cycle (which the schema permits) roots at its lowest id,
 * so every member of it agrees on one thread.
 */
function rootIdOf(message: MessageRow, byId: Map<number, MessageRow>): number {
  const chain: number[] = [message.id];
  let current = message;
  while (current.thread_id !== null) {
    const parent = byId.get(current.thread_id);
    if (!parent) break;
    const loop = chain.indexOf(parent.id);
    if (loop !== -1) return Math.min(...chain.slice(loop));
    chain.push(parent.id);
    current = parent;
  }
  return current.id;
}

/**
 * A question or proposal waits until someone replies. A hand-off waits until
 * another agent replies, or posts later on the same ref: sessions often pick
 * up a hand-off with a message of their own on `#n` rather than `--thread`.
 */
function waitingOf(root: MessageRow, replies: MessageRow[], all: MessageRow[]): WaitingState | null {
  if ((root.kind === "question" || root.kind === "proposal") && replies.length === 0) return "unanswered";
  if (root.kind !== "handoff" || replies.some((reply) => reply.author !== root.author)) return null;
  const ref = refKey(root.ref);
  const pickedUp =
    ref !== null &&
    all.some(
      (message) =>
        message.id !== root.id &&
        message.author !== root.author &&
        refKey(message.ref) === ref &&
        byTime(message, root) > 0,
    );
  return pickedUp ? null : "unacknowledged";
}

/**
 * The role a message's author played: the session's recorded role, else the
 * author name's first segment when it names a known role (`reviewer-cms-25`
 * → `reviewer`), the agent-naming convention sessions follow.
 */
export function roleOf(
  message: Pick<MessageRow, "author" | "session_id">,
  roles: Record<string, string>,
  known: readonly string[],
): string | null {
  const recorded = message.session_id ? roles[message.session_id] : undefined;
  if (recorded) return recorded;
  const prefix = message.author?.toLowerCase().match(/^[a-z]+/)?.[0];
  return prefix && known.includes(prefix) ? prefix : null;
}

/**
 * Group messages into threads. A message whose `thread_id` names another
 * message joins that message's thread, even when it replies to a reply; a
 * message whose parent is missing (outside the page read) starts its own.
 * Threads come back newest activity first.
 */
export function buildThreads(messages: MessageRow[]): Thread[] {
  const byId = new Map(messages.map((message) => [message.id, message]));
  const groups = new Map<number, MessageRow[]>();
  for (const message of [...messages].sort(byTime)) {
    const rootId = rootIdOf(message, byId);
    if (rootId === message.id) groups.set(rootId, groups.get(rootId) ?? []);
    else groups.set(rootId, [...(groups.get(rootId) ?? []), message]);
  }
  const threads: Thread[] = [];
  for (const [rootId, replies] of groups) {
    const root = byId.get(rootId);
    if (!root) continue;
    const all = [root, ...replies];
    const authors = [...new Set(all.map((message) => message.author).filter((author): author is string => Boolean(author)))];
    const refs = [
      ...new Set(all.flatMap((message) => [refKey(message.ref), ...bodyRefs(message.body)]).filter((key): key is string => key !== null)),
    ];
    threads.push({
      root,
      replies,
      lastAt: replies.at(-1)?.created_at ?? root.created_at,
      authors,
      refs,
      waiting: waitingOf(root, replies, messages),
    });
  }
  return threads.sort((a, b) => b.lastAt.localeCompare(a.lastAt) || b.root.id - a.root.id);
}

/** Read `?kind=` and `?ref=` from search params; anything unknown is ignored. */
export function parseThreadFilter(params: Record<string, string | string[] | undefined>): ThreadFilter {
  const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
  const kind = MESSAGE_KINDS.find((entry) => entry === one(params.kind));
  const ref = refKey(one(params.ref));
  return { ...(kind ? { kind } : {}), ...(ref ? { ref } : {}) };
}

/** A thread matches a kind when any of its messages has it, and a ref when it cites it. */
export function filterThreads(threads: Thread[], filter: ThreadFilter): Thread[] {
  return threads.filter(
    (thread) =>
      (!filter.kind || thread.root.kind === filter.kind || thread.replies.some((reply) => reply.kind === filter.kind)) &&
      (!filter.ref || thread.refs.includes(filter.ref)),
  );
}

/** The board URL for a filter. */
export function threadFilterHref(filter: ThreadFilter, base = "/swarm/messages"): string {
  const query = new URLSearchParams();
  if (filter.kind) query.set("kind", filter.kind);
  if (filter.ref) query.set("ref", refParam(filter.ref));
  const text = query.toString();
  return text ? `${base}?${text}` : base;
}

/** The refs threads cite most, with how many threads cite each. */
export function refCounts(threads: Thread[]): [string, number][] {
  const counts = new Map<string, number>();
  for (const thread of threads) for (const ref of thread.refs) counts.set(ref, (counts.get(ref) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], undefined, { numeric: true }));
}

/** Threads per kind, counting a thread once for each kind any of its messages has. */
export function kindCounts(threads: Thread[]): Record<MessageKind, number> {
  const counts = Object.fromEntries(MESSAGE_KINDS.map((kind) => [kind, 0])) as Record<MessageKind, number>;
  for (const thread of threads) {
    for (const kind of new Set([thread.root.kind, ...thread.replies.map((reply) => reply.kind)])) {
      if (kind in counts) counts[kind] += 1;
    }
  }
  return counts;
}
