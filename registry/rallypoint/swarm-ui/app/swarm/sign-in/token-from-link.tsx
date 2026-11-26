"use client";

import { useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useState, useTransition } from "react";

import { acceptMagicLinkToken } from "./actions";

/** Reads a magic link's `#access_token=…` fragment and hands it to the server. */
export function TokenFromLink() {
  const router = useRouter();
  const [working, startWorking] = useTransition();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const hash = new URLSearchParams(window.location.hash.slice(1));
    const token = hash.get("access_token");
    if (!token) return;
    window.history.replaceState(null, "", window.location.pathname);
    startWorking(async () => {
      const result = await acceptMagicLinkToken(token, Number(hash.get("expires_in") ?? 3600));
      if (result.ok) router.replace("/swarm");
      else setFailed(true);
    });
  }, [router]);

  // With Cache Components this page can stay mounted, hidden, after you
  // leave it. Drop a stale "expired" notice so a later visit starts clean.
  useLayoutEffect(() => () => setFailed(false), []);

  if (!working && !failed) return null;
  return (
    <p aria-live="polite" className="rp-panel" role="status">
      {working ? "Signing you in…" : "That link has expired or was already used. Request a new one."}
    </p>
  );
}
