"use client";

import type { FormEvent } from "react";

import { endSession, signOut } from "./actions";

/**
 * Signs the reader out with a full page load, not a client navigation.
 *
 * With Cache Components, Next.js keeps up to three pages you navigated away
 * from mounted but hidden (React `<Activity>`), so a client-side redirect
 * would leave private memory in the document and one Back press away. A full
 * load drops every hidden page. Without JavaScript the form still posts to
 * `signOut`, which redirects on the server.
 */
export function SignOut({ className, buttonClassName = "rp-linkish" }: { className?: string; buttonClassName?: string }) {
  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    // An absolute URL: this is a deliberate full load, not a router push.
    const signIn = new URL("/swarm/sign-in", window.location.origin).href;
    void endSession().finally(() => window.location.assign(signIn));
  };

  return (
    <form action={signOut} className={className} onSubmit={onSubmit}>
      <button className={buttonClassName} type="submit">
        Sign out
      </button>
    </form>
  );
}
