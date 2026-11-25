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

export type AuthResult = { ok: true; token: string; expiresIn: number } | { ok: false; message: string };

function authMessage(body: unknown, fallback: string): string {
  if (body && typeof body === "object") {
    const record = body as Record<string, unknown>;
    for (const key of ["error_description", "msg", "message", "error"]) {
      if (typeof record[key] === "string") return record[key] as string;
    }
  }
  return fallback;
}

/** `POST /auth/v1/token?grant_type=password` */
export async function passwordSignIn(email: string, password: string): Promise<AuthResult> {
  const { env } = readSupabaseEnv();
  if (!env) return { ok: false, message: "Supabase env is not set." };
  try {
    const res = await fetch(`${env.url}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: env.key, "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
      cache: "no-store",
    });
    const body = (await res.json().catch(() => null)) as
      | { access_token?: string; expires_in?: number }
      | null;
    if (!res.ok || !body?.access_token) {
      return { ok: false, message: authMessage(body, "Sign-in failed.") };
    }
    return { ok: true, token: body.access_token, expiresIn: body.expires_in ?? 3600 };
  } catch {
    return { ok: false, message: "Could not reach Supabase Auth." };
  }
}

/** `POST /auth/v1/otp`: sends a magic link to an existing user. */
export async function sendMagicLink(
  email: string,
  redirectTo: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const { env } = readSupabaseEnv();
  if (!env) return { ok: false, message: "Supabase env is not set." };
  try {
    const res = await fetch(
      `${env.url}/auth/v1/otp?redirect_to=${encodeURIComponent(redirectTo)}`,
      {
        method: "POST",
        headers: { apikey: env.key, "Content-Type": "application/json" },
        body: JSON.stringify({ email, create_user: false }),
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

/** `GET /auth/v1/user`: true when the access token is valid. */
export async function verifyToken(token: string): Promise<boolean> {
  const { env } = readSupabaseEnv();
  if (!env) return false;
  try {
    const res = await fetch(`${env.url}/auth/v1/user`, {
      headers: { apikey: env.key, Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    return res.ok;
  } catch {
    return false;
  }
}
