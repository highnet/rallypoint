"use server";

import { readSessionToken, verifyToken } from "./supabase";

/**
 * Private mode only: hands the signed-in reader's own Supabase access token
 * to `<LiveRefresh>` so Realtime can apply RLS to it (`setAuth`). Realtime
 * runs in the browser and the session cookie is httpOnly, so the browser
 * cannot read the token itself, and the cookie stays httpOnly.
 *
 * - Returns a token only to a request that already carries a valid session
 *   cookie, and only that request's own token: nothing is minted or widened.
 * - The token is Supabase's short-lived access token (an hour by default).
 *   Nothing here refreshes it; past `expiresAt` the dashboard falls back to
 *   polling, and the pages ask the reader to sign in again as before.
 * - Never the service-role key or the swarm secret: the UI has neither.
 *
 * A Server Action (a same-origin POST, origin-checked by Next.js), not a
 * route: nothing can embed it or read it cross-site.
 */

export type LiveToken = { token: string; expiresAt: number };

function expiryOf(token: string): number | null {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const json = JSON.parse(Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")) as {
      exp?: unknown;
    };
    return typeof json.exp === "number" ? json.exp * 1000 : null;
  } catch {
    return null;
  }
}

export async function liveToken(): Promise<LiveToken | null> {
  const token = await readSessionToken();
  if (!token) return null;
  const expiresAt = expiryOf(token);
  if (expiresAt === null || expiresAt - Date.now() < 30_000) return null;
  if (!(await verifyToken(token))) return null;
  return { token, expiresAt };
}
