"use server";

import { createHash, randomBytes } from "node:crypto";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import { cookieOptions, endReaderSession, startReaderSession, VERIFIER_COOKIE } from "../_lib/session";
import { passwordSignIn, sendMagicLink } from "../_lib/supabase";

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
  const result = await passwordSignIn(email, password);
  if (!result.ok) back(result.message);
  await startReaderSession(result.session, email);
  redirect("/swarm");
}

export async function requestMagicLink(form: FormData) {
  const email = field(form, "email");
  if (!email) back("Enter your email.");
  const head = await headers();
  const host = head.get("x-forwarded-host") ?? head.get("host") ?? "localhost:3000";
  const proto = head.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const result = await sendMagicLink(email, `${proto}://${host}/swarm/sign-in`, challenge);
  if (!result.ok) back(result.message);
  (await cookies()).set(VERIFIER_COOKIE, verifier, { ...cookieOptions(), maxAge: 60 * 60 });
  redirect("/swarm/sign-in?sent=1");
}

export async function endSession() {
  // Clear the local session even if the Auth service is temporarily unavailable.
  await endReaderSession().catch(() => undefined);
}

export async function signOut() {
  await endSession();
  redirect("/swarm/sign-in");
}
