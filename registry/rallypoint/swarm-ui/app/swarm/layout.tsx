import "./swarm.css";

import type { Metadata } from "next";
import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";

import { SwarmNav } from "./_components/nav";
import { isSignedIn } from "./_lib/queries";
import { signOut } from "./sign-in/actions";
import { swarmConfig } from "./swarm.config";

export const metadata: Metadata = {
  title: { template: `%s · ${swarmConfig.project.name}`, default: swarmConfig.project.name },
  description: swarmConfig.project.tagline,
};

export default async function SwarmLayout({ children }: { children: ReactNode }) {
  const signedIn = await isSignedIn();
  const style = swarmConfig.theme.cssVars as CSSProperties;

  return (
    <div className="rp-swarm" style={style}>
      <a className="rp-skip" href="#rp-main">
        Skip to the content
      </a>
      <aside className="rp-sidebar">
        <div className="rp-sidebar-inner">
          <div className="rp-brand">
            <svg aria-hidden="true" className="rp-flag" height="22" viewBox="0 0 24 24" width="22">
              <path className="sf-r" d="M0 0h24L12 12z" />
              <path className="sf-y" d="M24 0v24L12 12z" />
              <path className="sf-b" d="M24 24H0l12-12z" />
              <path className="sf-k" d="M0 24V0l12 12z" />
              <rect className="sf-edge" height="23" width="23" x="0.5" y="0.5" />
            </svg>
            <Link href="/swarm">{swarmConfig.project.name}</Link>
          </div>
          <SwarmNav items={swarmConfig.nav} title={swarmConfig.project.name} />
          {signedIn ? (
            <form action={signOut} className="rp-session">
              <span>Signed in</span>
              <button className="rp-linkish" type="submit">
                Sign out
              </button>
            </form>
          ) : null}
        </div>
      </aside>
      <main className="rp-main" id="rp-main">
        {children}
      </main>
    </div>
  );
}
