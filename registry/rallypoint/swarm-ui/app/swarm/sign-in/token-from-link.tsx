"use client";

import { useEffect, useState } from "react";

import { renewReaderSession } from "../_lib/live-token";

export function SessionRecovery() {
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let current = true;
    void renewReaderSession().then((status) => {
      if (!current) return;
      if (status === "ok") window.location.reload();
      else if (status === "expired") window.location.replace("/swarm/sign-in?expired=1");
      else setFailed(true);
    }).catch(() => {
      if (current) setFailed(true);
    });
    return () => { current = false; };
  }, [attempt]);

  return (
    <div className="rp-panel">
      <p aria-live="polite" role="status">
        {failed ? "Could not renew your session. Try again in a moment." : "Restoring your sign-in…"}
      </p>
      {failed ? (
        <button className="rp-button" onClick={() => { setFailed(false); setAttempt(attempt + 1); }} type="button">
          Try again
        </button>
      ) : null}
      <noscript><a href="/swarm/sign-in">Go to sign-in</a></noscript>
    </div>
  );
}
