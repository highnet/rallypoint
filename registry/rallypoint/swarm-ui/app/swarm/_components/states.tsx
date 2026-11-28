import Link from "next/link";
import type { ReactNode } from "react";

import { formatDate, timeAgo } from "../_lib/format";
import type { GithubFailure } from "../_lib/github";
import {
  expiredGuidance,
  notAllowedGuidance,
  privateGuidance,
  supabaseMissingGuidance,
  supabaseNoSchemaGuidance,
  supabaseUnreachableGuidance,
  type Guidance,
} from "../_lib/guidance";
import type { SwarmContext } from "../_lib/queries";
import type { ReadError } from "../_lib/supabase";
import { SessionRecovery } from "../sign-in/token-from-link";
import { CopyButton } from "./copy";

export function PageHead({ title, lede, children }: { title: string; lede?: ReactNode; children?: ReactNode }) {
  return (
    <header className="rp-head">
      <h1>{title}</h1>
      {lede ? <p className="rp-lede">{lede}</p> : null}
      {children}
    </header>
  );
}

export function Section({
  title,
  lede,
  id,
  children,
}: {
  title: string;
  lede?: ReactNode;
  id?: string;
  children: ReactNode;
}) {
  const headingId = id ?? `s-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  return (
    <section aria-labelledby={headingId} className="rp-section">
      <h2 id={headingId}>{title}</h2>
      {lede ? <p className="rp-section-lede">{lede}</p> : null}
      {children}
    </section>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="rp-empty">{children}</p>;
}

export function Panel({ title, tone, children }: { title: string; tone?: "warn"; children: ReactNode }) {
  return (
    <div className={tone === "warn" ? "rp-panel rp-panel-warn" : "rp-panel"} role="status">
      <h2>{title}</h2>
      {children}
    </div>
  );
}

/**
 * Text meant to be pasted somewhere else: a prompt, a command, a file. The
 * copy button sits in its own row above the block, so it never covers the
 * text, and copies exactly the string shown. Only the button is a client
 * component; the block itself stays server-rendered.
 */
export function CopyBlock({
  text,
  label,
  id,
  className = "rp-code",
  tabIndex,
}: {
  text: string;
  label: string;
  id: string;
  className?: string;
  tabIndex?: number;
}) {
  return (
    <div className="rp-copy-block">
      <div className="rp-copy-bar">
        <CopyButton label={label} targetId={id} text={text} />
      </div>
      <pre className={className} id={id} tabIndex={tabIndex}>
        {text}
      </pre>
    </div>
  );
}

/** Reads that failed after the connection itself worked. */
export function QueryErrors({ errors }: { errors: ReadError[] }) {
  if (errors.length === 0) return null;
  const unique = errors.filter(
    (error, index) => errors.findIndex((other) => other.table === error.table) === index,
  );
  return (
    <Panel title="Some memory could not be read" tone="warn">
      <ul className="rp-plain">
        {unique.map((error) => (
          <li key={error.table}>
            <code>{error.table}</code>: {error.message}
          </li>
        ))}
      </ul>
      <p>
        If a table or view is missing, re-apply <code>.rallypoint/swarm/schema.sql</code> in the
        Supabase SQL editor.
      </p>
    </Panel>
  );
}

/** Inline markup used by `_lib/guidance.ts`: `code`, **strong**, [label](https://…). */
function Inline({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  const pattern = /`([^`]+)`|\*\*([^*]+)\*\*|\[([^\]]+)\]\((https:\/\/[^)\s]+)\)/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > last) parts.push(text.slice(last, index));
    if (match[1] !== undefined) parts.push(<code key={index}>{match[1]}</code>);
    else if (match[2] !== undefined) parts.push(<strong key={index}>{match[2]}</strong>);
    else
      parts.push(
        <a href={match[4]} key={index} rel="noreferrer" target="_blank">
          {match[3]}
        </a>,
      );
    last = index + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}

/**
 * A setup or error banner: what is wrong, the steps to fix it as a list, and
 * when the fix applies. `children` adds page-specific context or actions.
 */
export function Fix({
  guidance,
  tone = "warn",
  children,
}: {
  guidance: Guidance;
  tone?: "warn" | "plain";
  children?: ReactNode;
}) {
  return (
    <Panel title={guidance.title} tone={tone === "warn" ? "warn" : undefined}>
      <p>
        <Inline text={guidance.problem} />
      </p>
      <ol className="rp-fix-steps">
        {guidance.steps.map((step) => (
          <li key={step}>
            <Inline text={step} />
          </li>
        ))}
      </ol>
      <p className="rp-fix-after">
        <Inline text={guidance.after} />
      </p>
      {children}
      {guidance.detail ? <p className="rp-soft rp-fix-detail">{guidance.detail}</p> : null}
    </Panel>
  );
}

const ENV_TEMPLATE = `NEXT_PUBLIC_RALLYPOINT_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_RALLYPOINT_SUPABASE_KEY=<publishable or anon key>
RALLYPOINT_GITHUB_REPO=<owner>/<name>      # Rallypoint lanes, delivery, skills
RALLYPOINT_GITHUB_TOKEN=<read-only token>  # private repos, rate limits`;

/** What every page renders when memory cannot be read yet. */
export function Gate({ context }: { context: Exclude<SwarmContext, { state: "ok" }> }) {
  if (context.state === "recover") return <SessionRecovery />;
  if (context.state === "unconfigured") {
    return (
      <Fix guidance={supabaseMissingGuidance(context.missing)} tone="plain">
        <CopyBlock
          className="rp-code rp-code-nowrap"
          id="rp-env-template"
          label="Copy the environment variable template"
          tabIndex={0}
          text={ENV_TEMPLATE}
        />
        <p>
          Then run <code>npx rallypoint swarm doctor</code> to check the connection.
        </p>
      </Fix>
    );
  }
  if (context.state === "no-schema") {
    return <Fix guidance={supabaseNoSchemaGuidance(context.message)} tone="plain" />;
  }
  if (context.state === "unreachable") {
    return <Fix guidance={supabaseUnreachableGuidance(context.message)} />;
  }
  const guidance = context.expired
    ? expiredGuidance()
    : context.signedIn
      ? notAllowedGuidance()
      : privateGuidance();
  return (
    <Fix guidance={guidance} tone="plain">
      <p>
        <Link className="rp-button" href="/swarm/sign-in">
          {context.signedIn ? "Account" : "Sign in"}
        </Link>
      </p>
    </Fix>
  );
}

/** A failed GitHub read, with the steps to fix it. */
export function GithubProblem({ failure, children }: { failure: GithubFailure; children?: ReactNode }) {
  return (
    <Fix guidance={failure.guidance} tone={failure.reason === "no-repo" ? "plain" : "warn"}>
      {children}
    </Fix>
  );
}

export function TimeAgo({ at }: { at: string | null | undefined }) {
  if (!at) return <span className="rp-soft">—</span>;
  return (
    <time dateTime={at} title={formatDate(at)}>
      {timeAgo(at)}
    </time>
  );
}

/** A labelled figure in a ruled row of totals. */
export function Figures({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="rp-figures">
      {items.map((item) => (
        <div key={item.label}>
          <dt>{item.label}</dt>
          <dd>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Filter links that keep the page server-rendered (no client state). */
export function FilterBar({
  label,
  options,
}: {
  label: string;
  options: { href: string; label: ReactNode; current: boolean }[];
}) {
  return (
    <nav aria-label={label} className="rp-filters">
      <span className="rp-filters-label">{label}</span>
      <ul>
        {options.map((option) => (
          <li key={option.href}>
            <Link aria-current={option.current ? "page" : undefined} href={option.href}>
              {option.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
