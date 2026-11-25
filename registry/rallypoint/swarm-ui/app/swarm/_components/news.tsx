import { cap, formatScore, formatShortDate, word } from "../_lib/format";
import { findTarget, type NewsItem } from "../_lib/queries";
import { IssuePr, Ref, TargetChip } from "./chips";
import { TimeAgo } from "./states";

export type NewsStory = {
  /** "Shipped", "Buried", "Protocol 1.2", "Merged". */
  kind: string;
  title: string;
  body: string | null;
  target: string | null;
};

/** One news item as plain words, for headlines, the "Just in" strip and feeds. */
export function describeNews(item: NewsItem): NewsStory {
  switch (item.kind) {
    case "version": {
      const name = item.row.target ? (findTarget(item.row.target)?.name ?? item.row.target) : null;
      const score = item.row.score !== null ? ` at ${formatScore(item.row.score)}` : "";
      return {
        kind: cap(word("shipped")),
        title: `${name ? `${name} ` : ""}${item.row.version} ${word("shipped")}${score}`,
        body: item.row.notes,
        target: item.row.target,
      };
    }
    case "buried":
      return {
        kind: cap(word("buried")),
        title: item.row.idea,
        body:
          [item.row.reason, item.row.lesson]
            .filter((part): part is string => Boolean(part && part.trim()))
            .map((part) => (/[.!?]$/.test(part.trim()) ? part.trim() : `${part.trim()}.`))
            .join(" ") || null,
        target: item.row.target,
      };
    case "protocol":
      return {
        kind: `Protocol ${item.row.version}`,
        title: item.row.summary,
        body: item.row.kept === null ? null : item.row.kept ? "Kept." : "Reverted.",
        target: null,
      };
    case "merged":
      return { kind: "Merged", title: item.item.title, body: null, target: null };
  }
}

export function newsKey(item: NewsItem): string {
  return `${item.kind}-${item.kind === "merged" ? item.item.number : item.row.id}`;
}

function Refs({ item }: { item: NewsItem }) {
  if (item.kind === "merged") return <Ref value={item.item.number} />;
  if (item.kind === "version") return item.row.pr !== null ? <IssuePr issue={null} pr={item.row.pr} /> : null;
  if (item.kind === "buried" || item.kind === "protocol") {
    return item.row.issue !== null || item.row.pr !== null ? <IssuePr issue={item.row.issue} pr={item.row.pr} /> : null;
  }
  return null;
}

/** Stories with a date column, newest first. */
export function NewsList({ items }: { items: NewsItem[] }) {
  return (
    <ol className="rp-stories">
      {items.map((item) => {
        const story = describeNews(item);
        return (
          <li key={newsKey(item)}>
            <p className="rp-story-when">
              <time dateTime={item.at}>{formatShortDate(item.at)}</time>
              <span className="rp-soft">
                {" · "}
                <TimeAgo at={item.at} />
              </span>
            </p>
            <div>
              <p className="rp-story-meta">
                <span className={`rp-story-kind rp-story-${item.kind}`}>{story.kind}</span>
                {story.target ? <TargetChip id={story.target} /> : null}
                <Refs item={item} />
              </p>
              <h3 className="rp-story-title">{story.title}</h3>
              {story.body ? <p className="rp-story-body">{story.body}</p> : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
