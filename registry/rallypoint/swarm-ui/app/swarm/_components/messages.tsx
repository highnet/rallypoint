import Link from "next/link";

import { githubRefUrl } from "../_lib/github";
import { refKey, refNumber, roleOf, textSegments, type WaitingState } from "../_lib/threads";
import type { MessageRow } from "../_lib/types";
import { RoleTag, ROLES } from "./role";

/** A message's ref as written (`#12`, `PR #12`), linked to GitHub when the repo is known. */
export function MessageRef({ value }: { value: string | null | undefined }) {
  if (!value) return null;
  const number = refNumber(refKey(value));
  const href = number !== null ? githubRefUrl(number) : null;
  return href ? (
    <a className="rp-mono" href={href} rel="noreferrer" target="_blank">
      {value}
    </a>
  ) : (
    <span className="rp-mono">{value}</span>
  );
}

/** A message body with `#12` linked to GitHub and `msg#12` to that thread. */
export function MessageBody({ text, className }: { text: string; className?: string }) {
  return (
    <p className={className ? `rp-message-body ${className}` : "rp-message-body"}>
      {textSegments(text).map((segment, index) => {
        if (segment.type === "text") return segment.text;
        if (segment.type === "message") {
          return (
            <Link className="rp-mono" href={`/swarm/messages/${segment.id}`} key={index}>
              {segment.text}
            </Link>
          );
        }
        const href = githubRefUrl(segment.number);
        return href ? (
          <a className="rp-mono" href={href} key={index} rel="noreferrer" target="_blank">
            {segment.text}
          </a>
        ) : (
          <span className="rp-mono" key={index}>
            {segment.text}
          </span>
        );
      })}
    </p>
  );
}

const waitingCopy: Record<WaitingState, { label: string; title: string }> = {
  unanswered: { label: "unanswered", title: "Nobody has replied to this question or proposal yet" },
  unacknowledged: { label: "unacknowledged", title: "Nobody else has replied to this hand-off yet" },
};

/** What an open thread waits for, as a symbol and a word. */
export function WaitingTag({ state }: { state: WaitingState | null }) {
  if (!state) return null;
  return (
    <span className="rp-tag rp-waiting" title={waitingCopy[state].title}>
      <span aria-hidden="true">○</span> {waitingCopy[state].label}
    </span>
  );
}

/** Who posted: the agent's name, and its role's flag when the role is known. */
export function Author({ message, roles }: { message: MessageRow; roles: Record<string, string> }) {
  const role = roleOf(message, roles, ROLES);
  return (
    <span className="rp-author">
      <span className="rp-mono">{message.author ?? "—"}</span>
      {role ? <RoleTag role={role} /> : null}
    </span>
  );
}
