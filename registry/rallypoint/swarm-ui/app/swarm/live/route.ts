import { RealtimeClient } from "@supabase/realtime-js";

import { LIVE_TABLES } from "../_lib/live";
import { ensureReaderSession, RENEW_BEFORE_MS } from "../_lib/session";
import { readSupabaseEnv, selectRows } from "../_lib/supabase";

const STREAM_MS = 50_000;
const headers = {
  "Cache-Control": "private, no-store, no-transform",
  "Content-Type": "text/event-stream",
  "X-Accel-Buffering": "no",
};
const encoder = new TextEncoder();
const event = (name: string) => `event: ${name}\ndata: 1\n\n`;

export async function GET(request: Request) {
  if (request.headers.get("sec-fetch-site") === "cross-site") return new Response(null, { status: 403 });
  const session = await ensureReaderSession();
  if (session.status === "expired") return new Response(event("expired"), { headers });
  const { env } = readSupabaseEnv();
  if (session.status !== "ok" || !env) return new Response(null, { status: 503 });

  // Private readers must pass the same RLS policy as the dashboard.
  const settings = await selectRows("swarm_settings", { select: "key", limit: 1 });
  if (!settings.ok || !settings.data.length) return new Response(null, { status: 403 });

  const client = new RealtimeClient(`${env.url}/realtime/v1`, { params: { apikey: env.key } });
  let close = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let deadline: ReturnType<typeof setTimeout>;
      let keepAlive: ReturnType<typeof setInterval>;
      let burst: ReturnType<typeof setTimeout> | undefined;

      const send = (text: string) => {
        if (!closed) controller.enqueue(encoder.encode(text));
      };
      close = () => {
        if (closed) return;
        closed = true;
        clearTimeout(deadline);
        clearInterval(keepAlive);
        clearTimeout(burst);
        request.signal.removeEventListener("abort", close);
        try { controller.close(); } catch { /* The stream may already be canceled. */ }
        void client.removeAllChannels().catch(() => undefined).finally(() => client.disconnect());
      };

      const fail = () => {
        send(event("unavailable"));
        close();
      };
      const renewIn = session.expiresAt - Date.now() - RENEW_BEFORE_MS;
      deadline = setTimeout(close, Math.min(STREAM_MS, Math.max(1000, renewIn > 0 ? renewIn : session.expiresAt - Date.now())));
      keepAlive = setInterval(() => send(": keep-alive\n\n"), 15_000);
      request.signal.addEventListener("abort", close, { once: true });
      if (request.signal.aborted) return close();
      send("retry: 1000\n\n");

      void client.setAuth(session.token).then(() => {
        if (closed) return;
        const channel = client.channel("rp-swarm-private", {
          config: { postgres_changes_options: { wait: true } },
        });
        for (const table of LIVE_TABLES) {
          channel.on("postgres_changes", { event: "*", schema: "public", table }, () => {
            if (closed || burst) return;
            burst = setTimeout(() => {
              burst = undefined;
              send(event("update"));
            }, 250);
          });
        }
        channel.subscribe((status) => {
          if (closed) return;
          if (status === "SUBSCRIBED") send(event("ready"));
          else fail();
        });
      }).catch(fail);
    },
    cancel() {
      close();
    },
  });

  return new Response(stream, { headers });
}
