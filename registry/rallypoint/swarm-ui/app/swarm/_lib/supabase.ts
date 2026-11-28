import { cookies } from "next/headers";

import type { SwarmTable, SwarmTables } from "./types";

/**
 * A zero-dependency, server-side, READ-ONLY PostgREST reader for the
 * project's own Supabase. It never writes: there is no insert, update,
 * delete or RPC-with-side-effects call anywhere in the swarm UI.
 *
 * Token: the signed-in user's access token (cookie `rp-swarm-token`, private
 * mode) or else the publishable key. RLS decides what each can read.
 */

export const TOKEN_COOKIE = "rp-swarm-token";

export const ENV_URL = "NEXT_PUBLIC_RALLYPOINT_SUPABASE_URL";
export const ENV_KEY = "NEXT_PUBLIC_RALLYPOINT_SUPABASE_KEY";

export type SupabaseEnv = { url: string; key: string };

export function readSupabaseEnv(): { env: SupabaseEnv | null; missing: string[] } {
  // Read at runtime (indexed access is not inlined at build), so a deploy can
  // change these without a rebuild. Only server code reads them.
  const url = process.env[ENV_URL]?.trim() ?? "";
  const key = process.env[ENV_KEY]?.trim() ?? "";
  const missing: string[] = [];
  if (!url) missing.push(ENV_URL);
  if (!key) missing.push(ENV_KEY);
  if (missing.length > 0) return { env: null, missing };
  return { env: { url: url.replace(/\/+$/, ""), key }, missing };
}

export async function readSessionToken(): Promise<string | null> {
  const jar = await cookies();
  const value = jar.get(TOKEN_COOKIE)?.value;
  return value ? value : null;
}

export type ReadError = {
  /** HTTP status, or 0 when the request never got a response. */
  status: number;
  /** PostgREST / Postgres error code when present (e.g. PGRST205, 42P01). */
  code: string | null;
  message: string;
  table: string;
};

export type ReadResult<T> = { ok: true; data: T } | { ok: false; error: ReadError };

export type SelectOptions = {
  select?: string;
  /** PostgREST order, e.g. "created_at.desc". */
  order?: string;
  limit?: number;
  /** Extra PostgREST filters, e.g. { status: "eq.working", id: "in.(1,2)" }. */
  filters?: Record<string, string>;
  /** Force the anon key even when a session token exists. */
  anon?: boolean;
};

function headers(env: SupabaseEnv, token: string | null): Record<string, string> {
  return {
    apikey: env.key,
    Authorization: `Bearer ${token ?? env.key}`,
    Accept: "application/json",
  };
}

async function toError(res: Response, table: string): Promise<ReadError> {
  let code: string | null = null;
  let message = `${res.status} ${res.statusText}`.trim();
  try {
    const body = (await res.json()) as { code?: string; message?: string };
    if (body.code) code = String(body.code);
    if (body.message) message = body.message;
  } catch {
    // Not JSON; keep the status line.
  }
  return { status: res.status, code, message, table };
}

/** True when an error means the swarm schema has not been applied. */
export function isMissingSchema(error: ReadError): boolean {
  return error.status === 404 || error.code === "PGRST205" || error.code === "42P01";
}

/** True when an error means the token was refused (expired or invalid). */
export function isAuthError(error: ReadError): boolean {
  return error.status === 401 || error.code === "PGRST301" || error.code === "PGRST303";
}

export async function selectRows<K extends SwarmTable>(
  table: K,
  options: SelectOptions = {},
): Promise<ReadResult<SwarmTables[K][]>> {
  const { env } = readSupabaseEnv();
  if (!env) {
    return {
      ok: false,
      error: { status: 0, code: "ENV", message: "Supabase env is not set.", table },
    };
  }
  const token = options.anon ? null : await readSessionToken();
  const params = new URLSearchParams();
  params.set("select", options.select ?? "*");
  if (options.order) params.set("order", options.order);
  if (options.limit !== undefined) params.set("limit", String(options.limit));
  for (const [column, filter] of Object.entries(options.filters ?? {})) {
    params.set(column, filter);
  }
  try {
    const res = await fetch(`${env.url}/rest/v1/${table}?${params.toString()}`, {
      headers: headers(env, token),
      cache: "no-store",
    });
    if (!res.ok) return { ok: false, error: await toError(res, table) };
    const data = (await res.json()) as SwarmTables[K][];
    return { ok: true, data: Array.isArray(data) ? data : [] };
  } catch (cause) {
    return {
      ok: false,
      error: {
        status: 0,
        code: null,
        message: cause instanceof Error ? cause.message : "Network error",
        table,
      },
    };
  }
}

/** Exact row count through `Prefer: count=exact` and `Content-Range`. */
export async function countRows(
  table: SwarmTable,
  filters: Record<string, string> = {},
): Promise<ReadResult<number>> {
  const { env } = readSupabaseEnv();
  if (!env) {
    return {
      ok: false,
      error: { status: 0, code: "ENV", message: "Supabase env is not set.", table },
    };
  }
  const token = await readSessionToken();
  const params = new URLSearchParams({ select: "*", limit: "1" });
  for (const [column, filter] of Object.entries(filters)) params.set(column, filter);
  try {
    const res = await fetch(`${env.url}/rest/v1/${table}?${params.toString()}`, {
      method: "HEAD",
      headers: { ...headers(env, token), Prefer: "count=exact" },
      cache: "no-store",
    });
    if (!res.ok) {
      return {
        ok: false,
        error: { status: res.status, code: null, message: res.statusText, table },
      };
    }
    const range = res.headers.get("content-range") ?? "";
    const total = Number(range.split("/")[1]);
    return { ok: true, data: Number.isFinite(total) ? total : 0 };
  } catch (cause) {
    return {
      ok: false,
      error: {
        status: 0,
        code: null,
        message: cause instanceof Error ? cause.message : "Network error",
        table,
      },
    };
  }
}

/* ───────────── Supabase Auth (private mode). Reads and session only. ───────────── */

export type AuthSession = { token: string; refreshToken: string; email?: string };
export type AuthResult =
  | { ok: true; session: AuthSession }
  | { ok: false; message: string; refused: boolean };

function authMessage(body: unknown, fallback: string): string {
  if (body && typeof body === "object") {
    const record = body as Record<string, unknown>;
    for (const key of ["error_description", "msg", "message", "error"]) {
      if (typeof record[key] === "string") return record[key] as string;
    }
  }
  return fallback;
}

async function exchangeSession(
  grant: "password" | "refresh_token" | "pkce",
  credentials: Record<string, string>,
): Promise<AuthResult> {
  const { env } = readSupabaseEnv();
  if (!env) return { ok: false, message: "Supabase env is not set.", refused: false };
  try {
    const res = await fetch(`${env.url}/auth/v1/token?grant_type=${grant}`, {
      method: "POST",
      headers: { apikey: env.key, "Content-Type": "application/json" },
      body: JSON.stringify(credentials),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    const body = (await res.json().catch(() => null)) as {
      access_token?: string;
      refresh_token?: string;
      user?: { email?: string };
    } | null;
    if (!res.ok || !body?.access_token || !body.refresh_token) {
      return {
        ok: false,
        message: authMessage(body, "Sign-in failed."),
        refused: [400, 401, 403, 404, 422].includes(res.status),
      };
    }
    return { ok: true, session: { token: body.access_token, refreshToken: body.refresh_token, email: body.user?.email } };
  } catch {
    return { ok: false, message: "Could not reach Supabase Auth.", refused: false };
  }
}

export const passwordSignIn = (email: string, password: string) => exchangeSession("password", { email, password });
export const refreshSession = (refresh_token: string) => exchangeSession("refresh_token", { refresh_token });
export const exchangeCode = (auth_code: string, code_verifier: string) => exchangeSession("pkce", { auth_code, code_verifier });

/** `POST /auth/v1/otp`: sends a magic link to an existing user. */
export async function sendMagicLink(
  email: string,
  redirectTo: string,
  codeChallenge: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const { env } = readSupabaseEnv();
  if (!env) return { ok: false, message: "Supabase env is not set." };
  try {
    const res = await fetch(
      `${env.url}/auth/v1/otp?redirect_to=${encodeURIComponent(redirectTo)}`,
      {
        method: "POST",
        headers: { apikey: env.key, "Content-Type": "application/json" },
        body: JSON.stringify({ email, create_user: false, code_challenge: codeChallenge, code_challenge_method: "s256" }),
        cache: "no-store",
      },
    );
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      return { ok: false, message: authMessage(body, "Could not send the link.") };
    }
    return { ok: true };
  } catch {
    return { ok: false, message: "Could not reach Supabase Auth." };
  }
}

/** Revoke only the current browser's Supabase session. */
export async function revokeSession(token: string): Promise<void> {
  const { env } = readSupabaseEnv();
  if (!env) return;
  await fetch(`${env.url}/auth/v1/logout?scope=local`, {
    method: "POST",
    headers: headers(env, token),
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
}
