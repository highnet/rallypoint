import "./swarm.css";

import type { Metadata } from "next";
import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";

import { ArrowRight } from "./_components/icons";
import { SwarmNav } from "./_components/nav";
import { describeNews } from "./_components/news";
import { TimeAgo } from "./_components/states";
import { cap, word } from "./_lib/format";
import { getShell, isSignedIn } from "./_lib/queries";
import { signOut } from "./sign-in/actions";
import { swarmConfig } from "./swarm.config";

export const metadata: Metadata = {
  title: { template: `%s · ${swarmConfig.project.name}`, default: swarmConfig.project.name },
  description: swarmConfig.project.tagline,
};

function Flag() {
  return (
    <svg aria-hidden="true" className="rp-flag" height="20" viewBox="0 0 24 24" width="20">
      <path className="sf-r" d="M0 0h24L12 12z" />
      <path className="sf-y" d="M24 0v24L12 12z" />
      <path className="sf-b" d="M24 24H0l12-12z" />
      <path className="sf-k" d="M0 24V0l12 12z" />
      <rect className="sf-edge" height="23" width="23" x="0.5" y="0.5" />
    </svg>
  );
}

/** "● 3 working" or "Idle", linked to the fleet. Hidden until memory answers. */
function LiveStatus({ working }: { working: number | null }) {
  if (working === null) return null;
  const busy = working > 0;
  return (
    <Link className={busy ? "rp-live rp-live-on" : "rp-live"} href="/swarm/fleet">
      <span aria-hidden="true" className="rp-live-dot" />
      {busy ? `${working} working` : "Idle"}
      <span className="rp-visually-hidden"> — see the fleet</span>
    </Link>
  );
}

export default async function SwarmLayout({ children }: { children: ReactNode }) {
  const [signedIn, shell] = await Promise.all([isSignedIn(), getShell()]);
  const style = swarmConfig.theme.cssVars as CSSProperties;
  const latest = shell.latest ? describeNews(shell.latest) : null;

  const sections: { name: string; items: typeof swarmConfig.nav }[] = [];
  for (const item of swarmConfig.nav) {
    const section = sections.find((entry) => entry.name === item.section);
    if (section) section.items.push(item);
    else sections.push({ name: item.section, items: [item] });
  }

  return (
    <div className="rp-swarm" style={style}>
      <a className="rp-skip" href="#rp-main">
        Skip to the content
      </a>
      <header className="rp-topbar">
        <div className="rp-brand">
          <Flag />
          <Link href="/swarm">{swarmConfig.project.name}</Link>
        </div>
        <div className="rp-topbar-end">
          <LiveStatus working={shell.working} />
          {signedIn ? (
            <form action={signOut} className="rp-session">
              <button className="rp-linkish" type="submit">
                Sign out
              </button>
            </form>
          ) : null}
        </div>
      </header>
      <aside className="rp-sidebar">
        <div className="rp-sidebar-inner">
          <SwarmNav
            items={swarmConfig.nav}
            targets={swarmConfig.targets.map(({ id, name, color }) => ({ id, name, color }))}
            targetsLabel={cap(word("targets"))}
            title={swarmConfig.project.name}
          />
        </div>
      </aside>
      <div className="rp-body">
        {latest && shell.latest ? (
          <aside aria-label="Just in" className="rp-justin">
            <span className="rp-justin-label">
              <span aria-hidden="true" className="rp-live-dot" /> Just in
            </span>
            <span className="rp-justin-text">
              {shell.latest.kind === "buried" ? `${latest.kind}: ` : ""}
              {latest.title}
            </span>
            <span className="rp-justin-when">
              <TimeAgo at={shell.latest.at} />
            </span>
            <Link className="rp-justin-link" href="/swarm/news">
              All news <ArrowRight />
            </Link>
          </aside>
        ) : null}
        <main className="rp-main" id="rp-main">
          {children}
        </main>
        <footer className="rp-footer">
          <nav aria-label="All pages" className="rp-footer-nav">
            {sections.map((section) => (
              <div key={section.name}>
                <h2>{section.name}</h2>
                <ul>
                  {section.items.map((item) => (
                    <li key={item.href}>
                      <Link href={item.href}>{item.label}</Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
          <div className="rp-footer-note">
            <p className="rp-footer-name">{swarmConfig.project.name}</p>
            {swarmConfig.project.tagline ? <p>{swarmConfig.project.tagline}</p> : null}
            <p>
              Every number here is read from the swarm&rsquo;s own memory. No {word("version")} counts
              until the referee has judged it.
            </p>
          </div>
        </footer>
      </div>
    </div>
  );
}
