import Link from "next/link";
import type { ReactNode } from "react";

import { formatDate, timeAgo } from "../_lib/format";
import type { SwarmContext } from "../_lib/queries";
import type { ReadError } from "../_lib/supabase";

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

/** What every page renders when memory cannot be read yet. */
export function Gate({ context }: { context: Exclude<SwarmContext, { state: "ok" }> }) {
  if (context.state === "unconfigured") {
    return (
      <Panel title="Not connected yet">
        <p>
          The swarm UI reads memory from your own Supabase project. Set these environment variables
          and restart the app:
        </p>
        <ul className="rp-plain">
          {context.missing.map((name) => (
            <li key={name}>
              <code>{name}</code> <span className="rp-soft">(missing)</span>
            </li>
          ))}
        </ul>
        <pre className="rp-code rp-code-nowrap" tabIndex={0}>
          {`NEXT_PUBLIC_RALLYPOINT_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_RALLYPOINT_SUPABASE_KEY=<publishable or anon key>
RALLYPOINT_GITHUB_REPO=<owner>/<name>      # Rallypoint lanes, delivery, skills
RALLYPOINT_GITHUB_TOKEN=<optional token>   # rate limits, private repos`}
        </pre>
        <p>
          Then apply <code>.rallypoint/swarm/schema.sql</code> in the Supabase SQL editor and run{" "}
          <code>npx rallypoint swarm doctor</code>.
        </p>
      </Panel>
    );
  }
  if (context.state === "no-schema") {
    return (
      <Panel title="Connected, but the swarm schema is missing">
        <p>
          Supabase answered, but the <code>swarm_*</code> tables are not there. Paste{" "}
          <code>.rallypoint/swarm/schema.sql</code> into the Supabase SQL editor and run it, then
          run <code>npx rallypoint swarm init</code>.
        </p>
        <p className="rp-soft">{context.message}</p>
      </Panel>
    );
  }
  if (context.state === "unreachable") {
    return (
      <Panel title="Supabase could not be reached" tone="warn">
        <p>
          Check <code>NEXT_PUBLIC_RALLYPOINT_SUPABASE_URL</code> and{" "}
          <code>NEXT_PUBLIC_RALLYPOINT_SUPABASE_KEY</code>, then reload.
        </p>
        <p className="rp-soft">{context.message}</p>
      </Panel>
    );
  }
  return (
    <Panel title={context.expired ? "Your session expired" : "This swarm is private"}>
      <p>
        {context.expired
          ? "Sign in again to read the swarm's memory."
          : "Its memory is visible to signed-in members only. If you expected a public swarm, `npx rallypoint swarm init` may not have stored its settings yet."}
      </p>
      <p>
        <Link className="rp-button" href="/swarm/sign-in">
          Sign in
        </Link>
      </p>
    </Panel>
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
