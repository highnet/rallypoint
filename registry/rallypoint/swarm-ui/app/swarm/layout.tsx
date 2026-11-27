import "./swarm.css";

import type { Metadata } from "next";
import { Inter, Inter_Tight, JetBrains_Mono } from "next/font/google";
import Link from "next/link";
import { Suspense, type CSSProperties, type ReactNode } from "react";

import { LiveRefresh } from "./_components/live";
import { SwarmNav } from "./_components/nav";
import { cap, word } from "./_lib/format";
import { LIVE_TABLES } from "./_lib/live";
import { getSwarmContext, getWorkingCount, isSignedIn } from "./_lib/queries";
import { readSupabaseEnv } from "./_lib/supabase";
import { SignOut } from "./sign-in/sign-out";
import { swarmConfig } from "./swarm.config";

export const metadata: Metadata = {
  title: { template: `%s · ${swarmConfig.project.name}`, default: swarmConfig.project.name },
  description: swarmConfig.project.tagline,
};

// Self-hosted at build time by next/font. Set --rp-font-sans, --rp-font-display
// or --rp-font-code above .rp-swarm to use your own faces instead.
const sans = Inter({ subsets: ["latin"], variable: "--rp-face-sans", display: "swap" });
const display = Inter_Tight({ subsets: ["latin"], variable: "--rp-face-display", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--rp-face-mono", display: "swap" });

/**
 * The top bar's live part: the live-update indicator, the working count and
 * the sign-out button. It reads the session cookie and memory, so it streams
 * in its own Suspense boundary and the rest of the layout stays in the
 * prerendered shell.
 */
async function TopBarStatus() {
  const signedIn = await isSignedIn();
  const context = await getSwarmContext();
  const working = context.state === "ok" ? await getWorkingCount() : null;
  // Live updates need readable memory; the publishable key is public by design.
  const { env } = readSupabaseEnv();
  const live = context.state === "ok" && env ? { env, private: context.settings.visibility === "private" } : null;

  return (
    <>
      {live ? (
        <LiveRefresh
          publishableKey={live.env.key}
          tables={LIVE_TABLES}
          url={live.env.url}
          withSession={live.private}
        />
      ) : null}
      {working === null ? null : working > 0 ? (
        <Link
          className="rp-live rp-live-on"
          href="/swarm/fleet"
          title={`${working} ${word(working === 1 ? "session" : "sessions")} working right now`}
        >
          <span aria-hidden="true" className="rp-live-dot" />
          Live
          <span className="rp-visually-hidden">
            : {working} {word(working === 1 ? "session" : "sessions")} working
          </span>
        </Link>
      ) : (
        <Link className="rp-live" href="/swarm/fleet" title={`No ${word("sessions")} working right now`}>
          <span aria-hidden="true" className="rp-live-dot" />
          Idle
        </Link>
      )}
      {signedIn ? <SignOut className="rp-session" /> : null}
    </>
  );
}

export default function SwarmLayout({ children }: { children: ReactNode }) {
  const style = swarmConfig.theme.cssVars as CSSProperties;

  return (
    <div className={`rp-swarm ${sans.variable} ${display.variable} ${mono.variable}`} style={style}>
      <a className="rp-skip" href="#rp-main">
        Skip to the content
      </a>
      <header className="rp-top">
        <div className="rp-brand">
          <svg aria-hidden="true" className="rp-flag" height="20" viewBox="0 0 24 24" width="20">
            <path className="sf-r" d="M0 0h24L12 12z" />
            <path className="sf-y" d="M24 0v24L12 12z" />
            <path className="sf-b" d="M24 24H0l12-12z" />
            <path className="sf-k" d="M0 24V0l12 12z" />
            <rect className="sf-edge" height="23" width="23" x="0.5" y="0.5" />
          </svg>
          <Link href="/swarm">{swarmConfig.project.name}</Link>
        </div>
        <div className="rp-top-end">
          <Suspense fallback={null}>
            <TopBarStatus />
          </Suspense>
        </div>
      </header>
      <aside className="rp-sidebar">
        <div className="rp-sidebar-inner">
          <SwarmNav
            items={swarmConfig.nav}
            targets={swarmConfig.targets}
            targetsLabel={cap(word("targets"))}
            title={swarmConfig.project.name}
          />
        </div>
      </aside>
      <main className="rp-main" id="rp-main">
        {children}
      </main>
    </div>
  );
}
