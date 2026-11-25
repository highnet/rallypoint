"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import {
  passwordSignIn,
  sendMagicLink,
  TOKEN_COOKIE,
  verifyToken,
} from "../_lib/supabase";

/**
 * Private mode: sign-in and sign-out. These actions only manage the
 * reader's session cookie; nothing here writes to the swarm's memory.
 */

const ONE_HOUR = 60 * 60;

async function setToken(token: string, maxAge: number) {
  const jar = await cookies();
  jar.set(TOKEN_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge,
  });
}

function field(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function back(error: string): never {
  redirect(`/swarm/sign-in?error=${encodeURIComponent(error)}`);
}

export async function signInWithPassword(form: FormData) {
  const email = field(form, "email");
  const password = form.get("password");
  if (!email || typeof password !== "string" || !password) back("Enter your email and password.");
  const result = await passwordSignIn(email, password as string);
  if (!result.ok) back(result.message);
  await setToken(result.token, Math.min(result.expiresIn, 7 * 24 * ONE_HOUR));
  redirect("/swarm");
}

export async function requestMagicLink(form: FormData) {
  const email = field(form, "email");
  if (!email) back("Enter your email.");
  const head = await headers();
  const host = head.get("x-forwarded-host") ?? head.get("host") ?? "localhost:3000";
  const proto = head.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const result = await sendMagicLink(email, `${proto}://${host}/swarm/sign-in`);
  if (!result.ok) back(result.message);
  redirect("/swarm/sign-in?sent=1");
}

/**
 * The magic link lands on /swarm/sign-in with the access token in the URL
 * fragment, which only the browser can read. A small client component posts
 * it here; it is checked with Supabase Auth before it becomes a cookie.
 */
export async function acceptMagicLinkToken(token: string, expiresIn: number) {
  if (!token || !(await verifyToken(token))) return { ok: false as const };
  const maxAge = Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : ONE_HOUR;
  await setToken(token, Math.min(maxAge, 7 * 24 * ONE_HOUR));
  return { ok: true as const };
}

export async function signOut() {
  const jar = await cookies();
  jar.delete(TOKEN_COOKIE);
  redirect("/swarm/sign-in");
}
