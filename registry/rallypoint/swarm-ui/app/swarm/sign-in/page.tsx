import type { Metadata } from "next";

import { Gate, PageHead, Panel } from "../_components/states";
import { isSignedIn } from "../_lib/queries";
import { readSupabaseEnv } from "../_lib/supabase";
import { swarmConfig } from "../swarm.config";
import { requestMagicLink, signInWithPassword, signOut } from "./actions";
import { TokenFromLink } from "./token-from-link";

export const metadata: Metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const { missing } = readSupabaseEnv();
  if (missing.length > 0) return <Gate context={{ state: "unconfigured", missing }} />;
  const error = typeof params.error === "string" ? params.error : null;
  const sent = params.sent === "1";

  if (await isSignedIn()) {
    return (
      <>
        <PageHead title="Signed in" lede={`You can read ${swarmConfig.project.name}'s memory.`} />
        <form action={signOut}>
          <button className="rp-button rp-button-quiet" type="submit">
            Sign out
          </button>
        </form>
      </>
    );
  }

  return (
    <>
      <PageHead
        title="Sign in"
        lede={`${swarmConfig.project.name} is private. Sign in with the account your team added in Supabase Auth.`}
      />
      <TokenFromLink />
      {error ? (
        <Panel title="Could not sign in" tone="warn">
          <p>{error}</p>
        </Panel>
      ) : null}
      {sent ? (
        <Panel title="Check your email">
          <p>We sent a sign-in link. Open it in this browser.</p>
        </Panel>
      ) : null}
      <div className="rp-forms">
        <form action={signInWithPassword} className="rp-form">
          <h2>Email and password</h2>
          <label>
            Email
            <input autoComplete="email" name="email" required type="email" />
          </label>
          <label>
            Password
            <input autoComplete="current-password" name="password" required type="password" />
          </label>
          <button className="rp-button" type="submit">
            Sign in
          </button>
        </form>
        <form action={requestMagicLink} className="rp-form">
          <h2>Magic link</h2>
          <label>
            Email
            <input autoComplete="email" name="email" required type="email" />
          </label>
          <button className="rp-button rp-button-quiet" type="submit">
            Email me a link
          </button>
          <p className="rp-soft">
            Add this page&rsquo;s URL to Supabase Auth &rsaquo; URL configuration &rsaquo; Redirect
            URLs.
          </p>
        </form>
      </div>
    </>
  );
}
