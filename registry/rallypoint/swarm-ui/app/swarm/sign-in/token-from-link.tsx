"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { acceptMagicLinkToken } from "./actions";

/** Reads a magic link's `#access_token=…` fragment and hands it to the server. */
export function TokenFromLink() {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "working" | "failed">("idle");

  useEffect(() => {
    const hash = new URLSearchParams(window.location.hash.slice(1));
    const token = hash.get("access_token");
    if (!token) return;
    setState("working");
    window.history.replaceState(null, "", window.location.pathname);
    void acceptMagicLinkToken(token, Number(hash.get("expires_in") ?? 3600)).then((result) => {
      if (result.ok) router.replace("/swarm");
      else setState("failed");
    });
  }, [router]);

  if (state === "idle") return null;
  return (
    <p aria-live="polite" className="rp-panel" role="status">
      {state === "working" ? "Signing you in…" : "That link has expired or was already used. Request a new one."}
    </p>
  );
}
