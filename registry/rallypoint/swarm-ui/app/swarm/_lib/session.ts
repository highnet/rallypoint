import { cookies } from "next/headers";

import { swarmConfig } from "../swarm.config";
import { refreshSession, revokeSession, TOKEN_COOKIE, type AuthSession } from "./supabase";

export const REFRESH_COOKIE = "rp-swarm-refresh";
export const EMAIL_COOKIE = "rp-swarm-email";
export const VERIFIER_COOKIE = "rp-swarm-pkce";
const UNTIL_COOKIE = "rp-swarm-session-until";
const COOKIES = [TOKEN_COOKIE, REFRESH_COOKIE, UNTIL_COOKIE, VERIFIER_COOKIE];
const THIRTY_DAYS = 30 * 24 * 60 * 60;
export const RENEW_BEFORE_MS = 60_000;

export const cookieOptions = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
});

export function expiryOf(token: string | null): number {
  try {
    const payload = token?.split(".")[1];
    const exp: unknown = payload ? JSON.parse(Buffer.from(payload, "base64url").toString()).exp : null;
    return typeof exp === "number" && Number.isFinite(exp) ? exp * 1000 : 0;
  } catch {
    return 0;
  }
}

const sessionMaxAge = () => {
  const seconds = swarmConfig.sessionMaxAgeSeconds;
  return seconds && Number.isSafeInteger(seconds) && seconds > 0 ? seconds : THIRTY_DAYS;
};

async function writeSession(session: AuthSession, until: number) {
  const jar = await cookies();
  const maxAge = Math.ceil((until - Date.now()) / 1000);
  const options = { ...cookieOptions(), maxAge };
  jar.set(TOKEN_COOKIE, session.token, options);
  jar.set(REFRESH_COOKIE, session.refreshToken, options);
  jar.set(UNTIL_COOKIE, String(until), options);
}

export async function startReaderSession(session: AuthSession, email?: string) {
  await writeSession(session, Date.now() + sessionMaxAge() * 1000);
  const remembered = session.email ?? email;
  if (remembered) {
    const jar = await cookies();
    jar.set(EMAIL_COOKIE, remembered, { ...cookieOptions(), maxAge: sessionMaxAge() });
  }
}

async function clearSession() {
  const jar = await cookies();
  for (const name of COOKIES) jar.set(name, "", { ...cookieOptions(), maxAge: 0 });
}

export async function hasRefreshSession() {
  const jar = await cookies();
  return Boolean(jar.get(REFRESH_COOKIE)?.value);
}

type SessionResult =
  | { status: "ok"; token: string; expiresAt: number }
  | { status: "expired" | "unavailable" };

// Requests in this server process share the same exchange. Across instances,
// Supabase supports retrying the direct parent of the active refresh token.
const exchanges = new Map<string, ReturnType<typeof refreshSession>>();
function exchange(refreshToken: string) {
  const pending = exchanges.get(refreshToken);
  if (pending) return pending;
  const result = refreshSession(refreshToken).finally(() => exchanges.delete(refreshToken));
  exchanges.set(refreshToken, result);
  return result;
}

/** Call only from a route handler or server action that can write cookies. */
export async function ensureReaderSession(force = false): Promise<SessionResult> {
  const jar = await cookies();
  const token = jar.get(TOKEN_COOKIE)?.value ?? null;
  const refresh = jar.get(REFRESH_COOKIE)?.value;
  const until = Number(jar.get(UNTIL_COOKIE)?.value ?? 0);
  const expiresAt = Math.min(expiryOf(token), until || Infinity);
  const now = Date.now();
  if (token && !force && expiresAt > now + (refresh ? RENEW_BEFORE_MS : 0)) {
    return { status: "ok", token, expiresAt };
  }
  if (!refresh || !Number.isFinite(until) || until <= now) {
    await clearSession();
    return { status: "expired" };
  }
  const result = await exchange(refresh);
  if (result.ok && until > Date.now()) {
    const nextExpiry = Math.min(expiryOf(result.session.token), until);
    if (nextExpiry > Date.now()) {
      await writeSession(result.session, until);
      return { status: "ok", token: result.session.token, expiresAt: nextExpiry };
    }
  }
  if (!result.ok && !result.refused) {
    return !force && token && expiresAt > Date.now() ? { status: "ok", token, expiresAt } : { status: "unavailable" };
  }
  await clearSession();
  return { status: "expired" };
}

export async function endReaderSession() {
  try {
    const session = await ensureReaderSession();
    if (session.status === "ok") await revokeSession(session.token);
  } finally {
    await clearSession();
  }
}

