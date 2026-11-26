"use client";

import type { RealtimeClient } from "@supabase/realtime-js";
import { useRouter } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";

import { holdLive, isLiveHeld, onLiveHoldChange } from "../_lib/live";
import { liveToken } from "../_lib/live-token";

/**
 * Live updates for every swarm page. Mounted once in the layout, it listens
 * to Supabase Realtime `postgres_changes` on the memory tables and answers a
 * burst of changes with one `router.refresh()`: the server components re-read
 * and re-render, so they stay the only source of truth and no page needs
 * client data code. The change payloads are ignored.
 *
 * - Debounced: 1.5 s after the last change, and at most 6 s after the first
 *   of a steady stream.
 * - Falls back to a refresh every 60 s while Realtime is unavailable (no
 *   publication, blocked WebSocket, expired session) or reconnecting.
 * - Waits while the tab is hidden or something holds the live signal (the
 *   fleet replay: `useLiveHold(replaying)`), then refreshes once if anything
 *   changed meanwhile.
 * - Private mode: Realtime applies RLS with the reader's own access token,
 *   fetched from the httpOnly session cookie by a Server Action
 *   (../_lib/live-token.ts). Public mode uses the publishable key alone.
 */

const DEBOUNCE_MS = 1500;
const MAX_WAIT_MS = 6000;
const POLL_MS = 60_000;
/** Consecutive channel errors before settling on polling. */
const GIVE_UP_AFTER = 3;
/** Renew the private-mode token this long before it expires. */
const RENEW_BEFORE_MS = 60_000;

type Status = "connecting" | "live" | "reconnecting" | "polling";
type Shown = Status | "held";

const LABEL: Record<Shown, string> = {
  connecting: "Connecting…",
  live: "Live",
  reconnecting: "Reconnecting…",
  polling: "Every minute",
  held: "Paused",
};

const DETAIL: Record<Shown, string> = {
  connecting: "Connecting to live updates.",
  live: "This page updates as the swarm works.",
  reconnecting: "Live updates dropped; reconnecting. The page refreshes every minute meanwhile.",
  polling: "Live updates are unavailable here, so the page refreshes every minute.",
  held: "Live updates wait while the replay plays.",
};

/** Hold live refreshes while `active` is true, e.g. `useLiveHold(replaying)`. */
export function useLiveHold(active: boolean): void {
  useEffect(() => (active ? holdLive() : undefined), [active]);
}

export function LiveRefresh({
  url,
  publishableKey,
  tables,
  withSession,
}: {
  /** The project URL, e.g. https://abc.supabase.co. */
  url: string;
  /** The publishable (anon) key; never the service-role key. */
  publishableKey: string;
  tables: readonly string[];
  /** Private mode: authorise Realtime with the reader's session token. */
  withSession: boolean;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>("connecting");
  const held = useSyncExternalStore(onLiveHoldChange, isLiveHeld, () => false);
  // Props arrive as a fresh array on every refresh; key the effect on content.
  const tableKey = tables.join(",");

  useEffect(() => {
    const watched = tableKey ? tableKey.split(",") : [];
    let disposed = false;
    let pending = false;
    let debounce: number | undefined;
    let firstChangeAt = 0;
    let poll: number | undefined;
    let renew: number | undefined;
    let client: RealtimeClient | null = null;
    let errors = 0;
    let wasDown = false;

    const idle = () => document.hidden || isLiveHeld();

    const flush = () => {
      debounce = undefined;
      firstChangeAt = 0;
      if (idle()) {
        pending = true;
        return;
      }
      pending = false;
      router.refresh();
    };

    const changed = () => {
      const now = Date.now();
      if (!firstChangeAt) firstChangeAt = now;
      window.clearTimeout(debounce);
      debounce = window.setTimeout(flush, Math.max(0, Math.min(DEBOUNCE_MS, firstChangeAt + MAX_WAIT_MS - now)));
    };

    const resume = () => {
      if (pending && !idle()) changed();
    };

    const startPolling = () => {
      if (poll !== undefined) return;
      poll = window.setInterval(() => {
        if (idle()) pending = true;
        else router.refresh();
      }, POLL_MS);
    };

    const stopPolling = () => {
      window.clearInterval(poll);
      poll = undefined;
    };

    const shutDown = () => {
      window.clearTimeout(renew);
      const closing = client;
      client = null;
      if (closing) void closing.removeAllChannels().finally(() => closing.disconnect());
    };

    const fallBack = () => {
      if (disposed) return;
      shutDown();
      setStatus("polling");
      startPolling();
    };

    // Private mode: the token is Supabase's short-lived access token. Swap
    // in a newer one if the reader signed in again; otherwise stop listening
    // before it expires and poll, as the pages will ask them to sign in.
    const scheduleRenew = (current: string, expiresAt: number) => {
      window.clearTimeout(renew);
      renew = window.setTimeout(
        async () => {
          const next = await liveToken().catch(() => null);
          if (disposed || !client) return;
          if (!next || next.token === current) return fallBack();
          await client.setAuth(next.token);
          scheduleRenew(next.token, next.expiresAt);
        },
        Math.max(0, expiresAt - Date.now() - RENEW_BEFORE_MS),
      );
    };

    const unhold = onLiveHoldChange(resume);
    document.addEventListener("visibilitychange", resume);

    void (async () => {
      try {
        if (watched.length === 0 || typeof WebSocket === "undefined") return fallBack();
        const session = withSession ? await liveToken() : null;
        if (disposed) return;
        if (withSession && !session) return fallBack();
        // Loaded on demand, so pages do not wait for it.
        const { RealtimeClient: Client } = await import("@supabase/realtime-js");
        if (disposed) return;
        client = new Client(`${url}/realtime/v1`, { params: { apikey: publishableKey } });
        if (session) {
          await client.setAuth(session.token);
          scheduleRenew(session.token, session.expiresAt);
        }
        // `wait` makes the server confirm the postgres_changes subscription,
        // so a table missing from the publication reports CHANNEL_ERROR
        // instead of a silent "Live".
        const channel = client.channel("rp-swarm-live", {
          config: { postgres_changes_options: { wait: true } },
        });
        for (const table of watched) {
          channel.on("postgres_changes", { event: "*", schema: "public", table }, changed);
        }
        channel.subscribe((state, error) => {
          if (disposed || !client) return;
          if (state === "SUBSCRIBED") {
            errors = 0;
            stopPolling();
            setStatus("live");
            // Catch up on whatever changed while the connection was down.
            if (wasDown) changed();
            wasDown = false;
          } else if (state === "CLOSED") {
            fallBack();
          } else {
            // CHANNEL_ERROR or TIMED_OUT: realtime-js rejoins by itself, unless
            // the tables are not published, which retrying cannot fix.
            errors += 1;
            wasDown = true;
            if (errors >= GIVE_UP_AFTER || error?.message.startsWith("RealtimeDisabledForConfiguration")) {
              return fallBack();
            }
            setStatus("reconnecting");
            startPolling();
          }
        });
      } catch {
        fallBack();
      }
    })();

    return () => {
      disposed = true;
      window.clearTimeout(debounce);
      stopPolling();
      unhold();
      document.removeEventListener("visibilitychange", resume);
      shutDown();
    };
  }, [publishableKey, router, tableKey, url, withSession]);

  const shown: Shown = held && status === "live" ? "held" : status;
  return (
    <span className="rp-sync" data-state={shown} role="status">
      <span aria-hidden="true" className="rp-sync-dot" />
      <span aria-hidden="true">{LABEL[shown]}</span>
      <span className="rp-visually-hidden">{DETAIL[shown]}</span>
    </span>
  );
}
